/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { ICodeEditor, IEditorMouseEvent } from '../../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAideService, AideMessageRole } from '../../../../services/aide/common/aideService.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { InlineCompletionsController } from '../../../../../editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.js';

export const AIDE_TAB_COMPLETION_CONTEXT = new RawContextKey<boolean>('aideTabCompletionActive', false);

interface ITabCompletionState {
	position: Position;
	prefix: string;
	suffix: string;
	completion: string;
	range: Range;
}

export class AideTabCompletionController extends Disposable implements IEditorContribution {
	public static readonly ID = 'editor.contrib.aideTabCompletion';

	private readonly _debounceScheduler: RunOnceScheduler;
	private readonly _currentRequest = this._register(new MutableDisposable<CancellationTokenSource>());
	private _state: ITabCompletionState | undefined;
	private _enabled: boolean = true;
	private _debounceMs: number = 150;
	private _maxTokens: number = 256;

	constructor(
		private readonly _editor: ICodeEditor,
		@IAideService private readonly _aideService: IAideService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService
	) {
		super();

		this._loadConfiguration();

		// Debounced completion trigger
		this._debounceScheduler = this._register(new RunOnceScheduler(() => {
			this._triggerCompletion();
		}, this._debounceMs));

		// Register listeners
		this._register(this._editor.onDidChangeModelContent(() => {
			this._onContentChange();
		}));

		this._register(this._editor.onDidChangeCursorPosition(() => {
			this._onCursorChange();
		}));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('aide.tabCompletion')) {
				this._loadConfiguration();
			}
		}));
	}

	private _loadConfiguration(): void {
		this._enabled = this._configurationService.getValue<boolean>('aide.tabCompletion.enabled') ?? true;
		this._debounceMs = this._configurationService.getValue<number>('aide.tabCompletion.debounceMs') ?? 150;
		this._maxTokens = this._configurationService.getValue<number>('aide.tabCompletion.maxTokens') ?? 256;
	}

	private _onContentChange(): void {
		if (!this._enabled) {
			return;
		}

		// Cancel any pending request
		this._currentRequest.clear();
		this._state = undefined;

		// Schedule new completion request
		this._debounceScheduler.schedule();
	}

	private _onCursorChange(): void {
		// Clear current completion if cursor moved outside completion range
		if (this._state) {
			const position = this._editor.getPosition();
			if (position && !this._state.range.containsPosition(position)) {
				this._state = undefined;
			}
		}
	}

	private async _triggerCompletion(): Promise<void> {
		if (!this._enabled) {
			return;
		}

		const model = this._editor.getModel();
		const position = this._editor.getPosition();

		if (!model || !position) {
			return;
		}

		// Get context around cursor
		const { prefix, suffix } = this._getContext(model, position);

		// Don't trigger if no meaningful prefix
		if (prefix.trim().length < 3) {
			return;
		}

		// Cancel previous request
		this._currentRequest.clear();

		const tokenSource = new CancellationTokenSource();
		this._currentRequest.value = tokenSource;

		try {
			const completion = await this._requestCompletion(prefix, suffix, model.getLanguageId(), tokenSource.token);

			if (tokenSource.token.isCancellationRequested) {
				return;
			}

			if (completion) {
				this._state = {
					position,
					prefix,
					suffix,
					completion,
					range: new Range(
						position.lineNumber,
						position.column,
						position.lineNumber,
						position.column + completion.length
					)
				};

				// Show the completion using ghost text
				this._showGhostText(completion, position);
			}
		} catch (error) {
			this._logService.error('[AideTabCompletion] Error requesting completion:', error);
		}
	}

	private _getContext(model: ITextModel, position: Position): { prefix: string; suffix: string } {
		const lineCount = model.getLineCount();

		// Get prefix (lines before and current line up to cursor)
		const prefixLines: string[] = [];
		const startLine = Math.max(1, position.lineNumber - 50); // Up to 50 lines before

		for (let i = startLine; i < position.lineNumber; i++) {
			prefixLines.push(model.getLineContent(i));
		}

		const currentLine = model.getLineContent(position.lineNumber);
		prefixLines.push(currentLine.substring(0, position.column - 1));

		const prefix = prefixLines.join('\n');

		// Get suffix (rest of current line and lines after)
		const suffixLines: string[] = [];
		suffixLines.push(currentLine.substring(position.column - 1));

		const endLine = Math.min(lineCount, position.lineNumber + 20); // Up to 20 lines after
		for (let i = position.lineNumber + 1; i <= endLine; i++) {
			suffixLines.push(model.getLineContent(i));
		}

		const suffix = suffixLines.join('\n');

		return { prefix, suffix };
	}

	private async _requestCompletion(prefix: string, suffix: string, languageId: string, token: CancellationToken): Promise<string | undefined> {
		const defaultModel = await this._aideService.getDefaultModel();
		if (!defaultModel) {
			return undefined;
		}

		// Build a prompt for code completion
		const prompt = `You are a code completion assistant. Complete the code at the cursor position marked by <CURSOR>.
Only output the completion text, nothing else. Do not repeat the prefix or include explanations.

Language: ${languageId}

Code:
${prefix}<CURSOR>${suffix}

Completion:`;

		try {
			// Use the AIDE service to get completion
			const response = await this._aideService.sendMessage(
				'completion-temp', // We'll need a special completion agent
				prompt,
				undefined,
				token
			);

			const completion = response.content
				.filter(c => c.type === 'text')
				.map(c => c.text || '')
				.join('');

			return completion.trim();
		} catch (error) {
			// Fallback: just return undefined
			return undefined;
		}
	}

	private _showGhostText(completion: string, position: Position): void {
		// This would integrate with VSCode's inline completion system
		// For now, we'll use a simple approach

		// The proper implementation would use:
		// - InlineCompletionsProvider to provide completions
		// - Ghost text decorations to show the completion

		this._logService.trace('[AideTabCompletion] Would show ghost text:', completion);
	}

	public acceptCompletion(): boolean {
		if (!this._state) {
			return false;
		}

		const { completion, position } = this._state;

		// Insert the completion
		this._editor.executeEdits('aideTabCompletion', [{
			range: new Range(
				position.lineNumber,
				position.column,
				position.lineNumber,
				position.column
			),
			text: completion
		}]);

		this._state = undefined;
		return true;
	}

	public acceptCompletionWord(): boolean {
		if (!this._state) {
			return false;
		}

		const { completion, position } = this._state;

		// Find the next word boundary
		const wordMatch = completion.match(/^\S+\s?/);
		if (!wordMatch) {
			return false;
		}

		const word = wordMatch[0];

		// Insert just the word
		this._editor.executeEdits('aideTabCompletion', [{
			range: new Range(
				position.lineNumber,
				position.column,
				position.lineNumber,
				position.column
			),
			text: word
		}]);

		// Update state for remaining completion
		this._state = {
			...this._state,
			completion: completion.substring(word.length),
			position: new Position(position.lineNumber, position.column + word.length)
		};

		if (this._state.completion.length === 0) {
			this._state = undefined;
		}

		return true;
	}

	public rejectCompletion(): void {
		this._state = undefined;
		this._currentRequest.clear();
	}

	public hasActiveCompletion(): boolean {
		return !!this._state;
	}

	public static get(editor: ICodeEditor): AideTabCompletionController | null {
		return editor.getContribution<AideTabCompletionController>(AideTabCompletionController.ID);
	}
}
