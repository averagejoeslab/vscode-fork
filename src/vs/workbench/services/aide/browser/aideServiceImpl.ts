/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService } from '../../../contrib/terminal/browser/terminal.js';
import { ISearchService, QueryType } from '../../search/common/search.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import {
	AideMode,
	AideMessageRole,
	IAideAgent,
	IAideAttachment,
	IAideCompletionRequest,
	IAideEmbeddingProvider,
	IAideMessage,
	IAideMessageContent,
	IAideModelInfo,
	IAideModelProvider,
	IAideService,
	IAideStreamChunk,
	IAideTool,
	IAideToolResult
} from '../common/aideService.js';

const AGENTS_STORAGE_KEY = 'aide.agents';
const DEFAULT_MODEL_STORAGE_KEY = 'aide.defaultModel';

export class AideService extends Disposable implements IAideService {
	declare readonly _serviceBrand: undefined;

	private readonly _modelProviders = new Map<string, IAideModelProvider>();
	private readonly _embeddingProviders = new Map<string, IAideEmbeddingProvider>();
	private readonly _tools = new Map<string, { tool: IAideTool; handler: (args: Record<string, unknown>) => Promise<unknown> }>();
	private readonly _agents = new Map<string, IAideAgent>();
	private _activeAgentId: string | undefined;
	private _defaultModelId: string | undefined;

	private readonly _onDidChangeAgents = this._register(new Emitter<void>());
	readonly onDidChangeAgents = this._onDidChangeAgents.event;

	private readonly _onDidChangeModels = this._register(new Emitter<void>());
	readonly onDidChangeModels = this._onDidChangeModels.event;

	private readonly _onDidChangeActiveAgent = this._register(new Emitter<IAideAgent | undefined>());
	readonly onDidChangeActiveAgent = this._onDidChangeActiveAgent.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationService _configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ISearchService private readonly _searchService: ISearchService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();

		this._loadAgents();
		this._loadDefaultModel();

