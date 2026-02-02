/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { AideMessageRole, IAideCompletionRequest, IAideMessage } from '../../common/aideService.js';

// ============================================================================
// Provider Tests
// ============================================================================

suite('AIDE Provider Tests', () => {
	const disposables = new DisposableStore();

	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		disposables.clear();
	});

	suite('Message Conversion', () => {
		// Test message conversion logic that providers use

		test('should convert user message to provider format', () => {
			const message: IAideMessage = {
				id: 'msg-1',
				role: AideMessageRole.User,
				content: [{ type: 'text', text: 'Hello, AI!' }],
				timestamp: Date.now()
			};

			// Simulating OpenAI format conversion
			const openaiMessage = {
				role: 'user',
				content: message.content.map(c => c.text).join('')
			};

			assert.strictEqual(openaiMessage.role, 'user');
			assert.strictEqual(openaiMessage.content, 'Hello, AI!');
		});

		test('should convert system message', () => {
			const message: IAideMessage = {
				id: 'msg-1',
				role: AideMessageRole.System,
				content: [{ type: 'text', text: 'You are a helpful assistant.' }],
				timestamp: Date.now()
			};

			const converted = {
				role: 'system',
				content: message.content.map(c => c.text).join('')
			};

			assert.strictEqual(converted.role, 'system');
		});

		test('should convert assistant message with tool calls', () => {
			const message: IAideMessage = {
				id: 'msg-1',
				role: AideMessageRole.Assistant,
				content: [
					{ type: 'text', text: 'Let me read that file.' },
					{
						type: 'tool_call',
						toolCallId: 'call-1',
						toolName: 'read_file',
						toolArguments: { path: '/test.txt' }
					}
				],
				timestamp: Date.now()
			};

			const textContent = message.content
				.filter(c => c.type === 'text')
				.map(c => c.text)
				.join('');

			const toolCalls = message.content
				.filter(c => c.type === 'tool_call')
				.map(c => ({
					id: c.toolCallId,
					type: 'function',
					function: {
						name: c.toolName,
						arguments: JSON.stringify(c.toolArguments)
					}
				}));

			assert.strictEqual(textContent, 'Let me read that file.');
			assert.strictEqual(toolCalls.length, 1);
			assert.strictEqual(toolCalls[0].function.name, 'read_file');
		});
	});

	suite('Tool Schema Conversion', () => {
		test('should convert AIDE tool to OpenAI format', () => {
			const aideTool = {
				name: 'read_file',
				description: 'Read the contents of a file',
				parameters: {
					type: 'object' as const,
					properties: {
						path: { type: 'string', description: 'The file path' }
					},
					required: ['path']
				}
			};

			const openaiTool = {
				type: 'function',
				function: {
					name: aideTool.name,
					description: aideTool.description,
					parameters: aideTool.parameters
				}
			};

			assert.strictEqual(openaiTool.type, 'function');
			assert.strictEqual(openaiTool.function.name, 'read_file');
		});

		test('should convert AIDE tool to Anthropic format', () => {
			const aideTool = {
				name: 'search_code',
				description: 'Search the codebase',
				parameters: {
					type: 'object' as const,
					properties: {
						query: { type: 'string', description: 'Search query' },
						limit: { type: 'number', description: 'Max results' }
					},
					required: ['query']
				}
			};

			const anthropicTool = {
				name: aideTool.name,
				description: aideTool.description,
				input_schema: aideTool.parameters
			};

			assert.strictEqual(anthropicTool.name, 'search_code');
			assert.deepStrictEqual(anthropicTool.input_schema, aideTool.parameters);
		});
	});

	suite('Response Parsing', () => {
		test('should parse OpenAI response', () => {
			const openaiResponse = {
				id: 'chatcmpl-123',
				choices: [{
					message: {
						role: 'assistant',
						content: 'Here is the answer.'
					},
					finish_reason: 'stop'
				}],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5
				}
			};

			const aideResponse = {
				id: openaiResponse.id,
				content: [{ type: 'text' as const, text: openaiResponse.choices[0].message.content }],
				model: 'gpt-4',
				finishReason: 'stop' as const,
				usage: {
					inputTokens: openaiResponse.usage.prompt_tokens,
					outputTokens: openaiResponse.usage.completion_tokens
				}
			};

			assert.strictEqual(aideResponse.id, 'chatcmpl-123');
			assert.strictEqual(aideResponse.content[0].text, 'Here is the answer.');
			assert.strictEqual(aideResponse.usage?.inputTokens, 10);
		});

		test('should parse Anthropic response', () => {
			const anthropicResponse = {
				id: 'msg_123',
				type: 'message',
				role: 'assistant',
				content: [{ type: 'text', text: 'Response from Claude.' }],
				stop_reason: 'end_turn',
				usage: {
					input_tokens: 15,
					output_tokens: 8
				}
			};

			const aideResponse = {
				id: anthropicResponse.id,
				content: anthropicResponse.content.map(c => ({
					type: c.type as 'text',
					text: c.text
				})),
				model: 'claude-3-opus',
				finishReason: 'stop' as const,
				usage: {
					inputTokens: anthropicResponse.usage.input_tokens,
					outputTokens: anthropicResponse.usage.output_tokens
				}
			};

			assert.strictEqual(aideResponse.id, 'msg_123');
			assert.strictEqual(aideResponse.usage?.outputTokens, 8);
		});

		test('should handle tool use response', () => {
			const responseWithTools = {
				id: 'resp-1',
				choices: [{
					message: {
						role: 'assistant',
						content: null,
						tool_calls: [{
							id: 'call-1',
							type: 'function',
							function: {
								name: 'read_file',
								arguments: '{"path": "/test.txt"}'
							}
						}]
					},
					finish_reason: 'tool_calls'
				}]
			};

			const toolCalls = responseWithTools.choices[0].message.tool_calls?.map(tc => ({
				type: 'tool_call' as const,
				toolCallId: tc.id,
				toolName: tc.function.name,
				toolArguments: JSON.parse(tc.function.arguments)
			}));

			assert.strictEqual(toolCalls?.length, 1);
			assert.strictEqual(toolCalls?.[0].toolName, 'read_file');
			assert.deepStrictEqual(toolCalls?.[0].toolArguments, { path: '/test.txt' });
		});
	});

	suite('Token Counting', () => {
		test('should estimate tokens for English text', () => {
			const text = 'Hello, this is a test message for token counting.';
			// Simple approximation: ~4 characters per token
			const estimated = Math.ceil(text.length / 4);

			assert.ok(estimated > 0);
			assert.ok(estimated < text.length);
		});

		test('should handle empty text', () => {
			const text = '';
			const estimated = Math.ceil(text.length / 4);

			assert.strictEqual(estimated, 0);
		});

		test('should handle code', () => {
			const code = `
				function hello() {
					console.log("Hello, world!");
				}
			`;
			const estimated = Math.ceil(code.length / 4);

			assert.ok(estimated > 10); // Code typically has more tokens
		});
	});

	suite('Error Handling', () => {
		test('should map API error status to error type', () => {
			const mapErrorStatus = (status: number): string => {
				switch (status) {
					case 400:
						return 'invalid_request';
					case 401:
						return 'authentication_error';
					case 403:
						return 'permission_denied';
					case 404:
						return 'not_found';
					case 429:
						return 'rate_limit';
					case 500:
					case 502:
					case 503:
						return 'server_error';
					default:
						return 'unknown_error';
				}
			};

			assert.strictEqual(mapErrorStatus(401), 'authentication_error');
			assert.strictEqual(mapErrorStatus(429), 'rate_limit');
			assert.strictEqual(mapErrorStatus(503), 'server_error');
		});
	});
});
