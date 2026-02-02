/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import {
	AideMessageRole,
	IAideCompletionRequest,
	IAideCompletionResponse,
	IAideModelInfo,
	IAideModelProvider,
	IAideStreamChunk
} from '../../common/aideService.js';

interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

interface OpenAITool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

interface OpenAIResponse {
	id: string;
	choices: Array<{
		message: {
			role: string;
			content: string | null;
			tool_calls?: Array<{
				id: string;
				type: 'function';
				function: { name: string; arguments: string };
			}>;
		};
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
	};
}

interface OpenAIStreamChunk {
	id: string;
	choices: Array<{
		delta: {
			role?: string;
			content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: 'function';
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason: string | null;
	}>;
}

const OPENAI_MODELS: IAideModelInfo[] = [
	{ id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', contextLength: 128000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextLength: 128000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextLength: 128000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'openai/gpt-4', name: 'GPT-4', provider: 'openai', contextLength: 8192, supportsVision: false, supportsTools: true, supportsStreaming: true },
	{ id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai', contextLength: 16385, supportsVision: false, supportsTools: true, supportsStreaming: true },
	{ id: 'openai/o1', name: 'o1', provider: 'openai', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'openai/o1-mini', name: 'o1 Mini', provider: 'openai', contextLength: 128000, supportsVision: false, supportsTools: true, supportsStreaming: true },
];

export class OpenAIProvider extends Disposable implements IAideModelProvider {
	readonly id = 'openai';
	readonly name = 'OpenAI';

	private readonly _onDidChangeModels = this._register(new Emitter<void>());
	readonly onDidChangeModels: Event<void> = this._onDidChangeModels.event;

	private _apiKey: string | undefined;
	private _baseUrl: string;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		this._apiKey = this._configurationService.getValue<string>('aide.providers.openai.apiKey');
		this._baseUrl = this._configurationService.getValue<string>('aide.providers.openai.baseUrl') || 'https://api.openai.com/v1';

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('aide.providers.openai')) {
				this._apiKey = this._configurationService.getValue<string>('aide.providers.openai.apiKey');
				this._baseUrl = this._configurationService.getValue<string>('aide.providers.openai.baseUrl') || 'https://api.openai.com/v1';
				this._onDidChangeModels.fire();
			}
		}));
	}

	async getAvailableModels(): Promise<IAideModelInfo[]> {
		if (!this._apiKey) {
			return [];
		}
		return OPENAI_MODELS;
	}

	async chat(request: IAideCompletionRequest, token: CancellationToken): Promise<IAideCompletionResponse> {
		if (!this._apiKey) {
			throw new Error('OpenAI API key not configured');
		}

		const modelId = request.model.replace('openai/', '');
		const messages = this._convertMessages(request);
		const tools = request.tools ? this._convertTools(request) : undefined;

		const body: Record<string, unknown> = {
			model: modelId,
			messages,
			max_tokens: request.maxTokens,
			temperature: request.temperature
		};

		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		const response = await fetch(`${this._baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this._apiKey}`
			},
			body: JSON.stringify(body),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${response.status} - ${error}`);
		}

		const data = await response.json() as OpenAIResponse;
		const choice = data.choices[0];

		return {
			id: data.id,
			content: this._parseResponseContent(choice),
			model: request.model,
			finishReason: this._mapFinishReason(choice.finish_reason),
			usage: data.usage ? {
				inputTokens: data.usage.prompt_tokens,
				outputTokens: data.usage.completion_tokens
			} : undefined
		};
	}

	async *chatStream(request: IAideCompletionRequest, token: CancellationToken): AsyncIterable<IAideStreamChunk> {
		if (!this._apiKey) {
			throw new Error('OpenAI API key not configured');
		}

		const modelId = request.model.replace('openai/', '');
		const messages = this._convertMessages(request);
		const tools = request.tools ? this._convertTools(request) : undefined;

		const body: Record<string, unknown> = {
			model: modelId,
			messages,
			max_tokens: request.maxTokens,
			temperature: request.temperature,
			stream: true
		};

		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		const response = await fetch(`${this._baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this._apiKey}`
			},
			body: JSON.stringify(body),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${response.status} - ${error}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();

		try {
			while (true) {
				if (token.isCancellationRequested) {
					break;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === 'data: [DONE]') {
						continue;
					}

					if (trimmed.startsWith('data: ')) {
						try {
							const chunk = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk;
							const choice = chunk.choices[0];

							if (choice.delta.content) {
								yield {
									id: chunk.id,
									delta: { type: 'text', text: choice.delta.content },
									finishReason: choice.finish_reason ? this._mapFinishReason(choice.finish_reason) : undefined
								};
							}

							if (choice.delta.tool_calls) {
								for (const toolCall of choice.delta.tool_calls) {
									let toolBuffer = toolCallBuffers.get(toolCall.index);
									if (!toolBuffer) {
										toolBuffer = { id: toolCall.id || '', name: '', arguments: '' };
										toolCallBuffers.set(toolCall.index, toolBuffer);
									}

									if (toolCall.id) {
										toolBuffer.id = toolCall.id;
									}
									if (toolCall.function?.name) {
										toolBuffer.name = toolCall.function.name;
									}
									if (toolCall.function?.arguments) {
										toolBuffer.arguments += toolCall.function.arguments;
									}
								}
							}

							if (choice.finish_reason === 'tool_calls') {
								// Emit accumulated tool calls
								for (const [, toolBuffer] of toolCallBuffers) {
									try {
										const args = JSON.parse(toolBuffer.arguments);
										yield {
											id: generateUuid(),
											delta: {
												type: 'tool_call',
												toolCallId: toolBuffer.id,
												toolName: toolBuffer.name,
												toolArguments: args
											},
											finishReason: 'tool_calls'
										};
									} catch (e) {
										this._logService.error('[OpenAI] Failed to parse tool arguments:', e);
									}
								}
							}

							if (choice.finish_reason && choice.finish_reason !== 'tool_calls') {
								yield {
									id: chunk.id,
									delta: {},
									finishReason: this._mapFinishReason(choice.finish_reason)
								};
							}
						} catch (e) {
							this._logService.error('[OpenAI] Failed to parse chunk:', e);
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async countTokens(text: string, _model: string): Promise<number> {
		// Simple approximation - OpenAI uses ~4 characters per token
		return Math.ceil(text.length / 4);
	}

	private _convertMessages(request: IAideCompletionRequest): OpenAIMessage[] {
		return request.messages.map(msg => {
			const content = msg.content
				.filter(c => c.type === 'text')
				.map(c => c.text || '')
				.join('');

			const toolCalls = msg.content
				.filter(c => c.type === 'tool_call')
				.map(c => ({
					id: c.toolCallId || generateUuid(),
					type: 'function' as const,
					function: {
						name: c.toolName || '',
						arguments: JSON.stringify(c.toolArguments || {})
					}
				}));

			const toolResult = msg.content.find(c => c.type === 'tool_result');

			const message: OpenAIMessage = {
				role: this._mapRole(msg.role),
				content
			};

			if (toolCalls.length > 0) {
				message.tool_calls = toolCalls;
			}

			if (toolResult) {
				message.role = 'tool';
				message.tool_call_id = toolResult.toolCallId;
				message.content = JSON.stringify(toolResult.toolResult);
			}

			return message;
		});
	}

	private _convertTools(request: IAideCompletionRequest): OpenAITool[] {
		if (!request.tools) {
			return [];
		}

		return request.tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters
			}
		}));
	}

	private _mapRole(role: AideMessageRole): 'system' | 'user' | 'assistant' | 'tool' {
		switch (role) {
			case AideMessageRole.System:
				return 'system';
			case AideMessageRole.User:
				return 'user';
			case AideMessageRole.Assistant:
				return 'assistant';
			case AideMessageRole.Tool:
				return 'tool';
			default:
				return 'user';
		}
	}

	private _parseResponseContent(choice: OpenAIResponse['choices'][0]): IAideCompletionRequest['messages'][0]['content'] {
		const content: IAideCompletionRequest['messages'][0]['content'] = [];

		if (choice.message.content) {
			content.push({ type: 'text', text: choice.message.content });
		}

		if (choice.message.tool_calls) {
			for (const toolCall of choice.message.tool_calls) {
				try {
					content.push({
						type: 'tool_call',
						toolCallId: toolCall.id,
						toolName: toolCall.function.name,
						toolArguments: JSON.parse(toolCall.function.arguments)
					});
				} catch (e) {
					this._logService.error('[OpenAI] Failed to parse tool arguments:', e);
				}
			}
		}

		return content;
	}

	private _mapFinishReason(reason: string): IAideCompletionResponse['finishReason'] {
		switch (reason) {
			case 'stop':
				return 'stop';
			case 'tool_calls':
				return 'tool_calls';
			case 'length':
				return 'length';
			default:
				return 'stop';
		}
	}
}
