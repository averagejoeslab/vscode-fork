/*---------------------------------------------------------------------------------------------
 *  AIDE - AI Development Environment
 *  Modern AI Assistant Interface
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
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
}

interface IMentionItem {
	type: AideContextType;
	label: string;
	description: string;
	icon: string;
}

const MENTION_TYPES: IMentionItem[] = [
	{ type: AideContextType.File, label: 'file', description: 'Add a file', icon: '📄' },
	{ type: AideContextType.Folder, label: 'folder', description: 'Add a folder', icon: '📁' },
	{ type: AideContextType.Codebase, label: 'codebase', description: 'Search codebase', icon: '🔍' },
	{ type: AideContextType.Web, label: 'web', description: 'Search the web', icon: '🌐' },
	{ type: AideContextType.Terminal, label: 'terminal', description: 'Terminal output', icon: '💻' },
	{ type: AideContextType.Git, label: 'git', description: 'Git changes', icon: '📊' },
	{ type: AideContextType.Problems, label: 'problems', description: 'Current errors', icon: '⚠️' },
	{ type: AideContextType.Docs, label: 'docs', description: 'Documentation', icon: '📚' }
];

const MODE_OPTIONS = [
	{ mode: AideMode.Agent, label: 'Agent', icon: '⚡' },
	{ mode: AideMode.Ask, label: 'Ask', icon: '💬' },
	{ mode: AideMode.Plan, label: 'Plan', icon: '📋' },
	{ mode: AideMode.Debug, label: 'Debug', icon: '🔧' }
];

// ============================================================================
// Composer Widget
// ============================================================================

export class ComposerWidget extends Disposable {
	private _container: HTMLElement;
	private _messagesArea!: HTMLElement;
	private _welcomeScreen!: HTMLElement;
	private _inputArea!: HTMLElement;
	private _textarea!: HTMLTextAreaElement;
	private _mentionDropdown!: HTMLElement;

	private _currentAgent: IAideAgent | undefined;
	private _messages: IComposerMessage[] = [];
	private _attachments: IAideAttachment[] = [];
	private _models: IAideModelInfo[] = [];
	private _currentMode: AideMode = AideMode.Agent;
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
		this._buildUI();
		this._loadModels();
	}

	private _buildUI(): void {
		this._container.className = 'aide-root';

		// Main layout wrapper
		const wrapper = append(this._container, $('.aide-wrapper'));

		// Welcome/Empty state (centered)
		this._welcomeScreen = append(wrapper, $('.aide-welcome'));
		this._buildWelcomeScreen();

		// Messages area (hidden initially)
		this._messagesArea = append(wrapper, $('.aide-messages'));
		this._messagesArea.style.display = 'none';

		// Mention dropdown (hidden)
		this._mentionDropdown = append(wrapper, $('.aide-mentions'));
		this._mentionDropdown.style.display = 'none';

		// Input area at bottom
		this._inputArea = append(wrapper, $('.aide-input-area'));
		this._buildInputArea();
	}

	private _buildWelcomeScreen(): void {
		// Logo
		const logo = append(this._welcomeScreen, $('.aide-logo'));
		const logoIcon = append(logo, $('.aide-logo-icon'));
		logoIcon.textContent = '◆';

		// Title
		const title = append(this._welcomeScreen, $('.aide-title'));
		title.textContent = 'What can I help you build?';

		// Subtitle
		const subtitle = append(this._welcomeScreen, $('.aide-subtitle'));
		subtitle.textContent = 'I can help you write code, debug issues, and answer questions about your codebase.';

		// Quick actions
		const actions = append(this._welcomeScreen, $('.aide-quick-actions'));

		const suggestions = [
			{ icon: '📝', text: 'Explain this code' },
			{ icon: '🐛', text: 'Fix this error' },
			{ icon: '✨', text: 'Add a feature' },
			{ icon: '🔄', text: 'Refactor code' }
		];

		for (const suggestion of suggestions) {
			const btn = append(actions, $('.aide-suggestion'));
			const icon = append(btn, $('span.icon'));
			icon.textContent = suggestion.icon;
			const text = append(btn, $('span.text'));
			text.textContent = suggestion.text;

			this._register(addDisposableListener(btn, EventType.CLICK, () => {
				this._textarea.value = suggestion.text;
				this._textarea.focus();
			}));
		}
	}

	private _buildInputArea(): void {
		// Mode tabs
		const modeTabs = append(this._inputArea, $('.aide-mode-tabs'));
		for (const opt of MODE_OPTIONS) {
			const tab = append(modeTabs, $('.aide-mode-tab'));
			tab.dataset.mode = opt.mode;
			if (opt.mode === this._currentMode) {
				tab.classList.add('active');
			}

			const icon = append(tab, $('span.icon'));
			icon.textContent = opt.icon;
			const label = append(tab, $('span.label'));
			label.textContent = opt.label;

			this._register(addDisposableListener(tab, EventType.CLICK, () => {
				this._setMode(opt.mode);
			}));
		}

		// Input container
		const inputContainer = append(this._inputArea, $('.aide-input-container'));

		// Context buttons
		const contextBtns = append(inputContainer, $('.aide-context-btns'));

		const atBtn = append(contextBtns, $('button.aide-ctx-btn'));
		atBtn.textContent = '@';
		atBtn.title = 'Add context';
		this._register(addDisposableListener(atBtn, EventType.CLICK, () => {
			this._insertAtSymbol();
		}));

		// Textarea
		this._textarea = append(inputContainer, $('textarea.aide-textarea')) as HTMLTextAreaElement;
		this._textarea.placeholder = 'Ask anything... (@ for files, / for commands)';
		this._textarea.rows = 1;

		// Auto-resize textarea
		this._register(addDisposableListener(this._textarea, EventType.INPUT, () => {
			this._autoResizeTextarea();
			this._handleMentionTrigger();
		}));

		// Keyboard handling
		this._register(addDisposableListener(this._textarea, EventType.KEY_DOWN, (e: KeyboardEvent) => {
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

		// Send button
		const sendBtn = append(inputContainer, $('button.aide-send-btn'));
		sendBtn.textContent = '→';
		sendBtn.title = 'Send message';
		this._register(addDisposableListener(sendBtn, EventType.CLICK, () => {
			this._sendMessage();
		}));

		// Footer hint
		const footer = append(this._inputArea, $('.aide-footer'));
		footer.textContent = 'Press Enter to send, Shift+Enter for new line';
	}

	private _autoResizeTextarea(): void {
		this._textarea.style.height = 'auto';
		const maxHeight = 200;
		this._textarea.style.height = Math.min(this._textarea.scrollHeight, maxHeight) + 'px';
	}

	private _setMode(mode: AideMode): void {
		this._currentMode = mode;

		// Update tabs
		const tabs = this._inputArea.querySelectorAll('.aide-mode-tab');
		tabs.forEach(tab => {
			const el = tab as HTMLElement;
			el.classList.toggle('active', el.dataset.mode === mode);
		});

		// Update agent if exists
		if (this._currentAgent) {
			this._aideService.updateAgent(this._currentAgent.id, { mode });
		}
	}

	private _insertAtSymbol(): void {
		const start = this._textarea.selectionStart;
		const end = this._textarea.selectionEnd;
		const value = this._textarea.value;
		this._textarea.value = value.slice(0, start) + '@' + value.slice(end);
		this._textarea.selectionStart = this._textarea.selectionEnd = start + 1;
		this._textarea.focus();
		this._mentionQuery = '';
		this._showMentionDropdown();
	}

	private _handleMentionTrigger(): void {
		const value = this._textarea.value;
		const cursorPos = this._textarea.selectionStart;
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
			const row = append(this._mentionDropdown, $('.aide-mention-row'));

			if (i === this._selectedMentionIndex) {
				row.classList.add('selected');
			}

			const icon = append(row, $('span.icon'));
			icon.textContent = item.icon;
			const label = append(row, $('span.label'));
			label.textContent = '@' + item.label;
			const desc = append(row, $('span.desc'));
			desc.textContent = item.description;

			this._register(addDisposableListener(row, EventType.CLICK, () => {
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
		const items = this._mentionDropdown.querySelectorAll('.aide-mention-row');
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
			const value = this._textarea.value;
			const cursorPos = this._textarea.selectionStart;
			const textBeforeCursor = value.slice(0, cursorPos);
			const textAfterCursor = value.slice(cursorPos);

			const newTextBefore = textBeforeCursor.replace(/@\w*$/, `@${selected.label}:`);
			this._textarea.value = newTextBefore + textAfterCursor;
			this._textarea.selectionStart = this._textarea.selectionEnd = newTextBefore.length;
			this._textarea.focus();
		}

		this._hideMentionDropdown();
	}

	private async _loadModels(): Promise<void> {
		this._models = await this._aideService.getAvailableModels();
	}

	private _addMessage(role: AideMessageRole, content: string, isStreaming = false): IComposerMessage {
		const msg: IComposerMessage = {
			id: generateUuid(),
			role,
			content,
			isStreaming
		};
		this._messages.push(msg);
		this._renderMessages();
		return msg;
	}

	private _updateMessage(id: string, content: string, isStreaming = false): void {
		const msg = this._messages.find(m => m.id === id);
		if (msg) {
			msg.content = content;
			msg.isStreaming = isStreaming;
			this._renderMessages();
		}
	}

	private _renderMessages(): void {
		// Show/hide welcome vs messages
		if (this._messages.length === 0) {
			this._welcomeScreen.style.display = 'flex';
			this._messagesArea.style.display = 'none';
			return;
		}

		this._welcomeScreen.style.display = 'none';
		this._messagesArea.style.display = 'flex';

		clearNode(this._messagesArea);

		for (const msg of this._messages) {
			const bubble = append(this._messagesArea, $('.aide-bubble'));
			bubble.classList.add(msg.role === AideMessageRole.User ? 'user' : 'assistant');

			if (msg.role === AideMessageRole.Assistant) {
				const avatar = append(bubble, $('.aide-avatar'));
				avatar.textContent = '◆';
			}

			const content = append(bubble, $('.aide-content'));
			content.textContent = msg.content;

			if (msg.isStreaming) {
				content.classList.add('streaming');
			}
		}

		// Scroll to bottom
		this._messagesArea.scrollTop = this._messagesArea.scrollHeight;
	}

	private async _sendMessage(): Promise<void> {
		const content = this._textarea.value.trim();
		if (!content || this._isGenerating) return;

		// Ensure we have an agent
		if (!this._currentAgent) {
			this._currentAgent = await this._aideService.createAgent();
		}

		// Clear input
		this._textarea.value = '';
		this._autoResizeTextarea();
		this._hideMentionDropdown();

		// Parse mentions
		const mentions = this._contextService.parseMentions(content);
		let attachments = [...this._attachments];
		if (mentions.length > 0) {
			const resolved = await this._contextService.resolveAttachments(mentions, CancellationToken.None);
			attachments = [...attachments, ...resolved];
		}

		// Add user message
		this._addMessage(AideMessageRole.User, content);

		// Add streaming assistant message
		const assistantMsg = this._addMessage(AideMessageRole.Assistant, '', true);

		// Update state
		this._isGenerating = true;
		this._attachments = [];
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
					this._updateMessage(assistantMsg.id, fullContent, true);
				}
			}
			this._updateMessage(assistantMsg.id, fullContent, false);
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			this._updateMessage(assistantMsg.id, `Error: ${errMsg}`, false);
		} finally {
			this._currentTokenSource?.dispose();
			this._currentTokenSource = undefined;
			this._isGenerating = false;
		}
	}

	public async createNewAgent(): Promise<void> {
		this._currentAgent = await this._aideService.createAgent();
		this._messages = [];
		this._renderMessages();
	}

	public stopGeneration(): void {
		this._currentTokenSource?.cancel();
	}

	public focus(): void {
		this._textarea?.focus();
	}

	override dispose(): void {
		this._currentTokenSource?.dispose();
		super.dispose();
	}
}
