/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import {
	AideContextType,
	IAideContextMention,
	IAideContextResult,
	IAideSearchResult
} from '../../common/aideContextService.js';

// ============================================================================
// Tests
// ============================================================================

suite('AIDE Context Service Tests', () => {
	const disposables = new DisposableStore();

	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		disposables.clear();
	});

	suite('AideContextType', () => {
		test('should have correct type values', () => {
			assert.strictEqual(AideContextType.File, 'file');
			assert.strictEqual(AideContextType.Folder, 'folder');
			assert.strictEqual(AideContextType.Selection, 'selection');
			assert.strictEqual(AideContextType.Symbol, 'symbol');
			assert.strictEqual(AideContextType.Codebase, 'codebase');
			assert.strictEqual(AideContextType.Web, 'web');
			assert.strictEqual(AideContextType.Terminal, 'terminal');
			assert.strictEqual(AideContextType.Git, 'git');
			assert.strictEqual(AideContextType.Problems, 'problems');
			assert.strictEqual(AideContextType.Docs, 'docs');
		});
	});

	suite('IAideContextMention', () => {
		test('should have correct structure', () => {
			const mention: IAideContextMention = {
				type: AideContextType.File,
				query: 'test.ts',
				startOffset: 0,
				endOffset: 13
			};

			assert.strictEqual(mention.type, AideContextType.File);
			assert.strictEqual(mention.query, 'test.ts');
		});
	});

	suite('IAideContextResult', () => {
		test('should have correct structure', () => {
			const result: IAideContextResult = {
				type: AideContextType.File,
				uri: URI.file('/test/file.ts'),
				name: 'file.ts',
				content: 'export const test = 1;',
				preview: 'export const test...',
				relevanceScore: 0.95
			};

			assert.strictEqual(result.type, AideContextType.File);
			assert.strictEqual(result.name, 'file.ts');
			assert.strictEqual(result.relevanceScore, 0.95);
		});
	});

	suite('IAideSearchResult', () => {
		test('should have correct structure for semantic search', () => {
			const result: IAideSearchResult = {
				uri: URI.file('/test/file.ts'),
				content: 'function test() { }',
				score: 0.87,
				matchType: 'semantic'
			};

			assert.strictEqual(result.matchType, 'semantic');
			assert.strictEqual(result.score, 0.87);
		});

		test('should have correct structure for lexical search', () => {
			const result: IAideSearchResult = {
				uri: URI.file('/test/file.ts'),
				content: 'const query = "test";',
				score: 1.0,
				matchType: 'lexical',
				range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 20 }
			};

			assert.strictEqual(result.matchType, 'lexical');
			assert.ok(result.range);
		});
	});

	suite('Mention Parsing', () => {
		// Helper function to parse mentions (simulating context service behavior)
		function parseMentions(text: string): IAideContextMention[] {
			const MENTION_REGEX = /@(\w+)(?::([^\s]+))?/g;
			const mentions: IAideContextMention[] = [];
			let match;

			while ((match = MENTION_REGEX.exec(text)) !== null) {
				const typeStr = match[1].toLowerCase();
				const typeMap: Record<string, AideContextType> = {
					'file': AideContextType.File,
					'folder': AideContextType.Folder,
					'codebase': AideContextType.Codebase,
					'web': AideContextType.Web,
					'terminal': AideContextType.Terminal
				};

				const type = typeMap[typeStr];
				if (type !== undefined) {
					mentions.push({
						type,
						query: match[2] || '',
						startOffset: match.index,
						endOffset: match.index + match[0].length
					});
				}
			}

			return mentions;
		}

		test('should parse file mention', () => {
			const mentions = parseMentions('Check @file:test.ts for errors');

			assert.strictEqual(mentions.length, 1);
			assert.strictEqual(mentions[0].type, AideContextType.File);
			assert.strictEqual(mentions[0].query, 'test.ts');
		});

		test('should parse multiple mentions', () => {
			const mentions = parseMentions('@file:a.ts and @file:b.ts');

			assert.strictEqual(mentions.length, 2);
			assert.strictEqual(mentions[0].query, 'a.ts');
			assert.strictEqual(mentions[1].query, 'b.ts');
		});

		test('should parse codebase mention', () => {
			const mentions = parseMentions('Search @codebase:authentication');

			assert.strictEqual(mentions.length, 1);
			assert.strictEqual(mentions[0].type, AideContextType.Codebase);
			assert.strictEqual(mentions[0].query, 'authentication');
		});

		test('should parse mention without query', () => {
			const mentions = parseMentions('Use @terminal output');

			assert.strictEqual(mentions.length, 1);
			assert.strictEqual(mentions[0].type, AideContextType.Terminal);
			assert.strictEqual(mentions[0].query, '');
		});

		test('should handle text with no mentions', () => {
			const mentions = parseMentions('Just regular text here');

			assert.strictEqual(mentions.length, 0);
		});

		test('should capture correct offsets', () => {
			const mentions = parseMentions('prefix @file:test.ts suffix');

			assert.strictEqual(mentions.length, 1);
			assert.strictEqual(mentions[0].startOffset, 7);
			assert.strictEqual(mentions[0].endOffset, 22);
		});
	});

	suite('Cosine Similarity', () => {
		// Helper function simulating the service's cosine similarity
		function cosineSimilarity(a: number[], b: number[]): number {
			if (a.length !== b.length) {
				return 0;
			}

			let dotProduct = 0;
			let normA = 0;
			let normB = 0;

			for (let i = 0; i < a.length; i++) {
				dotProduct += a[i] * b[i];
				normA += a[i] * a[i];
				normB += b[i] * b[i];
			}

			const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
			return magnitude === 0 ? 0 : dotProduct / magnitude;
		}

		test('should return 1 for identical vectors', () => {
			const vec = [1, 2, 3, 4];
			const similarity = cosineSimilarity(vec, vec);

			assert.ok(Math.abs(similarity - 1) < 0.0001);
		});

		test('should return 0 for orthogonal vectors', () => {
			const a = [1, 0, 0];
			const b = [0, 1, 0];
			const similarity = cosineSimilarity(a, b);

			assert.strictEqual(similarity, 0);
		});

		test('should return -1 for opposite vectors', () => {
			const a = [1, 2, 3];
			const b = [-1, -2, -3];
			const similarity = cosineSimilarity(a, b);

			assert.ok(Math.abs(similarity - (-1)) < 0.0001);
		});

		test('should handle zero vectors', () => {
			const a = [0, 0, 0];
			const b = [1, 2, 3];
			const similarity = cosineSimilarity(a, b);

			assert.strictEqual(similarity, 0);
		});

		test('should handle different length vectors', () => {
			const a = [1, 2, 3];
			const b = [1, 2];
			const similarity = cosineSimilarity(a, b);

			assert.strictEqual(similarity, 0);
		});
	});
});
