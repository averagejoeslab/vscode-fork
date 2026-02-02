/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { IListRenderer, IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { List } from '../../../../../base/browser/ui/list/listWidget.js';
import { SelectBox } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import {
	AideMode,
	AideMessageRole,
	IAideAgent,
	IAideAttachment,
	IAideModelInfo,
	IAideService
} from '../../../../services/aide/common/aideService.js';
import { IAideContextService } from '../../../../services/aide/common/aideContextService.js';

// ============================================================================
// Types
// ============================================================================

interface IComposerMessage {
	id: string;
	role: AideMessageRole;
	content: string;
	attachments?: IAideAttachment[];
	isStreaming?: boolean;
}

// ============================================================================
// Message Renderer
// ============================================================================

interface IMessageTemplateData {
	root: HTMLElement;
	roleLabel: HTMLElement;
	content: HTMLElement;
	attachmentsContainer: HTMLElement;
}

class MessageRenderer implements IListRenderer<IComposerMessage, IMessageTemplateData> {
	readonly templateId = 'message';

	renderTemplate(container: HTMLElement): IMessageTemplateData {
		const root = append(container, $('.aide-message'));
		const roleLabel = append(root, $('.aide-message-role'));
		const content = append(root, $('.aide-message-content'));
		const attachmentsContainer = append(root, $('.aide-message-attachments'));

		return { root, roleLabel, content, attachmentsContainer };
	}

	renderElement(element: IComposerMessage, _index: number, templateData: IMessageTemplateData): void {
		templateData.root.className = `aide-message aide-message-${element.role}`;

		// Role label
		switch (element.role) {
			case AideMessageRole.User:
				templateData.roleLabel.textContent = 'You';
				break;
			case AideMessageRole.Assistant:
				templateData.roleLabel.textContent = 'AIDE';
				break;
			case AideMessageRole.System:
				templateData.roleLabel.textContent = 'System';
				break;
			default:
				templateData.roleLabel.textContent = '';
		}

		// Content
		templateData.content.textContent = element.content;
		if (element.isStreaming) {
			templateData.content.classList.add('streaming');
		} else {
			templateData.content.classList.remove('streaming');
		}

		// Attachments
		clearNode(templateData.attachmentsContainer);
		if (element.attachments && element.attachments.length > 0) {
			for (const attachment of element.attachments) {
				const chip = append(templateData.attachmentsContainer, $('.aide-attachment-chip'));
				chip.textContent = attachment.name;
				chip.title = attachment.preview || '';
			}
		}
	}

	disposeTemplate(_templateData: IMessageTemplateData): void {
		// Nothing to dispose
	}
}

class MessageDelegate implements IListVirtualDelegate<IComposerMessage> {
	getHeight(element: IComposerMessage): number {
		// Estimate height based on content length
		const baseHeight = 60;
		const contentLines = Math.ceil(element.content.length / 80);
		const attachmentHeight = element.attachments?.length ? 30 : 0;
		return baseHeight + (contentLines * 20) + attachmentHeight;
	}

	getTemplateId(_element: IComposerMessage): string {
		return 'message';
	}
}

// ============================================================================
// Composer Widget
// ============================================================================

export class ComposerWidget extends Disposable {
	private _container: HTMLElement;
	private _headerContainer!: HTMLElement;
	private _messagesContainer!: HTMLElement;
	private _inputContainer!: HTMLElement;
	private _attachmentsContainer!: HTMLElement;

	private _modeSelect!: SelectBox;
	private _modelSelect!: SelectBox;
	private _messagesList!: List<IComposerMessage>;
	private _inputBox!: InputBox;
	private _sendButton!: Button;

	private _currentAgent: IAideAgent | undefined;
	private _messages: IComposerMessage[] = [];
	private _attachments: IAideAttachment[] = [];
	private _models: IAideModelInfo[] = [];
	private _currentTokenSource: CancellationTokenSource | undefined;

	private readonly _onDidChangeAgent = this._register(new Emitter<IAideAgent | undefined>());
	readonly onDidChangeAgent = this._onDidChangeAgent.event;

	constructor(
		container: HTMLElement,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IAideService private readonly _aideService: IAideService,
		@IAideContextService private readonly _contextService: IAideContextService
	) {
		super();
		this._container = container;
		this._createUI();
		this._registerListeners();
		this._loadModels();
	}

	private _createUI(): void {
		this._container.className = 'aide-composer';

		// Header with mode and model selection
		this._headerContainer = append(this._container, $('.aide-composer-header'));
		this._createHeader();

		// Messages list
		this._messagesContainer = append(this._container, $('.aide-composer-messages'));
		this._createMessagesList();

		// Attachments area
		this._attachmentsContainer = append(this._container, $('.aide-composer-attachments'));

		// Input area
		this._inputContainer = append(this._container, $('.aide-composer-input'));
		this._createInput();
	}

	private _createHeader(): void {
		// Mode selector
		const modeContainer = append(this._headerContainer, $('.aide-composer-mode'));
		const modeLabel = append(modeContainer, $('span.label'));
		modeLabel.textContent = 'Mode:';

		this._modeSelect = this._register(new SelectBox(
			[
				{ text: '∞ Agent' },
				{ text: '≡ Plan' },
				{ text: '⚙ Debug' },
				{ text: '💬 Ask' }
			],
			0,
			this._contextViewService,
			defaultSelectBoxStyles
		));
		this._modeSelect.render(modeContainer);

		// Model selector
		const modelContainer = append(this._headerContainer, $('.aide-composer-model'));
		const modelLabel = append(modelContainer, $('span.label'));
		modelLabel.textContent = 'Model:';

		this._modelSelect = this._register(new SelectBox(
			[{ text: 'Loading...' }],
			0,
			this._contextViewService,
			defaultSelectBoxStyles
		));
		this._modelSelect.render(modelContainer);
	}

	private _createMessagesList(): void {
		this._messagesList = this._register(new List<IComposerMessage>(
			'aide-messages',
			this._messagesContainer,
			new MessageDelegate(),
			[new MessageRenderer()],
			{
				identityProvider: { getId: (e: IComposerMessage) => e.id },
				multipleSelectionSupport: false
			}
		));
	}

	private _createInput(): void {
		// Context buttons
		const buttonsContainer = append(this._inputContainer, $('.aide-input-buttons'));

		// @ mention button
		const mentionButton = append(buttonsContainer, $('button.aide-button'));
		mentionButton.textContent = '@';
		mentionButton.title = 'Add context';
		this._register(Event.fromDOMEventEmitter<MouseEvent>(mentionButton, 'click')(() => {
			this._inputBox.value += '@';
			this._inputBox.focus();
		}));

		// Web search button
		const webButton = append(buttonsContainer, $('button.aide-button'));
		webButton.textContent = '🌐';
		webButton.title = 'Web search';

		// Image button
		const imageButton = append(buttonsContainer, $('button.aide-button'));
		imageButton.textContent = '📷';
		imageButton.title = 'Add image';

		// Input box
		const inputWrapper = append(this._inputContainer, $('.aide-input-wrapper'));
		this._inputBox = this._register(new InputBox(
			inputWrapper,
			this._contextViewService,
			{
				placeholder: 'Plan, @ for context, / for commands...',
				flexibleHeight: true,
				flexibleMaxHeight: 200,
				inputBoxStyles: defaultInputBoxStyles
			}
		));

		// Send button
		this._sendButton = this._register(new Button(inputWrapper, {}));
		this._sendButton.label = 'Send';
		this._sendButton.element.className = 'aide-send-button';
	}

	private _registerListeners(): void {
		// Mode change
		this._register(this._modeSelect.onDidSelect(e => {
			const modes = [AideMode.Agent, AideMode.Plan, AideMode.Debug, AideMode.Ask];
			const selectedMode = modes[e.index];
			if (this._currentAgent) {
				this._aideService.updateAgent(this._currentAgent.id, { mode: selectedMode });
			}
		}));

		// Model change
		this._register(this._modelSelect.onDidSelect(e => {
			if (this._currentAgent && this._models[e.index]) {
				this._aideService.updateAgent(this._currentAgent.id, { model: this._models[e.index].id });
			}
		}));

		// Send message
		this._register(this._sendButton.onDidClick(() => this._sendMessage()));

		// Enter to send
		this._register(this._inputBox.onDidChange(_value => {
			// Handle @ mentions for autocomplete - could show autocomplete here
		}));

		// Agent changes
		this._register(this._aideService.onDidChangeActiveAgent(agent => {
			this._setAgent(agent);
		}));

		// Model changes
		this._register(this._aideService.onDidChangeModels(() => {
			this._loadModels();
		}));
	}

	private async _loadModels(): Promise<void> {
		this._models = await this._aideService.getAvailableModels();

		const options = this._models.length > 0
			? this._models.map(m => ({ text: m.name }))
			: [{ text: 'No models available' }];

		this._modelSelect.setOptions(options);

		// Select current model if agent is set
		if (this._currentAgent) {
			const modelIndex = this._models.findIndex(m => m.id === this._currentAgent!.model);
			if (modelIndex >= 0) {
				this._modelSelect.select(modelIndex);
			}
		}
	}

	private _setAgent(agent: IAideAgent | undefined): void {
		this._currentAgent = agent;
		this._onDidChangeAgent.fire(agent);

		if (agent) {
			// Update mode selection
			const modeIndex = [AideMode.Agent, AideMode.Plan, AideMode.Debug, AideMode.Ask].indexOf(agent.mode);
			if (modeIndex >= 0) {
				this._modeSelect.select(modeIndex);
			}

			// Update model selection
			const modelIndex = this._models.findIndex(m => m.id === agent.model);
			if (modelIndex >= 0) {
				this._modelSelect.select(modelIndex);
			}

			// Load messages
			this._messages = agent.messages.map(m => ({
				id: m.id,
				role: m.role,
				content: m.content.filter(c => c.type === 'text').map(c => c.text || '').join('')
			}));
			this._messagesList.splice(0, this._messagesList.length, this._messages);

			// Scroll to bottom
			if (this._messages.length > 0) {
				this._messagesList.reveal(this._messages.length - 1);
			}
		} else {
			this._messages = [];
			this._messagesList.splice(0, this._messagesList.length);
		}

		this._updateAttachmentsUI();
	}

	private async _sendMessage(): Promise<void> {
		const content = this._inputBox.value.trim();
		if (!content || !this._currentAgent) {
			return;
		}

		// Clear input
		this._inputBox.value = '';

		// Parse mentions and resolve attachments
		const mentions = this._contextService.parseMentions(content);
		let attachments = [...this._attachments];

		if (mentions.length > 0) {
			const resolvedAttachments = await this._contextService.resolveAttachments(mentions, CancellationToken.None);
			attachments = [...attachments, ...resolvedAttachments];
		}

		// Add user message to UI
		const userMessage: IComposerMessage = {
			id: generateUuid(),
			role: AideMessageRole.User,
			content,
			attachments
		};
		this._messages.push(userMessage);
		this._messagesList.splice(this._messages.length - 1, 0, [userMessage]);

		// Add streaming assistant message
		const assistantMessage: IComposerMessage = {
			id: generateUuid(),
			role: AideMessageRole.Assistant,
			content: '',
			isStreaming: true
		};
		this._messages.push(assistantMessage);
		this._messagesList.splice(this._messages.length - 1, 0, [assistantMessage]);
		this._messagesList.reveal(this._messages.length - 1);

		// Clear attachments
		this._attachments = [];
		this._updateAttachmentsUI();

		// Send message and stream response
		this._currentTokenSource = new CancellationTokenSource();

		try {
			let fullContent = '';

			for await (const chunk of this._aideService.sendMessageStream(
				this._currentAgent.id,
				content,
				attachments,
				this._currentTokenSource.token
			)) {
				if (chunk.delta.text) {
					fullContent += chunk.delta.text;
					assistantMessage.content = fullContent;

					// Update the message in the list
					const index = this._messages.length - 1;
					this._messagesList.splice(index, 1, [assistantMessage]);
					this._messagesList.reveal(index);
				}
			}

			// Mark as done streaming
			assistantMessage.isStreaming = false;
			const index = this._messages.length - 1;
			this._messagesList.splice(index, 1, [assistantMessage]);

		} catch (error) {
			assistantMessage.content = `Error: ${error instanceof Error ? error.message : String(error)}`;
			assistantMessage.isStreaming = false;
			const index = this._messages.length - 1;
			this._messagesList.splice(index, 1, [assistantMessage]);
		} finally {
			this._currentTokenSource.dispose();
			this._currentTokenSource = undefined;
		}
	}

	private _updateAttachmentsUI(): void {
		clearNode(this._attachmentsContainer);

		for (const attachment of this._attachments) {
			const chip = append(this._attachmentsContainer, $('.aide-attachment-chip'));
			chip.textContent = attachment.name;
			chip.title = attachment.preview || '';

			const removeButton = append(chip, $('span.remove'));
			removeButton.textContent = '×';
			this._register(Event.fromDOMEventEmitter<MouseEvent>(removeButton, 'click')(() => {
				this._attachments = this._attachments.filter(a => a.id !== attachment.id);
				this._updateAttachmentsUI();
			}));
		}
	}

	public addAttachment(attachment: IAideAttachment): void {
		this._attachments.push(attachment);
		this._updateAttachmentsUI();
	}

	public async createNewAgent(): Promise<void> {
		const agent = await this._aideService.createAgent();
		this._setAgent(agent);
	}

	public stopGeneration(): void {
		this._currentTokenSource?.cancel();
	}

	public focus(): void {
		this._inputBox.focus();
	}

	override dispose(): void {
		this._currentTokenSource?.dispose();
		super.dispose();
	}
}
