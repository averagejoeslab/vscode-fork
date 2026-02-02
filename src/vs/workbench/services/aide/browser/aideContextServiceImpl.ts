/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ISearchService, QueryType } from '../../../services/search/common/search.js';
import { IAideAttachment, IAideEmbeddingProvider, IAideService } from '../common/aideService.js';
import {
	AideContextType,
	IAideContextMention,
	IAideContextProvider,
	IAideContextResult,
	IAideContextService,
	IAideIndexedFile,
	IAideSearchResult
} from '../common/aideContextService.js';

const MENTION_REGEX = /@(\w+)(?::([^\s]+))?/g;

export class AideContextService extends Disposable implements IAideContextService {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Map<AideContextType, IAideContextProvider>();
	private readonly _index = new Map<string, IAideIndexedFile>();
	private _isIndexing = false;
	private _indexedCount = 0;
	private _totalFiles = 0;

	private readonly _onDidChangeIndex = this._register(new Emitter<void>());
	readonly onDidChangeIndex = this._onDidChangeIndex.event;

	private readonly _onDidChangeProviders = this._register(new Emitter<void>());
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IFileService private readonly _fileService: IFileService,
		@ISearchService private readonly _searchService: ISearchService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAideService private readonly _aideService: IAideService
	) {
		super();

		// Register built-in context providers
		this._registerBuiltInProviders();

		// Watch for file changes to update index
		this._register(this._fileService.onDidFilesChange(e => {
			for (const change of e.rawChanges || []) {
				if (change.type === 1) { // ADDED
					this.indexFile(change.resource, CancellationToken.None);
				} else if (change.type === 2) { // DELETED
					this.removeFromIndex(change.resource);
				} else if (change.type === 0) { // UPDATED
					this.indexFile(change.resource, CancellationToken.None);
				}
			}
		}));
	}

	// ========================================================================
	// Provider Management
	// ========================================================================

	registerContextProvider(provider: IAideContextProvider): IDisposable {
		if (this._providers.has(provider.type)) {
			throw new Error(`Context provider for type '${provider.type}' already registered`);
		}

		this._providers.set(provider.type, provider);
		this._onDidChangeProviders.fire();

		return toDisposable(() => {
			this._providers.delete(provider.type);
			this._onDidChangeProviders.fire();
		});
	}

	getContextProviders(): IAideContextProvider[] {
		return Array.from(this._providers.values());
	}

	getContextProvider(type: AideContextType): IAideContextProvider | undefined {
		return this._providers.get(type);
	}

	// ========================================================================
	// Context Resolution
	// ========================================================================

	parseMentions(text: string): IAideContextMention[] {
		const mentions: IAideContextMention[] = [];
		let match;

		MENTION_REGEX.lastIndex = 0;
		while ((match = MENTION_REGEX.exec(text)) !== null) {
			const type = this._parseContextType(match[1]);
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

	async resolveAttachments(mentions: IAideContextMention[], token: CancellationToken): Promise<IAideAttachment[]> {
		const attachments: IAideAttachment[] = [];

		for (const mention of mentions) {
			if (token.isCancellationRequested) {
				break;
			}

			const provider = this._providers.get(mention.type);
			if (!provider) {
				continue;
			}

			try {
				const results = await provider.provideCompletions(mention.query, token);
				if (results.length > 0) {
					const result = results[0]; // Use first match
					const content = await provider.resolveContext(result, token);

					attachments.push({
						id: generateUuid(),
						type: this._mapContextTypeToAttachmentType(mention.type),
						uri: result.uri,
						content,
						preview: result.preview || content.slice(0, 200),
						name: result.name
					});
				}
			} catch (error) {
				this._logService.error(`[AideContext] Failed to resolve mention:`, error);
			}
		}

		return attachments;
	}

	async getCompletions(type: AideContextType, query: string, token: CancellationToken): Promise<IAideContextResult[]> {
		const provider = this._providers.get(type);
		if (!provider) {
			return [];
		}

		return provider.provideCompletions(query, token);
	}

	// ========================================================================
	// Codebase Indexing
	// ========================================================================

	async indexWorkspace(token: CancellationToken): Promise<void> {
		if (this._isIndexing) {
			this._logService.warn('[AideContext] Already indexing workspace');
			return;
		}

		this._isIndexing = true;
		this._indexedCount = 0;
		this._onDidChangeIndex.fire();

		try {
			const folders = this._workspaceContextService.getWorkspace().folders;
			const excludePatterns = this._configurationService.getValue<string[]>('aide.indexing.excludePatterns') || [
				'**/node_modules/**',
				'**/.git/**',
				'**/dist/**',
				'**/build/**',
				'**/*.min.js',
				'**/*.map'
			];

			for (const folder of folders) {
				if (token.isCancellationRequested) {
					break;
				}

				// Search for all files in the workspace
				const results = await this._searchService.fileSearch({
					type: QueryType.File,
					folderQueries: [{ folder: folder.uri }],
					excludePattern: excludePatterns.reduce((acc, pattern) => ({ ...acc, [pattern]: true }), {}),
					maxResults: 10000
				}, token);

				this._totalFiles = results.results.length;

				for (const file of results.results) {
					if (token.isCancellationRequested) {
						break;
					}

					await this.indexFile(file.resource, token);
				}
			}

			this._logService.info(`[AideContext] Indexed ${this._indexedCount} files`);
		} finally {
			this._isIndexing = false;
			this._onDidChangeIndex.fire();
		}
	}

	async indexFile(uri: URI, token: CancellationToken): Promise<void> {
		try {
			// Check file size - skip large files
			const stat = await this._fileService.stat(uri);
			if (stat.size > 1024 * 1024) { // Skip files > 1MB
				return;
			}

			// Read file content
			const content = await this._fileService.readFile(uri);
			const text = content.value.toString();

			// Generate embedding if provider available
			let embedding: number[] | undefined;
			const embeddingProviders = this._aideService.getEmbeddingProviders();
			if (embeddingProviders.length > 0) {
				try {
					const embeddings = await embeddingProviders[0].embed([text]);
					embedding = embeddings[0];
				} catch (e) {
					// Embedding failed, continue without it
				}
			}

			// Store in index
			this._index.set(uri.toString(), {
				uri,
				content: text,
				embedding,
				lastModified: stat.mtime
			});

			this._indexedCount++;

			if (this._isIndexing && this._indexedCount % 100 === 0) {
				this._onDidChangeIndex.fire();
			}
		} catch (error) {
			// File might not exist or be readable
		}
	}

	async removeFromIndex(uri: URI): Promise<void> {
		this._index.delete(uri.toString());
	}

	getIndexStatus(): { indexed: number; total: number; isIndexing: boolean } {
		return {
			indexed: this._indexedCount,
			total: this._totalFiles,
			isIndexing: this._isIndexing
		};
	}

	// ========================================================================
	// Search
	// ========================================================================

	async semanticSearch(query: string, limit: number = 10, token?: CancellationToken): Promise<IAideSearchResult[]> {
		const embeddingProviders = this._aideService.getEmbeddingProviders();
		if (embeddingProviders.length === 0) {
			// Fall back to lexical search
			return this.lexicalSearch(query, limit, token);
		}

		try {
			const [queryEmbedding] = await embeddingProviders[0].embed([query]);

			const results: IAideSearchResult[] = [];

			for (const [, file] of this._index) {
				if (token?.isCancellationRequested) {
					break;
				}

				if (file.embedding) {
					const score = this._cosineSimilarity(queryEmbedding, file.embedding);
					results.push({
						uri: file.uri,
						content: file.content,
						score,
						matchType: 'semantic'
					});
				}
			}

			// Sort by score descending
			results.sort((a, b) => b.score - a.score);

			return results.slice(0, limit);
		} catch (error) {
			this._logService.error('[AideContext] Semantic search failed:', error);
			return this.lexicalSearch(query, limit, token);
		}
	}

	async lexicalSearch(query: string, limit: number = 10, token?: CancellationToken): Promise<IAideSearchResult[]> {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return [];
		}

		try {
			const searchResults = await this._searchService.textSearch({
				type: QueryType.Text,
				contentPattern: { pattern: query },
				folderQueries: folders.map(f => ({ folder: f.uri })),
				maxResults: limit
			}, token || CancellationToken.None);

			return searchResults.results.map(result => ({
				uri: result.resource,
				content: result.preview?.text || '',
				score: 1.0,
				matchType: 'lexical' as const,
				range: result.preview?.matches?.[0]
			}));
		} catch (error) {
			this._logService.error('[AideContext] Lexical search failed:', error);
			return [];
		}
	}

	async symbolSearch(query: string, limit: number = 10, token?: CancellationToken): Promise<IAideSearchResult[]> {
		// Use workspace symbol search
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return [];
		}

		// For now, fall back to lexical search with symbol-like patterns
		const symbolPattern = `(class|function|const|let|var|interface|type|enum)\\s+${query}`;
		return this.lexicalSearch(symbolPattern, limit, token);
	}

	// ========================================================================
	// Context Building
	// ========================================================================

	async buildContext(attachments: IAideAttachment[], maxTokens: number): Promise<string> {
		const parts: string[] = [];
		let currentTokens = 0;

		for (const attachment of attachments) {
			if (!attachment.content) {
				continue;
			}

			const estimatedTokens = await this._aideService.countTokens(attachment.content);

			if (currentTokens + estimatedTokens > maxTokens) {
				// Truncate content to fit
				const remainingTokens = maxTokens - currentTokens;
				const truncatedContent = attachment.content.slice(0, remainingTokens * 4); // Rough estimate
				parts.push(this._formatAttachment(attachment, truncatedContent));
				break;
			}

			parts.push(this._formatAttachment(attachment, attachment.content));
			currentTokens += estimatedTokens;
		}

		return parts.join('\n\n');
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	private _registerBuiltInProviders(): void {
		// File provider
		this.registerContextProvider({
			type: AideContextType.File,
			triggerCharacter: '@',
			name: 'File',
			description: 'Reference a file from the workspace',
			provideCompletions: async (query, token) => {
				const folders = this._workspaceContextService.getWorkspace().folders;
				if (folders.length === 0) {
					return [];
				}

				const results = await this._searchService.fileSearch({
					type: QueryType.File,
					folderQueries: folders.map(f => ({ folder: f.uri })),
					filePattern: query ? `*${query}*` : '*',
					maxResults: 20
				}, token);

				return results.results.map(r => ({
					type: AideContextType.File,
					uri: r.resource,
					name: r.resource.path.split('/').pop() || r.resource.path,
					content: '',
					preview: r.resource.path
				}));
			},
			resolveContext: async (result, _token) => {
				if (!result.uri) {
					return '';
				}
				try {
					const content = await this._fileService.readFile(result.uri);
					return content.value.toString();
				} catch {
					return '';
				}
			}
		});

		// Folder provider
		this.registerContextProvider({
			type: AideContextType.Folder,
			triggerCharacter: '@',
			name: 'Folder',
			description: 'Reference a folder from the workspace',
			provideCompletions: async (query, _token) => {
				const folders = this._workspaceContextService.getWorkspace().folders;
				return folders
					.filter(f => !query || f.name.toLowerCase().includes(query.toLowerCase()))
					.map(f => ({
						type: AideContextType.Folder,
						uri: f.uri,
						name: f.name,
						content: '',
						preview: f.uri.path
					}));
			},
			resolveContext: async (result, token) => {
				if (!result.uri) {
					return '';
				}

				// Get file list from folder
				const files = await this._searchService.fileSearch({
					type: QueryType.File,
					folderQueries: [{ folder: result.uri }],
					maxResults: 50
				}, token);

				return files.results.map(f => f.resource.path).join('\n');
			}
		});

		// Codebase provider (semantic search)
		this.registerContextProvider({
			type: AideContextType.Codebase,
			triggerCharacter: '@',
			name: 'Codebase',
			description: 'Search the entire codebase semantically',
			provideCompletions: async (query, token) => {
				const results = await this.semanticSearch(query, 5, token);
				return results.map(r => ({
					type: AideContextType.Codebase,
					uri: r.uri,
					name: r.uri.path.split('/').pop() || r.uri.path,
					content: r.content,
					preview: r.content.slice(0, 200),
					relevanceScore: r.score
				}));
			},
			resolveContext: async (result, _token) => {
				return result.content;
			}
		});

		// Web provider
		this.registerContextProvider({
			type: AideContextType.Web,
			triggerCharacter: '@',
			name: 'Web',
			description: 'Search the web for information',
			provideCompletions: async (query, _token) => {
				// Placeholder - would need actual web search implementation
				return [{
					type: AideContextType.Web,
					name: `Web search: ${query}`,
					content: '',
					preview: `Search results for "${query}"`
				}];
			},
			resolveContext: async (_result, _token) => {
				// Placeholder
				return 'Web search results would appear here';
			}
		});

		// Terminal provider
		this.registerContextProvider({
			type: AideContextType.Terminal,
			triggerCharacter: '@',
			name: 'Terminal',
			description: 'Reference terminal output',
			provideCompletions: async (_query, _token) => {
				// Placeholder - would integrate with terminal service
				return [{
					type: AideContextType.Terminal,
					name: 'Recent terminal output',
					content: '',
					preview: 'Terminal output'
				}];
			},
			resolveContext: async (_result, _token) => {
				// Placeholder - would get actual terminal content
				return 'Terminal output would appear here';
			}
		});
	}

	private _parseContextType(typeStr: string): AideContextType | undefined {
		const typeMap: Record<string, AideContextType> = {
			'file': AideContextType.File,
			'folder': AideContextType.Folder,
			'selection': AideContextType.Selection,
			'symbol': AideContextType.Symbol,
			'codebase': AideContextType.Codebase,
			'web': AideContextType.Web,
			'terminal': AideContextType.Terminal,
			'git': AideContextType.Git,
			'problems': AideContextType.Problems,
			'docs': AideContextType.Docs
		};

		return typeMap[typeStr.toLowerCase()];
	}

	private _mapContextTypeToAttachmentType(type: AideContextType): IAideAttachment['type'] {
		switch (type) {
			case AideContextType.File:
				return 'file';
			case AideContextType.Folder:
				return 'folder';
			case AideContextType.Selection:
				return 'selection';
			case AideContextType.Terminal:
				return 'terminal';
			case AideContextType.Web:
				return 'web';
			case AideContextType.Codebase:
				return 'codebase';
			case AideContextType.Symbol:
				return 'symbol';
			default:
				return 'file';
		}
	}

	private _formatAttachment(attachment: IAideAttachment, content: string): string {
		const header = attachment.uri
			? `--- ${attachment.name} (${attachment.uri.path}) ---`
			: `--- ${attachment.name} ---`;

		return `${header}\n${content}`;
	}

	private _cosineSimilarity(a: number[], b: number[]): number {
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
}
