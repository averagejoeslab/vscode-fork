/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { IListRenderer, IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { List } from '../../../../../base/browser/ui/list/listWidget.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { defaultInputBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { AideMode, IAideAgent, IAideService } from '../../../../services/aide/common/aideService.js';

// ============================================================================
// Agent List Item
// ============================================================================

interface IAgentListItem {
	agent: IAideAgent;
	isActive: boolean;
}

interface IAgentTemplateData {
	root: HTMLElement;
	icon: HTMLElement;
	name: HTMLElement;
	time: HTMLElement;
	disposables: DisposableStore;
}

class AgentRenderer implements IListRenderer<IAgentListItem, IAgentTemplateData> {
	readonly templateId = 'agent';

	renderTemplate(container: HTMLElement): IAgentTemplateData {
		const disposables = new DisposableStore();
		const root = append(container, $('.aide-agent-item'));
		const icon = append(root, $('.aide-agent-icon'));
		const details = append(root, $('.aide-agent-details'));
		const name = append(details, $('.aide-agent-name'));
		const time = append(details, $('.aide-agent-time'));

		return { root, icon, name, time, disposables };
	}

	renderElement(element: IAgentListItem, _index: number, templateData: IAgentTemplateData): void {
		templateData.root.className = `aide-agent-item ${element.isActive ? 'active' : ''}`;

		// Mode icon
		const modeIcons: Record<AideMode, string> = {
			[AideMode.Agent]: '∞',
			[AideMode.Plan]: '≡',
			[AideMode.Debug]: '⚙',
			[AideMode.Ask]: '💬'
		};
		templateData.icon.textContent = modeIcons[element.agent.mode] || '∞';

		// Name
		templateData.name.textContent = element.agent.name;
		templateData.name.title = element.agent.name;

		// Time
		templateData.time.textContent = this._formatTime(element.agent.lastActiveAt);
	}

	disposeTemplate(templateData: IAgentTemplateData): void {
		templateData.disposables.dispose();
	}

	private _formatTime(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;

		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) {
			return 'Just now';
		} else if (minutes < 60) {
			return `${minutes}m ago`;
		} else if (hours < 24) {
			return `${hours}h ago`;
		} else if (days === 1) {
			return 'Yesterday';
		} else if (days < 7) {
			return `${days}d ago`;
		} else {
			return new Date(timestamp).toLocaleDateString();
		}
	}
}

class AgentDelegate implements IListVirtualDelegate<IAgentListItem> {
	getHeight(element: IAgentListItem): number {
		return 48;
	}

	getTemplateId(_element: IAgentListItem): string {
		return 'agent';
	}
}

// ============================================================================
// Agent Sidebar
// ============================================================================

export class AgentSidebar extends Disposable {
	private _container: HTMLElement;
	private _searchBox!: InputBox;
	private _newAgentButton!: Button;
	private _agentsList!: List<IAgentListItem>;

	private _agents: IAgentListItem[] = [];
	private _activeAgentId: string | undefined;
	private _searchFilter: string = '';

	private readonly _onDidSelectAgent = this._register(new Emitter<IAideAgent>());
	readonly onDidSelectAgent = this._onDidSelectAgent.event;

	private readonly _onDidRequestNewAgent = this._register(new Emitter<void>());
	readonly onDidRequestNewAgent = this._onDidRequestNewAgent.event;

	constructor(
		container: HTMLElement,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IAideService private readonly _aideService: IAideService
	) {
		super();
		this._container = container;
		this._createUI();
		this._registerListeners();
		this._loadAgents();
	}

	private _createUI(): void {
		this._container.className = 'aide-agent-sidebar';

		// Search box
		const searchContainer = append(this._container, $('.aide-agent-search'));
		this._searchBox = this._register(new InputBox(
			searchContainer,
			this._contextViewService,
			{
				placeholder: 'Search Agents...',
				inputBoxStyles: defaultInputBoxStyles
			}
		));

		// New agent button
		const buttonContainer = append(this._container, $('.aide-agent-new'));
		this._newAgentButton = this._register(new Button(buttonContainer, {}));
		this._newAgentButton.label = '+ New Agent';
		this._newAgentButton.element.className = 'aide-new-agent-button';

		// Agents list
		const listHeader = append(this._container, $('.aide-agent-list-header'));
		listHeader.textContent = 'Agents';

		const listContainer = append(this._container, $('.aide-agent-list'));
		this._agentsList = this._register(new List<IAgentListItem>(
			'aide-agents',
			listContainer,
			new AgentDelegate(),
			[new AgentRenderer()],
			{
				identityProvider: { getId: (e: IAgentListItem) => e.agent.id },
				multipleSelectionSupport: false
			}
		));
	}

	private _registerListeners(): void {
		// Search
		this._register(this._searchBox.onDidChange(value => {
			this._searchFilter = value.toLowerCase();
			this._updateList();
		}));

		// New agent
		this._register(this._newAgentButton.onDidClick(() => {
			this._onDidRequestNewAgent.fire();
		}));

		// Agent selection
		this._register(this._agentsList.onDidChangeSelection(e => {
			if (e.elements.length > 0) {
				this._onDidSelectAgent.fire(e.elements[0].agent);
			}
		}));

		// Agent changes
		this._register(this._aideService.onDidChangeAgents(() => {
			this._loadAgents();
		}));

		// Active agent changes
		this._register(this._aideService.onDidChangeActiveAgent(agent => {
			this._activeAgentId = agent?.id;
			this._updateList();
		}));
	}

	private _loadAgents(): void {
		const agents = this._aideService.getAgents();
		const activeAgent = this._aideService.getActiveAgent();
		this._activeAgentId = activeAgent?.id;

		this._agents = agents.map(agent => ({
			agent,
			isActive: agent.id === this._activeAgentId
		}));

		this._updateList();
	}

	private _updateList(): void {
		let filtered = this._agents;

		if (this._searchFilter) {
			filtered = this._agents.filter(item =>
				item.agent.name.toLowerCase().includes(this._searchFilter)
			);
		}

		// Update active status
		filtered = filtered.map(item => ({
			...item,
			isActive: item.agent.id === this._activeAgentId
		}));

		this._agentsList.splice(0, this._agentsList.length, filtered);

		// Select active agent
		const activeIndex = filtered.findIndex(item => item.isActive);
		if (activeIndex >= 0) {
			this._agentsList.setSelection([activeIndex]);
		}
	}

	public focus(): void {
		this._searchBox.focus();
	}
}
