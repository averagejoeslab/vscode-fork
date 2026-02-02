/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
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
		@IConfigurationService _configurationService: IConfigurationService
	) {
		super();

		this._loadAgents();
		this._loadDefaultModel();

		// Register built-in tools
		this._registerBuiltInTools();
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
		// File read tool
		this.registerTool(
			{
				name: 'read_file',
				description: 'Read the contents of a file',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'The path to the file to read' }
					},
					required: ['path']
				}
			},
			async (args) => {
				// Implementation will be handled by the context service
				return `File read tool called with path: ${args.path}`;
			}
		);

		// File write tool
		this.registerTool(
			{
				name: 'write_file',
				description: 'Write content to a file',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'The path to the file to write' },
						content: { type: 'string', description: 'The content to write to the file' }
					},
					required: ['path', 'content']
				}
			},
			async (args) => {
				return `File write tool called with path: ${args.path}`;
			}
		);

		// Search tool
		this.registerTool(
			{
				name: 'search_codebase',
				description: 'Search the codebase for files or content',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'The search query' },
						type: { type: 'string', description: 'Type of search', enum: ['semantic', 'lexical', 'filename'] }
					},
					required: ['query']
				}
			},
			async (args) => {
				return `Search tool called with query: ${args.query}`;
			}
		);

		// Terminal tool
		this.registerTool(
			{
				name: 'run_terminal_command',
				description: 'Execute a command in the terminal',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string', description: 'The command to execute' }
					},
					required: ['command']
				}
			},
			async (args) => {
				return `Terminal tool called with command: ${args.command}`;
			}
		);
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