		// Register built-in tools (deferred to allow terminal service to load)
		setTimeout(() => this._registerBuiltInTools(), 100);
	}

	// ========================================================================
	// Model Providers
	// ========================================================================

	registerModelProvider(provider: IAideModelProvider): IDisposable {
		if (this._modelProviders.has(provider.id)) {
			throw new Error(`Model provider with id '${provider.id}' already registered`);
		}

		this._modelProviders.set(provider.id, provider);
		this._logService.info(`[AIDE] Registered model provider: ${provider.name} (${provider.id})`);

		const disposables = new DisposableStore();
		disposables.add(provider.onDidChangeModels(() => {
			this._onDidChangeModels.fire();
		}));

		this._onDidChangeModels.fire();

		return toDisposable(() => {
			this._modelProviders.delete(provider.id);
			disposables.dispose();
			this._onDidChangeModels.fire();
		});
	}

	getModelProviders(): IAideModelProvider[] {
		return Array.from(this._modelProviders.values());
	}

	async getAvailableModels(): Promise<IAideModelInfo[]> {
		const models: IAideModelInfo[] = [];
		for (const provider of this._modelProviders.values()) {
			try {
				const providerModels = await provider.getAvailableModels();
				models.push(...providerModels);
			} catch (error) {
				this._logService.error(`[AIDE] Failed to get models from provider ${provider.id}:`, error);
			}
		}
		return models;
	}

	async getDefaultModel(): Promise<IAideModelInfo | undefined> {
		const models = await this.getAvailableModels();
		if (this._defaultModelId) {
			const model = models.find(m => m.id === this._defaultModelId);
			if (model) {
				return model;
			}
		}
		return models[0];
	}

	async setDefaultModel(modelId: string): Promise<void> {
		this._defaultModelId = modelId;
		this._storageService.store(DEFAULT_MODEL_STORAGE_KEY, modelId, StorageScope.PROFILE, StorageTarget.USER);
		this._onDidChangeModels.fire();
	}

	// ========================================================================
	// Embedding Providers
	// ========================================================================

	registerEmbeddingProvider(provider: IAideEmbeddingProvider): IDisposable {
		if (this._embeddingProviders.has(provider.id)) {
			throw new Error(`Embedding provider with id '${provider.id}' already registered`);
		}

		this._embeddingProviders.set(provider.id, provider);
		this._logService.info(`[AIDE] Registered embedding provider: ${provider.name} (${provider.id})`);

		return toDisposable(() => {
			this._embeddingProviders.delete(provider.id);
		});
	}

	getEmbeddingProviders(): IAideEmbeddingProvider[] {
		return Array.from(this._embeddingProviders.values());
	}

	// ========================================================================
	// Agent Management
	// ========================================================================

	async createAgent(name?: string, mode: AideMode = AideMode.Agent): Promise<IAideAgent> {
		const defaultModel = await this.getDefaultModel();
		const agent: IAideAgent = {
			id: generateUuid(),
			name: name || `Agent ${this._agents.size + 1}`,
			createdAt: Date.now(),
			lastActiveAt: Date.now(),
			mode,
			model: defaultModel?.id || '',
			messages: [],
			attachments: []
		};

		this._agents.set(agent.id, agent);
		this._activeAgentId = agent.id;
		this._saveAgents();
		this._onDidChangeAgents.fire();
		this._onDidChangeActiveAgent.fire(agent);

		return agent;
	}

	getAgents(): IAideAgent[] {
		return Array.from(this._agents.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
	}

	getAgent(id: string): IAideAgent | undefined {
		return this._agents.get(id);
	}

	getActiveAgent(): IAideAgent | undefined {
		return this._activeAgentId ? this._agents.get(this._activeAgentId) : undefined;
	}

	setActiveAgent(id: string): void {
		if (!this._agents.has(id)) {
			throw new Error(`Agent with id '${id}' not found`);
		}
		this._activeAgentId = id;
		const agent = this._agents.get(id)!;
		agent.lastActiveAt = Date.now();
		this._saveAgents();
		this._onDidChangeActiveAgent.fire(agent);
	}

	async deleteAgent(id: string): Promise<void> {
		if (!this._agents.has(id)) {
			return;
		}

		this._agents.delete(id);

		if (this._activeAgentId === id) {
			const agents = this.getAgents();
			this._activeAgentId = agents.length > 0 ? agents[0].id : undefined;
		}

		this._saveAgents();
		this._onDidChangeAgents.fire();
		this._onDidChangeActiveAgent.fire(this.getActiveAgent());
	}

	updateAgent(id: string, updates: Partial<Pick<IAideAgent, 'name' | 'mode' | 'model'>>): void {
		const agent = this._agents.get(id);
		if (!agent) {
			throw new Error(`Agent with id '${id}' not found`);
		}

		Object.assign(agent, updates, { lastActiveAt: Date.now() });
		this._saveAgents();
		this._onDidChangeAgents.fire();

		if (this._activeAgentId === id) {
			this._onDidChangeActiveAgent.fire(agent);
		}
	}

	// ========================================================================
	// Chat
	// ========================================================================

	async sendMessage(
		agentId: string,
		content: string,
		attachments?: IAideAttachment[],
		token: CancellationToken = CancellationToken.None
	): Promise<IAideMessage> {
		const agent = this._agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent with id '${agentId}' not found`);
		}

		// Add user message
		const userMessage: IAideMessage = {
			id: generateUuid(),
			role: AideMessageRole.User,
			content: [{ type: 'text', text: content }],
			timestamp: Date.now()
		};
		agent.messages.push(userMessage);

		// Add attachments
		if (attachments) {
			agent.attachments = [...agent.attachments, ...attachments];
		}

		// Find the provider for this model
		const provider = this._findProviderForModel(agent.model);
		if (!provider) {
			throw new Error(`No provider found for model '${agent.model}'`);
		}

		// Build the request
		const request = this._buildCompletionRequest(agent);

		// Get completion
		const response = await provider.chat(request, token);

		// Add assistant message
		const assistantMessage: IAideMessage = {
			id: response.id,
			role: AideMessageRole.Assistant,
			content: response.content,
			timestamp: Date.now(),
			model: response.model,
			tokens: response.usage ? {
				input: response.usage.inputTokens,
				output: response.usage.outputTokens
			} : undefined
		};
		agent.messages.push(assistantMessage);

		// Handle tool calls
		if (response.finishReason === 'tool_calls') {
			await this._handleToolCalls(agent, response.content, token);
		}

		agent.lastActiveAt = Date.now();
		this._saveAgents();
		this._onDidChangeAgents.fire();

		return assistantMessage;
	}

	async *sendMessageStream(
		agentId: string,
		content: string,
		attachments?: IAideAttachment[],
		token: CancellationToken = CancellationToken.None
	): AsyncIterable<IAideStreamChunk> {
		const agent = this._agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent with id '${agentId}' not found`);
		}

		// Add user message
		const userMessage: IAideMessage = {
			id: generateUuid(),
			role: AideMessageRole.User,
			content: [{ type: 'text', text: content }],
			timestamp: Date.now()
		};
		agent.messages.push(userMessage);

		// Add attachments
		if (attachments) {
			agent.attachments = [...agent.attachments, ...attachments];
		}

		// Find the provider for this model
		const provider = this._findProviderForModel(agent.model);
		if (!provider) {
			throw new Error(`No provider found for model '${agent.model}'`);
		}

		// Build the request
		const request = this._buildCompletionRequest(agent);
		request.stream = true;

		// Stream completion
		const accumulatedContent: IAideMessageContent[] = [];
		let lastChunk: IAideStreamChunk | undefined;

		for await (const chunk of provider.chatStream(request, token)) {
			// Accumulate content
			if (chunk.delta.text) {
				const existingText = accumulatedContent.find(c => c.type === 'text');
				if (existingText) {
					existingText.text = (existingText.text || '') + chunk.delta.text;
				} else {
					accumulatedContent.push({ type: 'text', text: chunk.delta.text });
				}
			}
			if (chunk.delta.toolName) {
				accumulatedContent.push({
					type: 'tool_call',
					toolCallId: chunk.delta.toolCallId,
					toolName: chunk.delta.toolName,
					toolArguments: chunk.delta.toolArguments
				});
			}

			lastChunk = chunk;
			yield chunk;
		}

		// Add assistant message
		const assistantMessage: IAideMessage = {
			id: lastChunk?.id || generateUuid(),
			role: AideMessageRole.Assistant,
			content: accumulatedContent,
			timestamp: Date.now(),
			model: agent.model
		};
		agent.messages.push(assistantMessage);

		// Handle tool calls if needed
		if (lastChunk?.finishReason === 'tool_calls') {
			await this._handleToolCalls(agent, accumulatedContent, token);
		}

		agent.lastActiveAt = Date.now();
		this._saveAgents();
		this._onDidChangeAgents.fire();
	}

	// ========================================================================
	// Tools
	// ========================================================================

	registerTool(tool: IAideTool, handler: (args: Record<string, unknown>) => Promise<unknown>): IDisposable {
		if (this._tools.has(tool.name)) {
			throw new Error(`Tool with name '${tool.name}' already registered`);
		}

		this._tools.set(tool.name, { tool, handler });
		this._logService.info(`[AIDE] Registered tool: ${tool.name}`);

		return toDisposable(() => {
			this._tools.delete(tool.name);
		});
	}

	async executeToolCall(toolName: string, args: Record<string, unknown>): Promise<IAideToolResult> {
		const toolEntry = this._tools.get(toolName);
		if (!toolEntry) {
			return {
				toolCallId: generateUuid(),
				result: `Tool '${toolName}' not found`,
				isError: true
			};
		}

		try {
			const result = await toolEntry.handler(args);
			return {
				toolCallId: generateUuid(),
				result
			};
		} catch (error) {
			return {
				toolCallId: generateUuid(),
				result: error instanceof Error ? error.message : String(error),
				isError: true
			};
		}
	}

	// ========================================================================
	// Utility
	// ========================================================================

	async countTokens(text: string, model?: string): Promise<number> {
		const targetModel = model || this._defaultModelId;
		if (!targetModel) {
			// Simple approximation: ~4 characters per token
			return Math.ceil(text.length / 4);
		}

		const provider = this._findProviderForModel(targetModel);
		if (provider) {
			return provider.countTokens(text, targetModel);
		}

		// Fallback approximation
		return Math.ceil(text.length / 4);
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	private _findProviderForModel(modelId: string): IAideModelProvider | undefined {
		for (const provider of this._modelProviders.values()) {
			if (modelId.startsWith(provider.id + '/') || modelId.startsWith(provider.id + ':')) {
				return provider;
			}
		}
		// Try to find by checking available models
		for (const provider of this._modelProviders.values()) {
			return provider; // Return first available provider as fallback
		}
		return undefined;
	}

	private _buildCompletionRequest(agent: IAideAgent): IAideCompletionRequest {
		const tools = agent.mode === AideMode.Agent
			? Array.from(this._tools.values()).map(t => t.tool)
			: undefined;

		// Build system prompt based on mode
		const systemPrompt = this._buildSystemPrompt(agent.mode);

		const messages: IAideMessage[] = [
			{
				id: 'system',
				role: AideMessageRole.System,
				content: [{ type: 'text', text: systemPrompt }],
				timestamp: 0
			},
			...agent.messages
		];

		return {
			messages,
			model: agent.model,
			tools,
			stream: false
		};
	}

	private _buildSystemPrompt(mode: AideMode): string {
		switch (mode) {
			case AideMode.Agent:
				return `You are AIDE, an AI-powered coding assistant integrated into an IDE. You have access to tools that allow you to read files, write files, search the codebase, and execute terminal commands. Use these tools to help the user with their coding tasks. Be concise and helpful.`;

			case AideMode.Plan:
				return `You are AIDE in planning mode. Analyze the user's request and create a detailed step-by-step plan to accomplish their goal. Break down complex tasks into manageable steps. Consider edge cases and potential issues. Do not execute any actions, only plan.`;

			case AideMode.Debug:
				return `You are AIDE in debugging mode. Help the user identify and fix bugs in their code. Analyze error messages, stack traces, and code logic. Suggest specific fixes and explain the root cause of issues.`;

			case AideMode.Ask:
				return `You are AIDE in ask mode. Answer the user's questions about their codebase, programming concepts, or best practices. Provide clear explanations with code examples when helpful. Do not make any changes to files.`;

			default:
				return `You are AIDE, an AI-powered coding assistant. Help the user with their coding tasks.`;
		}
	}

	private async _handleToolCalls(
		agent: IAideAgent,
		content: IAideMessageContent[],
		token: CancellationToken
	): Promise<void> {
		const toolCalls = content.filter(c => c.type === 'tool_call');

		for (const toolCall of toolCalls) {
			if (token.isCancellationRequested) {
				break;
			}

			const result = await this.executeToolCall(
				toolCall.toolName!,
				toolCall.toolArguments || {}
			);

			// Add tool result message
			const toolResultMessage: IAideMessage = {
				id: generateUuid(),
				role: AideMessageRole.Tool,
				content: [{
					type: 'tool_result',
					toolCallId: toolCall.toolCallId,
					toolResult: result.result,
					isError: result.isError
				}],
				timestamp: Date.now()
			};
			agent.messages.push(toolResultMessage);
		}
	}

	private _registerBuiltInTools(): void {
		// Read File Tool
		this.registerTool(
			{
				name: 'read_file',
				description: 'Read the contents of a file. Returns the file content with line numbers.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'The path to the file (relative to workspace root or absolute)' }
					},
					required: ['path']
				}
			},
			async (args) => {
				try {
					const path = args.path as string;
					if (!path) {
						return { error: 'Path is required' };
					}

					const uri = this._resolveUri(path);
					const content = await this._fileService.readFile(uri);
					const text = content.value.toString();
					const lines = text.split('\n');

					return {
						path: uri.fsPath,
						content: text,
						lineCount: lines.length,
						preview: lines.slice(0, 100).map((l, i) => `${i + 1}: ${l}`).join('\n')
					};
				} catch (error) {
					return { error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
		);

		// Write File Tool
		this.registerTool(
			{
				name: 'write_file',
				description: 'Create or overwrite a file with the specified content.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'The path to the file (relative or absolute)' },
						content: { type: 'string', description: 'The complete content to write to the file' }
					},
					required: ['path', 'content']
				}
			},
			async (args) => {
				try {
					const path = args.path as string;
					const content = args.content as string;

					if (!path) { return { error: 'Path is required' }; }
					if (content === undefined) { return { error: 'Content is required' }; }

					const uri = this._resolveUri(path);
					
					// Check if exists
					let existed = false;
					try {
						await this._fileService.stat(uri);
						existed = true;
					} catch { /* doesn't exist */ }

					await this._fileService.writeFile(uri, VSBuffer.fromString(content));
					this._logService.info(`[AIDE] Wrote file: ${uri.fsPath}`);

					return {
						success: true,
						path: uri.fsPath,
						action: existed ? 'updated' : 'created',
						lineCount: content.split('\n').length
					};
				} catch (error) {
					return { error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
		);

		// Edit File Tool (precise string replacement)
		this.registerTool(
			{
				name: 'edit_file',
				description: 'Make a precise edit to a file by replacing specific content. Use this for small, targeted changes.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'The path to the file' },
						old_content: { type: 'string', description: 'The exact content to find and replace (must match exactly)' },
						new_content: { type: 'string', description: 'The new content to replace it with' }
					},
					required: ['path', 'old_content', 'new_content']
				}
			},
			async (args) => {
				try {
					const path = args.path as string;
					const oldContent = args.old_content as string;
					const newContent = args.new_content as string;

					const uri = this._resolveUri(path);
					const fileContent = await this._fileService.readFile(uri);
					const currentContent = fileContent.value.toString();

					if (!currentContent.includes(oldContent)) {
						return {
							error: 'Could not find the specified content to replace.',
							hint: 'Make sure old_content matches exactly including whitespace and indentation.'
						};
					}

										const updatedContent = currentContent.replace(oldContent, newContent);
					await this._fileService.writeFile(uri, VSBuffer.fromString(updatedContent));

					this._logService.info(`[AIDE] Edited file: ${uri.fsPath}`);
					return { success: true, path: uri.fsPath };
				} catch (error) {
					return { error: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
		);

		// Search Codebase Tool
		this.registerTool(
			{
				name: 'search_codebase',
				description: 'Search the codebase for files or content. Use type=filename to find files by name, or type=content to search within files.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'The search query or pattern' },
						type: { type: 'string', description: 'Type of search', enum: ['content', 'filename'] },
						file_pattern: { type: 'string', description: 'Optional glob pattern to filter files (e.g., "*.ts")' },
						max_results: { type: 'number', description: 'Maximum number of results (default 20)' }
					},
					required: ['query']
				}
			},
			async (args) => {
				try {
					const query = args.query as string;
					const searchType = (args.type as string) || 'content';
					const maxResults = (args.max_results as number) || 20;
					const filePattern = args.file_pattern as string | undefined;

					const folders = this._workspaceContextService.getWorkspace().folders;
					if (folders.length === 0) {
						return { error: 'No workspace folder open' };
					}

					if (searchType === 'filename') {
						const results = await this._searchService.fileSearch({
							type: QueryType.File,
							folderQueries: folders.map(f => ({ folder: f.uri })),
							filePattern: query,
							maxResults
						}, CancellationToken.None);

						return {
							type: 'filename',
							query,
							results: results.results.map(r => r.resource.fsPath),
							count: results.results.length
						};
					} else {
						const results = await this._searchService.textSearch({
							type: QueryType.Text,
							contentPattern: { pattern: query },
							folderQueries: folders.map(f => ({ folder: f.uri })),
							includePattern: filePattern ? { [filePattern]: true } : undefined,
							maxResults
						}, CancellationToken.None);

						return {
							type: 'content',
							query,
							results: results.results.map(r => ({
								file: r.resource.fsPath,
								matches: r.results?.length || 0
							})),
							count: results.results.length
						};
					}
				} catch (error) {
					return { error: `Search failed: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
		);

		// List Directory Tool
		this.registerTool(
			{
				name: 'list_directory',
				description: 'List files and folders in a directory. Useful for understanding project structure.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'The directory path (defaults to workspace root)' },
						recursive: { type: 'boolean', description: 'Include subdirectories (default false)' },
						max_depth: { type: 'number', description: 'Maximum depth for recursive listing (default 3)' }
					}
				}
			},
			async (args) => {
				try {
					const path = args.path as string | undefined;
					const recursive = args.recursive as boolean || false;
					const maxDepth = (args.max_depth as number) || 3;

					const folders = this._workspaceContextService.getWorkspace().folders;
					const uri = path ? this._resolveUri(path) : folders[0]?.uri;

					if (!uri) {
						return { error: 'No path specified and no workspace folder open' };
					}

					const entries = await this._listDirectoryRecursive(uri, recursive, maxDepth, 0);

					return {
						path: uri.fsPath,
						entries,
						totalItems: entries.length
					};
				} catch (error) {
					return { error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
		);

		// Run Terminal Command Tool
		this.registerTool(
			{
				name: 'run_terminal_command',
				description: 'Execute a shell command in the integrated terminal. Use for running build scripts, tests, git commands, etc.',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string', description: 'The command to execute' },
						cwd: { type: 'string', description: 'Working directory for the command (optional)' }
					},
					required: ['command']
				}
			},
			async (args) => {
				try {
					const command = args.command as string;
					if (!command) {
						return { error: 'Command is required' };
					}

					// Security check for dangerous commands
					const dangerousPatterns = [
						/rm\s+-rf\s+[\/~]/i,
						/>\s*\/dev\//i,
						/mkfs/i,
						/dd\s+if=/i,
						/:(){ :|:& };:/
					];

					for (const pattern of dangerousPatterns) {
						if (pattern.test(command)) {
							return { error: 'Command blocked for safety. This could cause system damage.', blocked: true };
						}
					}

					// Try to get terminal service
					const terminalService = this._instantiationService.invokeFunction((accessor) => {
						try {
							return accessor.get(ITerminalService);
						} catch {
							return undefined;
						}
					});

					if (!terminalService) {
						return {
							success: false,
							command,
							message: 'Terminal service not available. Command would be: ' + command
						};
					}

					let terminal = terminalService.activeInstance;
					if (!terminal) {
						terminal = await terminalService.createTerminal({
							config: { name: 'AIDE Agent' }
						});
					}

					terminalService.setActiveInstance(terminal);
					await terminalService.revealActiveTerminal();
					terminal.sendText(command, true);

					this._logService.info(`[AIDE] Executed command: ${command}`);

					return {
						success: true,
						command,
						message: 'Command sent to terminal. Check terminal for output.'
					};
				} catch (error) {
					return { error: `Command failed: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
		);
	}

	private _resolveUri(path: string): URI {
		if (path.startsWith('/') || path.includes(':')) {
			return URI.file(path);
		}

		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			return URI.joinPath(folders[0].uri, path);
		}

		return URI.file(path);
	}

	private async _listDirectoryRecursive(
		uri: URI,
		recursive: boolean,
		maxDepth: number,
		currentDepth: number
	): Promise<Array<{ name: string; type: string; path: string }>> {
		const entries: Array<{ name: string; type: string; path: string }> = [];

		try {
			const resolved = await this._fileService.resolve(uri);
			if (resolved.children) {
				for (const child of resolved.children) {
					entries.push({
						name: child.name,
						type: child.isDirectory ? 'directory' : 'file',
						path: child.resource.fsPath
					});

					if (recursive && child.isDirectory && currentDepth < maxDepth) {
						const subEntries = await this._listDirectoryRecursive(child.resource, recursive, maxDepth, currentDepth + 1);
						entries.push(...subEntries);
					}
				}
			}
		} catch { /* ignore */ }

		return entries;
	}

	private _loadAgents(): void {
		try {
			const data = this._storageService.get(AGENTS_STORAGE_KEY, StorageScope.PROFILE);
			if (data) {
				const parsed = JSON.parse(data) as { agents: IAideAgent[]; activeId?: string };
				for (const agent of parsed.agents) {
					this._agents.set(agent.id, agent);
				}
				this._activeAgentId = parsed.activeId;
			}
		} catch (error) {
			this._logService.error('[AIDE] Failed to load agents:', error);
		}
	}

	private _saveAgents(): void {
		try {
			const data = {
				agents: Array.from(this._agents.values()),
				activeId: this._activeAgentId
			};
			this._storageService.store(
				AGENTS_STORAGE_KEY,
				JSON.stringify(data),
				StorageScope.PROFILE,
				StorageTarget.USER
			);
		} catch (error) {
			this._logService.error('[AIDE] Failed to save agents:', error);
		}
	}

	private _loadDefaultModel(): void {
		this._defaultModelId = this._storageService.get(DEFAULT_MODEL_STORAGE_KEY, StorageScope.PROFILE);
	}
}
