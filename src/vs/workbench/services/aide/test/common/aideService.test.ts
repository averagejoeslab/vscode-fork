/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import {
	AideMode,
	AideMessageRole,
	IAideAgent,
	IAideCompletionRequest,
	IAideCompletionResponse,
	IAideMessage,
	IAideModelInfo,
	IAideModelProvider,
	IAideStreamChunk
} from '../../common/aideService.js';

// ============================================================================
// Mock Provider
// ============================================================================

class MockAIModelProvider implements IAideModelProvider {
	readonly id = 'mock';
	readonly name = 'Mock Provider';

	private readonly _onDidChangeModels = new Emitter<void>();
	readonly onDidChangeModels = this._onDidChangeModels.event;

	private _models: IAideModelInfo[] = [
		{
			id: 'mock/test-model',
			name: 'Test Model',
			provider: 'mock',
			contextLength: 4096,
			supportsVision: false,
			supportsTools: true,
			supportsStreaming: true
		}
	];

	async getAvailableModels(): Promise<IAideModelInfo[]> {
		return this._models;
	}

	async chat(request: IAideCompletionRequest, token: CancellationToken): Promise<IAideCompletionResponse> {
		return {
			id: 'mock-response-1',
			content: [{ type: 'text', text: 'Mock response to: ' + request.messages[request.messages.length - 1]?.content[0]?.text }],
			model: request.model,
			finishReason: 'stop',
			usage: { inputTokens: 10, outputTokens: 5 }
		};
	}

	async *chatStream(request: IAideCompletionRequest, token: CancellationToken): AsyncIterable<IAideStreamChunk> {
		const words = ['Mock', ' ', 'streaming', ' ', 'response'];
		for (const word of words) {
			if (token.isCancellationRequested) {
				break;
			}
			yield {
				id: 'mock-stream-1',
				delta: { type: 'text', text: word }
			};
		}
		yield {
			id: 'mock-stream-1',
			delta: {},
			finishReason: 'stop'
		};
	}

	async countTokens(text: string, model: string): Promise<number> {
		return Math.ceil(text.length / 4);
	}
}

// ============================================================================
// Tests
// ============================================================================

suite('AIDE Service Tests', () => {
	const disposables = new DisposableStore();

	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		disposables.clear();
	});

	suite('AideMode', () => {
		test('should have correct mode values', () => {
			assert.strictEqual(AideMode.Agent, 'agent');
			assert.strictEqual(AideMode.Plan, 'plan');
			assert.strictEqual(AideMode.Debug, 'debug');
			assert.strictEqual(AideMode.Ask, 'ask');
		});
	});

	suite('AideMessageRole', () => {
		test('should have correct role values', () => {
			assert.strictEqual(AideMessageRole.System, 'system');
			assert.strictEqual(AideMessageRole.User, 'user');
			assert.strictEqual(AideMessageRole.Assistant, 'assistant');
			assert.strictEqual(AideMessageRole.Tool, 'tool');
		});
	});

	suite('MockAIModelProvider', () => {
		let provider: MockAIModelProvider;

		setup(() => {
			provider = new MockAIModelProvider();
		});

		test('should return available models', async () => {
			const models = await provider.getAvailableModels();

			assert.strictEqual(models.length, 1);
			assert.strictEqual(models[0].id, 'mock/test-model');
			assert.strictEqual(models[0].name, 'Test Model');
			assert.strictEqual(models[0].provider, 'mock');
		});

		test('should handle chat request', async () => {
			const request: IAideCompletionRequest = {
				messages: [{
					id: 'msg-1',
					role: AideMessageRole.User,
					content: [{ type: 'text', text: 'Hello' }],
					timestamp: Date.now()
				}],
				model: 'mock/test-model'
			};

			const response = await provider.chat(request, CancellationToken.None);

			assert.strictEqual(response.finishReason, 'stop');
			assert.ok(response.content[0]?.text?.includes('Mock response'));
		});

		test('should handle streaming chat', async () => {
			const request: IAideCompletionRequest = {
				messages: [{
					id: 'msg-1',
					role: AideMessageRole.User,
					content: [{ type: 'text', text: 'Hello' }],
					timestamp: Date.now()
				}],
				model: 'mock/test-model',
				stream: true
			};

			const chunks: IAideStreamChunk[] = [];
			for await (const chunk of provider.chatStream(request, CancellationToken.None)) {
				chunks.push(chunk);
			}

			assert.ok(chunks.length > 0);
			const lastChunk = chunks[chunks.length - 1];
			assert.strictEqual(lastChunk.finishReason, 'stop');
		});

		test('should count tokens', async () => {
			const text = 'Hello, world!';
			const tokens = await provider.countTokens(text, 'mock/test-model');

			assert.strictEqual(tokens, Math.ceil(text.length / 4));
		});
	});

	suite('IAideAgent', () => {
		test('should have correct structure', () => {
			const agent: IAideAgent = {
				id: 'agent-1',
				name: 'Test Agent',
				createdAt: Date.now(),
				lastActiveAt: Date.now(),
				mode: AideMode.Agent,
				model: 'mock/test-model',
				messages: [],
				attachments: []
			};

			assert.strictEqual(agent.id, 'agent-1');
			assert.strictEqual(agent.name, 'Test Agent');
			assert.strictEqual(agent.mode, AideMode.Agent);
		});
	});

	suite('IAideMessage', () => {
		test('should have correct structure', () => {
			const message: IAideMessage = {
				id: 'msg-1',
				role: AideMessageRole.User,
				content: [{ type: 'text', text: 'Hello' }],
				timestamp: Date.now()
			};

			assert.strictEqual(message.id, 'msg-1');
			assert.strictEqual(message.role, AideMessageRole.User);
			assert.strictEqual(message.content[0].type, 'text');
			assert.strictEqual(message.content[0].text, 'Hello');
		});

		test('should support tool calls', () => {
			const message: IAideMessage = {
				id: 'msg-2',
				role: AideMessageRole.Assistant,
				content: [{
					type: 'tool_call',
					toolCallId: 'call-1',
					toolName: 'read_file',
					toolArguments: { path: '/test.txt' }
				}],
				timestamp: Date.now()
			};

			assert.strictEqual(message.content[0].type, 'tool_call');
			assert.strictEqual(message.content[0].toolName, 'read_file');
		});
	});
});
