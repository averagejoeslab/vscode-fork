/*---------------------------------------------------------------------------------------------
 *  AIDE - AI Development Environment
 *  The Batcomputer's Command Interface
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { IListRenderer, IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { List } from '../../../../../base/browser/ui/list/listWidget.js';
import { SelectBox } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
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
import { AideContextType, IAideContextService } from '../../../../services/aide/common/aideContextService.js';

// ============================================================================
// Types
// ============================================================================

interface IComposerMessage {
	id: string;
	role: AideMessageRole;
	content: string;
	attachments?: IAideAttachment[];
	isStreaming?: boolean;
	toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>;
}

// ============================================================================
// Message Renderer
// ============================================================================

interface IMessageTemplateData {
	root: HTMLElement;
	header: HTMLElement;
	roleLabel: HTMLElement;
	timestamp: HTMLElement;
	content: HTMLElement;
	toolCallsContainer: HTMLElement;
	attachmentsContainer: HTMLElement;
}

class MessageRenderer implements IListRenderer<IComposerMessage, IMessageTemplateData> {
	readonly templateId = 'message';

	renderTemplate(container: HTMLElement): IMessageTemplateData {
		const root = append(container, $('.aide-message'));
		const header = append(root, $('.aide-message-header'));
		const roleLabel = append(header, $('.aide-message-role'));
		const timestamp = append(header, $('.aide-message-timestamp'));
		const content = append(root, $('.aide-message-content'));
		const toolCallsContainer = append(root, $('.aide-tool-calls'));
		const attachmentsContainer = append(root, $('.aide-message-attachments'));

		return { root, header, roleLabel, timestamp, content, toolCallsContainer, attachmentsContainer };
	}

	renderElement(element: IComposerMessage, _index: number, templateData: IMessageTemplateData): void {
		templateData.root.className = `aide-message aide-message-${element.role}`;

		// Role label with icon
		switch (element.role) {
			case AideMessageRole.User:
				templateData.roleLabel.textContent = '> YOU';
				break;
			case AideMessageRole.Assistant:
				templateData.roleLabel.innerHTML = '<span class="aide-icon">◆</span> AIDE';
				break;
			case AideMessageRole.System:
				templateData.roleLabel.textContent = '⚡ SYSTEM';
				break;
			case AideMessageRole.Tool:
				templateData.roleLabel.textContent = '⚙ TOOL';
				break;
			default:
				templateData.roleLabel.textContent = '';
		}

		// Content with markdown-like rendering
		const formattedContent = this._formatContent(element.content);
		templateData.content.innerHTML = formattedContent;

		if (element.isStreaming) {
			templateData.content.classList.add('streaming');
		} else {
			templateData.content.classList.remove('streaming');
		}

		// Tool calls
		clearNode(templateData.toolCallsContainer);
		if (element.toolCalls && element.toolCalls.length > 0) {
			for (const toolCall of element.toolCalls) {
				const toolDiv = append(templateData.toolCallsContainer, $('.aide-tool-call'));
				const icon = append(toolDiv, $('.aide-tool-call-icon'));
				icon.textContent = '⚡';
				const name = append(toolDiv, $('.aide-tool-call-name'));
				name.textContent = toolCall.name;
				const argsDiv = append(toolDiv, $('.aide-tool-call-args'));
				argsDiv.textContent = JSON.stringify(toolCall.args).slice(0, 100);
			}
		}

		// Attachments
		clearNode(templateData.attachmentsContainer);
		if (element.attachments && element.attachments.length > 0) {
			for (const attachment of element.attachments) {
				const chip = append(templateData.attachmentsContainer, $('.aide-attachment-chip'));
				const icon = this._getAttachmentIcon(attachment.type);
				chip.innerHTML = `<span class="icon">${icon}</span> ${this._escapeHtml(attachment.name)}`;
				chip.title = attachment.preview || '';
			}
		}
	}

	private _formatContent(content: string): string {
		if (!content) return '';

		// Escape HTML first
		let formatted = this._escapeHtml(content);

		// Code blocks (```...```)
		formatted = formatted.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

		// Inline code (`...`)
		formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

		// Bold (**...** or __...__)
		formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		formatted = formatted.replace(/__([^_]+)__/g, '<strong>$1</strong>');

		// Italic (*...* or _..._)
		formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

		// Line breaks
		formatted = formatted.replace(/\n/g, '<br>');

		return formatted;
	}

	private _escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	private _getAttachmentIcon(type: IAideAttachment['type']): string {
		switch (type) {
			case 'file': return '📄';
			case 'folder': return '📁';
			case 'selection': return '✂️';
			case 'terminal': return '💻';
			case 'web': return '🌐';
			case 'codebase': return '🔍';
			case 'symbol': return '⚡';
			case 'image': return '🖼️';
			default: return '📎';
		}
	}

	disposeTemplate(_templateData: IMessageTemplateData): void {
		// Nothing to dispose
	}
}

class MessageDelegate implements IListVirtualDelegate<IComposerMessage> {
	getHeight(element: IComposerMessage): number {
		const baseHeight = 80;
		const contentLines = Math.ceil(element.content.length / 60);
		const toolCallHeight = element.toolCalls?.length ? element.toolCalls.length * 40 : 0;
		const attachmentHeight = element.attachments?.length ? 36 : 0;
		return baseHeight + (contentLines * 22) + toolCallHeight + attachmentHeight;
	}

	getTemplateId(_element: IComposerMessage): string {
		return 'message';
	}
}

// ============================================================================
// Mention Autocomplete
// ============================================================================

interface IMentionItem {
	type: AideContextType;
	label: string;
	description: string;
	icon: string;
}

const MENTION_TYPES: IMentionItem[] = [
	{ type: AideContextType.File, label: 'file', description: 'Reference a file', icon: '📄' },
	{ type: AideContextType.Folder, label: 'folder', description: 'Reference a folder', icon: '📁' },
	{ type: AideContextType.Codebase, label: 'codebase', description: 'Search codebase', icon: '🔍' },
	{ type: AideContextType.Web, label: 'web', description: 'Search the web', icon: '🌐' },
	{ type: AideContextType.Terminal, label: 'terminal', description: 'Terminal output', icon: '💻' },
	{ type: AideContextType.Git, label: 'git', description: 'Git changes', icon: '⚡' },
	{ type: AideContextType.Problems, label: 'problems', description: 'Current errors', icon: '⚠️' },
	{ type: AideContextType.Docs, label: 'docs', description: 'Documentation', icon: '📚' }
];

// ============================================================================
// Composer Widget
// ============================================================================

export class ComposerWidget extends Disposable {
	private _container: HTMLElement;
	private _headerContainer!: HTMLElement;
	private _messagesContainer!: HTMLElement;
	private _emptyState!: HTMLElement;
	private _inputContainer!: HTMLElement;
	private _attachmentsContainer!: HTMLElement;
	private _mentionDropdown!: HTMLElement;
	private _statusBar!: HTMLElement;

	private _modeSelect!: SelectBox;
	private _modelSelect!: SelectBox;
	private _messagesList!: List<IComposerMessage>;
	private _inputBox!: InputBox;
	private _sendButton!: Button;
	private _stopButton!: Button;

	private _currentAgent: IAideAgent | undefined;
	private _messages: IComposerMessage[] = [];
	private _attachments: IAideAttachment[] = [];
	private _models: IAideModelInfo[] = [];
	private _currentTokenSource: CancellationTokenSource | undefined;
	private _isGenerating = false;
	private _mentionDropdownVisible = false;
	private _mentionQuery = '';
	private _selectedMentionIndex = 0;

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

		// Empty state (shown when no messages)
		this._emptyState = append(this._container, $('.aide-empty-state'));
		this._createEmptyState();

		// Messages list
		this._messagesContainer = append(this._container, $('.aide-composer-messages'));
		this._createMessagesList();

		// Attachments area
		this._attachmentsContainer = append(this._container, $('.aide-composer-attachments'));

		// Mention dropdown
		this._mentionDropdown = append(this._container, $('.aide-mention-dropdown'));
		this._mentionDropdown.style.display = 'none';

		// Input area
		this._inputContainer = append(this._container, $('.aide-composer-input'));
		this._createInput();

		// Status bar
		this._statusBar = append(this._container, $('.aide-status-bar'));
		this._updateStatusBar();
	}

	private _createHeader(): void {
		// Title and status
		const titleRow = append(this._headerContainer, $('.aide-header-title'));
		const title = append(titleRow, $('h2'));
		title.innerHTML = '<span class="aide-logo">◆</span> AIDE';
		const statusDot = append(titleRow, $('.aide-status-dot.active'));
		statusDot.title = 'System Online';

		// Mode selector
		const controlsRow = append(this._headerContainer, $('.aide-header-controls'));

		const modeContainer = append(controlsRow, $('.aide-composer-mode'));
		const modeLabel = append(modeContainer, $('span.label'));
		modeLabel.textContent = 'MODE';

		this._modeSelect = this._register(new SelectBox(
			[
				{ text: '◆ Agent' },
				{ text: '≡ Plan' },
				{ text: '⚙ Debug' },
				{ text: '? Ask' }
			],
			0,
			this._contextViewService,
			defaultSelectBoxStyles
		));
		this._modeSelect.render(modeContainer);

		// Model selector
		const modelContainer = append(controlsRow, $('.aide-composer-model'));
		const modelLabel = append(modelContainer, $('span.label'));
		modelLabel.textContent = 'MODEL';

		this._modelSelect = this._register(new SelectBox(
			[{ text: 'Configure API Key...' }],
			0,
			this._contextViewService,
			defaultSelectBoxStyles
		));
		this._modelSelect.render(modelContainer);
	}

	private _createEmptyState(): void {
		const icon = append(this._emptyState, $('.aide-empty-state-icon'));
		icon.innerHTML = '◆';

		const title = append(this._emptyState, $('.aide-empty-state-title'));
		title.textContent = 'AIDE READY';

		const description = append(this._emptyState, $('.aide-empty-state-description'));
		description.innerHTML = `
			<p>Your AI-powered development companion awaits.</p>
			<div class="aide-hints">
				<div class="hint"><span class="key">@</span> Add context</div>
				<div class="hint"><span class="key">/</span> Commands</div>
				<div class="hint"><span class="key">Enter</span> Send</div>
			</div>
		`;
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
		// Context buttons row
		const buttonsContainer = append(this._inputContainer, $('.aide-input-buttons'));

		// @ mention button
		const mentionButton = append(buttonsContainer, $('button.aide-button'));
		mentionButton.innerHTML = '<span>@</span>';
		mentionButton.title = 'Add context (@file, @codebase, @web...)';
		this._register(Event.fromDOMEventEmitter<MouseEvent>(mentionButton, 'click')(() => {
			this._insertMentionTrigger();
		}));

		// Codebase search button
		const searchButton = append(buttonsContainer, $('button.aide-button'));
		searchButton.innerHTML = '<span>🔍</span>';
		searchButton.title = 'Search codebase';
		this._register(Event.fromDOMEventEmitter<MouseEvent>(searchButton, 'click')(() => {
			this._inputBox.value += '@codebase:';
			this._inputBox.focus();
		}));

		// File button
		const fileButton = append(buttonsContainer, $('button.aide-button'));
		fileButton.innerHTML = '<span>📄</span>';
		fileButton.title = 'Add file';
		this._register(Event.fromDOMEventEmitter<MouseEvent>(fileButton, 'click')(() => {
			this._inputBox.value += '@file:';
			this._inputBox.focus();
		}));

		// Web button
		const webButton = append(buttonsContainer, $('button.aide-button'));
		webButton.innerHTML = '<span>🌐</span>';
		webButton.title = 'Web search';
		this._register(Event.fromDOMEventEmitter<MouseEvent>(webButton, 'click')(() => {
			this._inputBox.value += '@web:';
			this._inputBox.focus();
		}));

		// Input box wrapper
		const inputWrapper = append(this._inputContainer, $('.aide-input-wrapper'));

		this._inputBox = this._register(new InputBox(
			inputWrapper,
			this._contextViewService,
			{
				placeholder: 'Ask anything, @ for context, / for commands...',
				flexibleHeight: true,
				flexibleMaxHeight: 200,
				inputBoxStyles: defaultInputBoxStyles
			}
		));

		// Action buttons (send/stop)
		const actionButtons = append(inputWrapper, $('.aide-action-buttons'));

		this._sendButton = this._register(new Button(actionButtons, {}));
		this._sendButton.label = '⚡';
		this._sendButton.element.className = 'aide-send-button';
		this._sendButton.element.title = 'Send (Enter)';

		this._stopButton = this._register(new Button(actionButtons, {}));
		this._stopButton.label = '■';
		this._stopButton.element.className = 'aide-stop-button';
		this._stopButton.element.title = 'Stop generation';
		this._stopButton.element.style.display = 'none';
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
		this._register(this._stopButton.onDidClick(() => this.stopGeneration()));

		// Keyboard handling
		this._register(addDisposableListener(this._inputBox.inputElement, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.keyCode === KeyCode.Enter && !e.shiftKey) {
				e.preventDefault();
				if (this._mentionDropdownVisible) {
					this._selectMention();
				} else {
					this._sendMessage();
				}
			} else if (e.keyCode === KeyCode.Escape) {
				this._hideMentionDropdown();
			} else if (e.keyCode === KeyCode.UpArrow && this._mentionDropdownVisible) {
				e.preventDefault();
				this._navigateMention(-1);
			} else if (e.keyCode === KeyCode.DownArrow && this._mentionDropdownVisible) {
				e.preventDefault();
				this._navigateMention(1);
			} else if (e.keyCode === KeyCode.Tab && this._mentionDropdownVisible) {
				e.preventDefault();
				this._selectMention();
			}
		}));

		// Input change - handle @ mentions
		this._register(this._inputBox.onDidChange(value => {
			this._handleInputChange(value);
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

	private _handleInputChange(value: string): void {
		// Check for @ trigger
		const cursorPos = this._inputBox.inputElement.selectionStart || 0;
		const textBeforeCursor = value.slice(0, cursorPos);
		const atMatch = textBeforeCursor.match(/@(\w*)$/);

		if (atMatch) {
			this._mentionQuery = atMatch[1];
			this._showMentionDropdown();
		} else {
			this._hideMentionDropdown();
		}
	}

	private _showMentionDropdown(): void {
		clearNode(this._mentionDropdown);

		const filteredTypes = MENTION_TYPES.filter(t =>
			t.label.toLowerCase().includes(this._mentionQuery.toLowerCase())
		);

		if (filteredTypes.length === 0) {
			this._hideMentionDropdown();
			return;
		}

		this._selectedMentionIndex = 0;

		for (let i = 0; i < filteredTypes.length; i++) {
			const item = filteredTypes[i];
			const itemEl = append(this._mentionDropdown, $('.aide-mention-item'));
			itemEl.innerHTML = `
				<span class="icon">${item.icon}</span>
				<span class="label">@${item.label}</span>
				<span class="description">${item.description}</span>
			`;

			if (i === this._selectedMentionIndex) {
				itemEl.classList.add('selected');
			}

			this._register(Event.fromDOMEventEmitter<MouseEvent>(itemEl, 'click')(() => {
				this._selectedMentionIndex = i;
				this._selectMention();
			}));
		}

		this._mentionDropdown.style.display = 'block';
		this._mentionDropdownVisible = true;
	}

	private _hideMentionDropdown(): void {
		this._mentionDropdown.style.display = 'none';
		this._mentionDropdownVisible = false;
	}

	private _navigateMention(direction: number): void {
		const items = this._mentionDropdown.querySelectorAll('.aide-mention-item');
		if (items.length === 0) return;

		items[this._selectedMentionIndex]?.classList.remove('selected');
		this._selectedMentionIndex = Math.max(0, Math.min(items.length - 1, this._selectedMentionIndex + direction));
		items[this._selectedMentionIndex]?.classList.add('selected');
	}

	private _selectMention(): void {
		const filteredTypes = MENTION_TYPES.filter(t =>
			t.label.toLowerCase().includes(this._mentionQuery.toLowerCase())
		);

		if (filteredTypes[this._selectedMentionIndex]) {
			const selected = filteredTypes[this._selectedMentionIndex];
			const value = this._inputBox.value;
			const cursorPos = this._inputBox.inputElement.selectionStart || 0;
			const textBeforeCursor = value.slice(0, cursorPos);
			const textAfterCursor = value.slice(cursorPos);

			// Replace @query with @type:
			const newTextBefore = textBeforeCursor.replace(/@\w*$/, `@${selected.label}:`);
			this._inputBox.value = newTextBefore + textAfterCursor;

			// Set cursor after the colon
			setTimeout(() => {
				this._inputBox.inputElement.setSelectionRange(newTextBefore.length, newTextBefore.length);
			}, 0);
		}

		this._hideMentionDropdown();
	}

	private _insertMentionTrigger(): void {
		this._inputBox.value += '@';
		this._inputBox.focus();
		this._mentionQuery = '';
		this._showMentionDropdown();
	}

	private async _loadModels(): Promise<void> {
		this._models = await this._aideService.getAvailableModels();

		const options = this._models.length > 0
			? this._models.map(m => ({ text: m.name }))
			: [{ text: 'Configure API Key...' }];

		this._modelSelect.setOptions(options);

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
				content: m.content.filter(c => c.type === 'text').map(c => c.text || '').join(''),
				toolCalls: m.content.filter(c => c.type === 'tool_call').map(c => ({
					name: c.toolName || '',
					args: c.toolArguments || {}
				}))
			}));
			this._messagesList.splice(0, this._messagesList.length, this._messages);

			// Update visibility
			this._updateEmptyState();

			// Scroll to bottom
			if (this._messages.length > 0) {
				this._messagesList.reveal(this._messages.length - 1);
			}
		} else {
			this._messages = [];
			this._messagesList.splice(0, this._messagesList.length);
			this._updateEmptyState();
		}

		this._updateAttachmentsUI();
		this._updateStatusBar();
	}

	private _updateEmptyState(): void {
		if (this._messages.length === 0) {
			this._emptyState.style.display = 'flex';
			this._messagesContainer.style.display = 'none';
		} else {
			this._emptyState.style.display = 'none';
			this._messagesContainer.style.display = 'flex';
		}
	}

	private _updateStatusBar(): void {
		if (this._isGenerating) {
			this._statusBar.innerHTML = '<span class="aide-status-dot processing"></span> Processing...';
		} else if (this._currentAgent) {
			const mode = this._currentAgent.mode.toUpperCase();
			this._statusBar.innerHTML = `<span class="aide-status-dot active"></span> ${mode} MODE ACTIVE`;
		} else {
			this._statusBar.innerHTML = '<span class="aide-status-dot active"></span> READY';
		}
	}

	private async _sendMessage(): Promise<void> {
		const content = this._inputBox.value.trim();
		if (!content || !this._currentAgent || this._isGenerating) {
			return;
		}

		// Clear input
		this._inputBox.value = '';
		this._hideMentionDropdown();

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
		this._updateEmptyState();

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

		// Update UI state
		this._isGenerating = true;
		this._sendButton.element.style.display = 'none';
		this._stopButton.element.style.display = 'block';
		this._updateStatusBar();

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

				// Handle tool calls
				if (chunk.delta.toolName) {
					if (!assistantMessage.toolCalls) {
						assistantMessage.toolCalls = [];
					}
					assistantMessage.toolCalls.push({
						name: chunk.delta.toolName,
						args: chunk.delta.toolArguments || {}
					});
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
			this._isGenerating = false;
			this._sendButton.element.style.display = 'block';
			this._stopButton.element.style.display = 'none';
			this._updateStatusBar();
		}
	}

	private _updateAttachmentsUI(): void {
		clearNode(this._attachmentsContainer);

		for (const attachment of this._attachments) {
			const chip = append(this._attachmentsContainer, $('.aide-attachment-chip'));
			chip.innerHTML = `<span class="name">${this._escapeHtml(attachment.name)}</span>`;
			chip.title = attachment.preview || '';

			const removeButton = append(chip, $('span.remove'));
			removeButton.textContent = '×';
			this._register(Event.fromDOMEventEmitter<MouseEvent>(removeButton, 'click')(() => {
				this._attachments = this._attachments.filter(a => a.id !== attachment.id);
				this._updateAttachmentsUI();
			}));
		}
	}

	private _escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
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
