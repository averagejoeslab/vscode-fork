/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAideAttachment } from './aideService.js';

// ============================================================================
// Context Types
// ============================================================================

export const enum AideContextType {
	File = 'file',
	Folder = 'folder',
	Selection = 'selection',
	Symbol = 'symbol',
	Codebase = 'codebase',
	Web = 'web',
	Terminal = 'terminal',
	Git = 'git',
	Problems = 'problems',
	Docs = 'docs'
}

export interface IAideContextMention {
	type: AideContextType;
	query: string;
	startOffset: number;
	endOffset: number;
}

export interface IAideContextResult {
	type: AideContextType;
	uri?: URI;
	name: string;
	content: string;
	preview?: string;
	relevanceScore?: number;
	range?: IRange;
	metadata?: Record<string, unknown>;
}

export interface IAideContextProvider {
	readonly type: AideContextType;
	readonly triggerCharacter: string;
	readonly name: string;
	readonly description: string;

	provideCompletions(query: string, token: CancellationToken): Promise<IAideContextResult[]>;
	resolveContext(result: IAideContextResult, token: CancellationToken): Promise<string>;
}

// ============================================================================
// Codebase Index Types
// ============================================================================

export interface IAideIndexedFile {
	uri: URI;
	content: string;
	embedding?: number[];
	lastModified: number;
	symbols?: IAideIndexedSymbol[];
}

export interface IAideIndexedSymbol {
	name: string;
	kind: string;
	range: IRange;
	detail?: string;
}

export interface IAideSearchResult {
	uri: URI;
	content: string;
	score: number;
	range?: IRange;
	matchType: 'semantic' | 'lexical' | 'symbol';
}

// ============================================================================
// Context Service Interface
// ============================================================================

export const IAideContextService = createDecorator<IAideContextService>('aideContextService');

export interface IAideContextService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onDidChangeIndex: Event<void>;
	readonly onDidChangeProviders: Event<void>;

	// Provider Management
	registerContextProvider(provider: IAideContextProvider): IDisposable;
	getContextProviders(): IAideContextProvider[];
	getContextProvider(type: AideContextType): IAideContextProvider | undefined;

	// Context Resolution
	parseMentions(text: string): IAideContextMention[];
	resolveAttachments(mentions: IAideContextMention[], token: CancellationToken): Promise<IAideAttachment[]>;
	getCompletions(type: AideContextType, query: string, token: CancellationToken): Promise<IAideContextResult[]>;

	// Codebase Indexing
	indexWorkspace(token: CancellationToken): Promise<void>;
	indexFile(uri: URI, token: CancellationToken): Promise<void>;
	removeFromIndex(uri: URI): Promise<void>;
	getIndexStatus(): { indexed: number; total: number; isIndexing: boolean };

	// Semantic Search
	semanticSearch(query: string, limit?: number, token?: CancellationToken): Promise<IAideSearchResult[]>;
	lexicalSearch(query: string, limit?: number, token?: CancellationToken): Promise<IAideSearchResult[]>;
	symbolSearch(query: string, limit?: number, token?: CancellationToken): Promise<IAideSearchResult[]>;

	// Context Building
	buildContext(attachments: IAideAttachment[], maxTokens: number): Promise<string>;
}
