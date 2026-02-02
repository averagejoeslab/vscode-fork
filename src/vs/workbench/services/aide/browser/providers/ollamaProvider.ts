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

interface OllamaMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
	images?: string[];
}

interface OllamaModel {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details: {
		parent_model: string;
		format: string;
		family: string;
		families: string[];
		parameter_size: string;
		quantization_level: string;
	};
}

interface OllamaListResponse {
	models: OllamaModel[];
}

interface OllamaChatResponse {
	model: string;
	created_at: string;
	message: {
		role: string;
		content: string;
	};
	done: boolean;
	done_reason?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

export class OllamaProvider extends Disposable implements IAideModelProvider {
	readonly id = 'ollama';
	readonly name = 'Ollama (Local)';

	private readonly _onDidChangeModels = this._register(new Emitter<void>());
	readonly onDidChangeModels: Event<void> = this._onDidChangeModels.event;

	private _baseUrl: string;
	private _cachedModels: IAideModelInfo[] = [];
	private _lastModelFetch = 0;
	private readonly MODEL_CACHE_TTL = 30000; // 30 seconds

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		this._baseUrl = this._configurationService.getValue<string>('aide.providers.ollama.baseUrl') || 'http://localhost:11434';

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('aide.providers.ollama')) {
				this._baseUrl = this._configurationService.getValue<string>('aide.providers.ollama.baseUrl') || 'http://localhost:11434';
				this._cachedModels = [];
				this._lastModelFetch = 0;
				this._onDidChangeModels.fire();
			}
		}));
	}

	async getAvailableModels(): Promise<IAideModelInfo[]> {
		// Use cached models if still valid
		if (this._cachedModels.length > 0 && Date.now() - this._lastModelFetch < this.MODEL_CACHE_TTL) {
			return this._cachedModels;
		}

		try {
			const response = await fetch(`${this._baseUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				this._logService.warn('[Ollama] Failed to fetch models:', response.status);
				return [];
			}

			const data = await response.json() as OllamaListResponse;

			this._cachedModels = data.models.map(model => ({
				id: `ollama/${model.name}`,
				name: model.name,
				provider: 'ollama',
				contextLength: this._estimateContextLength(model),
				supportsVision: this._modelSupportsVision(model.name),
				supportsTools: false, // Ollama has limited tool support
				supportsStreaming: true
			}));

			this._lastModelFetch = Date.now();
			return this._cachedModels;

		} catch (error) {
			this._logService.warn('[Ollama] Failed to connect to Ollama server:', error);
			return [];
		}
	}

	async chat(request: IAideCompletionRequest, token: CancellationToken): Promise<IAideCompletionResponse> {
		const modelName = request.model.replace('ollama/', '');
		const messages = this._convertMessages(request);

		const body: Record<string, unknown> = {
			model: modelName,
			messages,
			stream: false,
			options: {
				temperature: request.temperature
			}
		};

		if (request.maxTokens) {
			(body.options as Record<string, unknown>).num_predict = request.maxTokens;
		}

		const response = await fetch(`${this._baseUrl}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Ollama API error: ${response.status} - ${error}`);
		}

		const data = await response.json() as OllamaChatResponse;

		const content: IAideMessageContent[] = [];
		if (data.message.content) {
			content.push({ type: 'text', text: data.message.content });
		}

		return {
			id: generateUuid(),
			content,
			model: request.model,
			finishReason: this._mapDoneReason(data.done_reason),
			usage: {
				inputTokens: data.prompt_eval_count || 0,
				outputTokens: data.eval_count || 0
			}
		};
	}

	async *chatStream(request: IAideCompletionRequest, token: CancellationToken): AsyncIterable<IAideStreamChunk> {
		const modelName = request.model.replace('ollama/', '');
		const messages = this._convertMessages(request);

		const body: Record<string, unknown> = {
			model: modelName,
			messages,
			stream: true,
			options: {
				temperature: request.temperature
			}
		};

		if (request.maxTokens) {
			(body.options as Record<string, unknown>).num_predict = request.maxTokens;
		}

		const response = await fetch(`${this._baseUrl}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Ollama API error: ${response.status} - ${error}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		const messageId = generateUuid();

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
					if (!trimmed) {
						continue;
					}

					try {
						const chunk = JSON.parse(trimmed) as OllamaChatResponse;

						if (chunk.message?.content) {
							yield {
								id: messageId,
								delta: { type: 'text', text: chunk.message.content }
							};
						}

						if (chunk.done) {
							yield {
								id: messageId,
								delta: {},
								finishReason: this._mapDoneReason(chunk.done_reason)
							};
						}
					} catch (e) {
						this._logService.error('[Ollama] Failed to parse chunk:', e);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async countTokens(text: string, _model: string): Promise<number> {
		// Simple approximation for Ollama models
		return Math.ceil(text.length / 4);
	}

	private _convertMessages(request: IAideCompletionRequest): OllamaMessage[] {
		return request.messages.map(msg => {
			const textContent = msg.content
				.filter(c => c.type === 'text')
				.map(c => c.text || '')
				.join('');

			const images = msg.content
				.filter(c => c.type === 'image' && c.imageData)
				.map(c => {
					// Convert Uint8Array to base64
					const bytes = c.imageData!;
					let binary = '';
					for (let i = 0; i < bytes.length; i++) {
						binary += String.fromCharCode(bytes[i]);
					}
					return btoa(binary);
				});

			const message: OllamaMessage = {
				role: this._mapRole(msg.role),
				content: textContent
			};

			if (images.length > 0) {
				message.images = images;
			}

			return message;
		});
	}

	private _mapRole(role: AideMessageRole): 'system' | 'user' | 'assistant' {
		switch (role) {
			case AideMessageRole.System:
				return 'system';
			case AideMessageRole.User:
				return 'user';
			case AideMessageRole.Assistant:
				return 'assistant';
			case AideMessageRole.Tool:
				return 'user'; // Ollama doesn't have a tool role
			default:
				return 'user';
		}
	}

	private _mapDoneReason(reason: string | undefined): IAideCompletionResponse['finishReason'] {
		switch (reason) {
			case 'stop':
				return 'stop';
			case 'length':
				return 'length';
			default:
				return 'stop';
		}
	}

	private _estimateContextLength(model: OllamaModel): number {
		const name = model.name.toLowerCase();

		// Common context lengths for popular models
		if (name.includes('llama3') || name.includes('llama-3')) {
			return 8192;
		}
		if (name.includes('llama2') || name.includes('llama-2')) {
			return 4096;
		}
		if (name.includes('codellama')) {
			return 16384;
		}
		if (name.includes('mistral')) {
			return 32768;
		}
		if (name.includes('mixtral')) {
			return 32768;
		}
		if (name.includes('phi')) {
			return 4096;
		}
		if (name.includes('gemma')) {
			return 8192;
		}
		if (name.includes('qwen')) {
			return 32768;
		}
		if (name.includes('deepseek')) {
			return 32768;
		}

		// Default
		return 4096;
	}

	private _modelSupportsVision(modelName: string): boolean {
		const name = modelName.toLowerCase();
		return name.includes('llava') ||
			name.includes('bakllava') ||
			name.includes('vision') ||
			name.includes('moondream');
	}
}
