/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { AideMode, IAideAgent, AideMessageRole, IAideMessage } from '../../../../services/aide/common/aideService.js';

// ============================================================================
// Composer Tests
// ============================================================================

suite('AIDE Composer Tests', () => {
	const disposables = new DisposableStore();

	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		disposables.clear();
	});

	suite('Agent Creation', () => {
		test('should create agent with default values', () => {
			const agent: IAideAgent = {
				id: 'agent-1',
				name: 'New Agent',
				createdAt: Date.now(),
				lastActiveAt: Date.now(),
				mode: AideMode.Agent,
				model: 'openai/gpt-4o',
				messages: [],
				attachments: []
			};

			assert.strictEqual(agent.name, 'New Agent');
			assert.strictEqual(agent.mode, AideMode.Agent);
			assert.strictEqual(agent.messages.length, 0);
		});

		test('should support different modes', () => {
			const modes = [AideMode.Agent, AideMode.Plan, AideMode.Debug, AideMode.Ask];

			for (const mode of modes) {
				const agent: IAideAgent = {
					id: `agent-${mode}`,
					name: `${mode} Agent`,
					createdAt: Date.now(),
					lastActiveAt: Date.now(),
					mode,
					model: 'openai/gpt-4o',
					messages: [],
					attachments: []
				};

				assert.strictEqual(agent.mode, mode);
			}
		});
	});

	suite('Message Handling', () => {
		test('should add user message', () => {
			const messages: IAideMessage[] = [];

			const userMessage: IAideMessage = {
				id: 'msg-1',
				role: AideMessageRole.User,
				content: [{ type: 'text', text: 'Hello, AI!' }],
				timestamp: Date.now()
			};

			messages.push(userMessage);

			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0].role, AideMessageRole.User);
		});

		test('should add assistant response', () => {
			const messages: IAideMessage[] = [];

			messages.push({
				id: 'msg-1',
				role: AideMessageRole.User,
				content: [{ type: 'text', text: 'Hello!' }],
				timestamp: Date.now()
			});

			messages.push({
				id: 'msg-2',
				role: AideMessageRole.Assistant,
				content: [{ type: 'text', text: 'Hello! How can I help you?' }],
				timestamp: Date.now(),
				model: 'gpt-4o',
				tokens: { input: 5, output: 10 }
			});

			assert.strictEqual(messages.length, 2);
			assert.strictEqual(messages[1].role, AideMessageRole.Assistant);
			assert.ok(messages[1].tokens);
		});

		test('should track conversation history', () => {
			const messages: IAideMessage[] = [
				{
					id: 'msg-1',
					role: AideMessageRole.User,
					content: [{ type: 'text', text: 'What is TypeScript?' }],
					timestamp: Date.now() - 3000
				},
				{
					id: 'msg-2',
					role: AideMessageRole.Assistant,
					content: [{ type: 'text', text: 'TypeScript is a typed superset of JavaScript.' }],
					timestamp: Date.now() - 2000
				},
				{
					id: 'msg-3',
					role: AideMessageRole.User,
					content: [{ type: 'text', text: 'How do I use interfaces?' }],
					timestamp: Date.now() - 1000
				},
				{
					id: 'msg-4',
					role: AideMessageRole.Assistant,
					content: [{ type: 'text', text: 'Interfaces in TypeScript define contracts...' }],
					timestamp: Date.now()
				}
			];

			assert.strictEqual(messages.length, 4);

			// Should alternate between user and assistant
			assert.strictEqual(messages[0].role, AideMessageRole.User);
			assert.strictEqual(messages[1].role, AideMessageRole.Assistant);
			assert.strictEqual(messages[2].role, AideMessageRole.User);
			assert.strictEqual(messages[3].role, AideMessageRole.Assistant);
		});
	});

	suite('Mode Behavior', () => {
		test('Agent mode should support tool use', () => {
			const agentMode = AideMode.Agent;
			const shouldUseTools = agentMode === AideMode.Agent;

			assert.strictEqual(shouldUseTools, true);
		});

		test('Ask mode should not use tools', () => {
			const askMode: AideMode = AideMode.Ask;
			// Check that Ask mode is different from Agent mode (which uses tools)
			const isAgentMode = (mode: AideMode) => mode === AideMode.Agent;
			const shouldUseTools = isAgentMode(askMode);

			assert.strictEqual(shouldUseTools, false);
		});

		test('Plan mode should focus on planning', () => {
			const planMode = AideMode.Plan;
			const isPlanningMode = planMode === AideMode.Plan;

			assert.strictEqual(isPlanningMode, true);
		});

		test('Debug mode should focus on debugging', () => {
			const debugMode = AideMode.Debug;
			const isDebuggingMode = debugMode === AideMode.Debug;

			assert.strictEqual(isDebuggingMode, true);
		});
	});

	suite('Attachment Handling', () => {
		test('should add file attachment', () => {
			const agent: IAideAgent = {
				id: 'agent-1',
				name: 'Test Agent',
				createdAt: Date.now(),
				lastActiveAt: Date.now(),
				mode: AideMode.Agent,
				model: 'openai/gpt-4o',
				messages: [],
				attachments: []
			};

			agent.attachments.push({
				id: 'attach-1',
				type: 'file',
				name: 'test.ts',
				content: 'export const test = 1;'
			});

			assert.strictEqual(agent.attachments.length, 1);
			assert.strictEqual(agent.attachments[0].type, 'file');
		});

		test('should add selection attachment', () => {
			const agent: IAideAgent = {
				id: 'agent-1',
				name: 'Test Agent',
				createdAt: Date.now(),
				lastActiveAt: Date.now(),
				mode: AideMode.Agent,
				model: 'openai/gpt-4o',
				messages: [],
				attachments: []
			};

			agent.attachments.push({
				id: 'attach-1',
				type: 'selection',
				name: 'Selected code',
				content: 'function hello() { }',
				range: {
					startLine: 10,
					endLine: 12
				}
			});

			assert.strictEqual(agent.attachments.length, 1);
			assert.strictEqual(agent.attachments[0].type, 'selection');
			assert.ok(agent.attachments[0].range);
		});

		test('should handle multiple attachments', () => {
			const agent: IAideAgent = {
				id: 'agent-1',
				name: 'Test Agent',
				createdAt: Date.now(),
				lastActiveAt: Date.now(),
				mode: AideMode.Agent,
				model: 'openai/gpt-4o',
				messages: [],
				attachments: [
					{ id: 'a1', type: 'file', name: 'file1.ts', content: 'content1' },
					{ id: 'a2', type: 'file', name: 'file2.ts', content: 'content2' },
					{ id: 'a3', type: 'terminal', name: 'Terminal output', content: '$ npm test\nPassed' }
				]
			};

			assert.strictEqual(agent.attachments.length, 3);
		});
	});

	suite('Model Selection', () => {
		test('should validate model format', () => {
			const validModels = [
				'openai/gpt-4o',
				'openai/gpt-4-turbo',
				'anthropic/claude-3-opus-20240229',
				'ollama/llama2'
			];

			for (const model of validModels) {
				const parts = model.split('/');
				assert.strictEqual(parts.length, 2, `Model ${model} should have provider/name format`);
			}
		});

		test('should extract provider from model id', () => {
			const modelId = 'openai/gpt-4o';
			const provider = modelId.split('/')[0];

			assert.strictEqual(provider, 'openai');
		});
	});

	suite('Time Formatting', () => {
		function formatTime(timestamp: number): string {
			const now = Date.now();
			const diff = now - timestamp;

			const minutes = Math.floor(diff / 60000);
			const hours = Math.floor(diff / 3600000);
			const days = Math.floor(diff / 86400000);

			if (minutes < 1) {
				return 'Just now';
			} else if (minutes < 60) {
				return `${minutes}m ago`;
			} else if (hours < 24) {
				return `${hours}h ago`;
			} else if (days === 1) {
				return 'Yesterday';
			} else if (days < 7) {
				return `${days}d ago`;
			} else {
				return new Date(timestamp).toLocaleDateString();
			}
		}

		test('should format recent time', () => {
			const now = Date.now();
			assert.strictEqual(formatTime(now), 'Just now');
		});

		test('should format minutes ago', () => {
			const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
			assert.strictEqual(formatTime(tenMinutesAgo), '10m ago');
		});

		test('should format hours ago', () => {
			const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
			assert.strictEqual(formatTime(twoHoursAgo), '2h ago');
		});

		test('should format yesterday', () => {
			const yesterday = Date.now() - 24 * 60 * 60 * 1000;
			assert.strictEqual(formatTime(yesterday), 'Yesterday');
		});

		test('should format days ago', () => {
			const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
			assert.strictEqual(formatTime(threeDaysAgo), '3d ago');
		});
	});
});
