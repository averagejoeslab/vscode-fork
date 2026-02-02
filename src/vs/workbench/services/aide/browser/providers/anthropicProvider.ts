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
	IAideMessageContent,
	IAideModelInfo,
	IAideModelProvider,
	IAideStreamChunk
} from '../../common/aideService.js';

interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
}

interface AnthropicTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
	id: string;
	type: 'message';
	role: 'assistant';
	content: Array<{
		type: 'text' | 'tool_use';
		text?: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	}>;
	model: string;
	stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

interface AnthropicStreamEvent {
	type: string;
	index?: number;
	message?: AnthropicResponse;
	content_block?: {
		type: 'text' | 'tool_use';
		text?: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	};
	delta?: {
		type: string;
		text?: string;
		partial_json?: string;
		stop_reason?: string;
	};
	usage?: {
		output_tokens: number;
	};
}

const ANTHROPIC_MODELS: IAideModelInfo[] = [
	{ id: 'anthropic/claude-opus-4-5-20250514', name: 'Claude Opus 4.5', provider: 'anthropic', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'anthropic/claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'anthropic/claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'anthropic/claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'anthropic', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
	{ id: 'anthropic/claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic', contextLength: 200000, supportsVision: true, supportsTools: true, supportsStreaming: true },
];

export class AnthropicProvider extends Disposable implements IAideModelProvider {
	readonly id = 'anthropic';
	readonly name = 'Anthropic';

	private readonly _onDidChangeModels = this._register(new Emitter<void>());
	readonly onDidChangeModels: Event<void> = this._onDidChangeModels.event;

	private _apiKey: string | undefined;
	private _baseUrl: string;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		this._apiKey = this._configurationService.getValue<string>('aide.providers.anthropic.apiKey');
		this._baseUrl = this._configurationService.getValue<string>('aide.providers.anthropic.baseUrl') || 'https://api.anthropic.com';

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('aide.providers.anthropic')) {
				this._apiKey = this._configurationService.getValue<string>('aide.providers.anthropic.apiKey');
				this._baseUrl = this._configurationService.getValue<string>('aide.providers.anthropic.baseUrl') || 'https://api.anthropic.com';
				this._onDidChangeModels.fire();
			}
		}));
	}

	async getAvailableModels(): Promise<IAideModelInfo[]> {
		if (!this._apiKey) {
			return [];
		}
		return ANTHROPIC_MODELS;
	}

	async chat(request: IAideCompletionRequest, token: CancellationToken): Promise<IAideCompletionResponse> {
		if (!this._apiKey) {
			throw new Error('Anthropic API key not configured');
		}

		const modelId = request.model.replace('anthropic/', '');
		const { system, messages } = this._convertMessages(request);
		const tools = request.tools ? this._convertTools(request) : undefined;

		const body: Record<string, unknown> = {
			model: modelId,
			messages,
			max_tokens: request.maxTokens || 4096,
			temperature: request.temperature
		};

		if (system) {
			body.system = system;
		}

		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		const response = await fetch(`${this._baseUrl}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this._apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(body),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Anthropic API error: ${response.status} - ${error}`);
		}

		const data = await response.json() as AnthropicResponse;

		return {
			id: data.id,
			content: this._parseResponseContent(data.content),
			model: request.model,
			finishReason: this._mapStopReason(data.stop_reason),
			usage: {
				inputTokens: data.usage.input_tokens,
				outputTokens: data.usage.output_tokens
			}
		};
	}

	async *chatStream(request: IAideCompletionRequest, token: CancellationToken): AsyncIterable<IAideStreamChunk> {
		if (!this._apiKey) {
			throw new Error('Anthropic API key not configured');
		}

		const modelId = request.model.replace('anthropic/', '');
		const { system, messages } = this._convertMessages(request);
		const tools = request.tools ? this._convertTools(request) : undefined;

		const body: Record<string, unknown> = {
			model: modelId,
			messages,
			max_tokens: request.maxTokens || 4096,
			temperature: request.temperature,
			stream: true
		};

		if (system) {
			body.system = system;
		}

		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		const response = await fetch(`${this._baseUrl}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this._apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(body),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Anthropic API error: ${response.status} - ${error}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let messageId = '';
		const toolUseBlocks = new Map<number, { id: string; name: string; inputJson: string }>();

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
					if (!trimmed || !trimmed.startsWith('data: ')) {
						continue;
					}

					try {
						const event = JSON.parse(trimmed.slice(6)) as AnthropicStreamEvent;

						switch (event.type) {
							case 'message_start':
								if (event.message) {
									messageId = event.message.id;
								}
								break;

							case 'content_block_start':
								if (event.content_block?.type === 'tool_use' && event.index !== undefined) {
									toolUseBlocks.set(event.index, {
										id: event.content_block.id || generateUuid(),
										name: event.content_block.name || '',
										inputJson: ''
									});
								}
								break;

							case 'content_block_delta':
								if (event.delta?.type === 'text_delta' && event.delta.text) {
									yield {
										id: messageId,
										delta: { type: 'text', text: event.delta.text }
									};
								} else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json && event.index !== undefined) {
									const block = toolUseBlocks.get(event.index);
									if (block) {
										block.inputJson += event.delta.partial_json;
									}
								}
								break;

							case 'content_block_stop':
								if (event.index !== undefined) {
									const block = toolUseBlocks.get(event.index);
									if (block) {
										try {
											const args = JSON.parse(block.inputJson);
											yield {
												id: messageId,
												delta: {
													type: 'tool_call',
													toolCallId: block.id,
													toolName: block.name,
													toolArguments: args
												}
											};
										} catch (e) {
											this._logService.error('[Anthropic] Failed to parse tool arguments:', e);
										}
									}
								}
								break;

							case 'message_delta':
								if (event.delta?.stop_reason) {
									yield {
										id: messageId,
										delta: {},
										finishReason: this._mapStopReason(event.delta.stop_reason as AnthropicResponse['stop_reason'])
									};
								}
								break;
						}
					} catch (e) {
						this._logService.error('[Anthropic] Failed to parse chunk:', e);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async countTokens(text: string, _model: string): Promise<number> {
		// Anthropic uses ~4 characters per token on average
		return Math.ceil(text.length / 4);
	}

	private _convertMessages(request: IAideCompletionRequest): { system: string | undefined; messages: AnthropicMessage[] } {
		let system: string | undefined;
		const messages: AnthropicMessage[] = [];

		for (const msg of request.messages) {
			if (msg.role === AideMessageRole.System) {
				system = msg.content
					.filter(c => c.type === 'text')
					.map(c => c.text || '')
					.join('');
				continue;
			}

			if (msg.role === AideMessageRole.Tool) {
				// Anthropic handles tool results differently - as user messages with tool_result content
				const toolResult = msg.content.find(c => c.type === 'tool_result');
				if (toolResult) {
					messages.push({
						role: 'user',
						content: [{
							type: 'tool_result',
							tool_use_id: toolResult.toolCallId,
							content: JSON.stringify(toolResult.toolResult),
							is_error: toolResult.isError
						} as unknown as { type: string; text: string }]
					});
				}
				continue;
			}

			const content = msg.content
				.filter(c => c.type === 'text')
				.map(c => c.text || '')
				.join('');

			const toolCalls = msg.content.filter(c => c.type === 'tool_call');

			if (toolCalls.length > 0) {
				// Assistant message with tool use
				const contentArray: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];

				if (content) {
					contentArray.push({ type: 'text', text: content });
				}

				for (const tc of toolCalls) {
					contentArray.push({
						type: 'tool_use',
						id: tc.toolCallId,
						name: tc.toolName,
						input: tc.toolArguments as Record<string, unknown>
					});
				}

				messages.push({
					role: 'assistant',
					content: contentArray as AnthropicMessage['content']
				});
			} else {
				messages.push({
					role: msg.role === AideMessageRole.User ? 'user' : 'assistant',
					content
				});
			}
		}

		return { system, messages };
	}

	private _convertTools(request: IAideCompletionRequest): AnthropicTool[] {
		if (!request.tools) {
			return [];
		}

		return request.tools.map(tool => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.parameters
		}));
	}

	private _parseResponseContent(content: AnthropicResponse['content']): IAideMessageContent[] {
		const result: IAideMessageContent[] = [];

		for (const block of content) {
			if (block.type === 'text' && block.text) {
				result.push({ type: 'text', text: block.text });
			} else if (block.type === 'tool_use') {
				result.push({
					type: 'tool_call',
					toolCallId: block.id,
					toolName: block.name,
					toolArguments: block.input
				});
			}
		}

		return result;
	}

	private _mapStopReason(reason: AnthropicResponse['stop_reason']): IAideCompletionResponse['finishReason'] {
		switch (reason) {
			case 'end_turn':
			case 'stop_sequence':
				return 'stop';
			case 'tool_use':
				return 'tool_calls';
			case 'max_tokens':
				return 'length';
			default:
				return 'stop';
		}
	}
}
