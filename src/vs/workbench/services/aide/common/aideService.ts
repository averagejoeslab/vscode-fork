/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

export const enum AideMode {
	Agent = 'agent',
	Plan = 'plan',
	Debug = 'debug',
	Ask = 'ask'
}

export const enum AideMessageRole {
	System = 'system',
	User = 'user',
	Assistant = 'assistant',
	Tool = 'tool'
}

export interface IAideMessageContent {
	type: 'text' | 'image' | 'tool_call' | 'tool_result';
	text?: string;
	imageData?: Uint8Array;
	imageMimeType?: string;
	toolCallId?: string;
	toolName?: string;
	toolArguments?: Record<string, unknown>;
	toolResult?: unknown;
	isError?: boolean;
}

export interface IAideMessage {
	id: string;
	role: AideMessageRole;
	content: IAideMessageContent[];
	timestamp: number;
	model?: string;
	tokens?: {
		input: number;
		output: number;
	};
}

export interface IAideAttachment {
	id: string;
	type: 'file' | 'folder' | 'selection' | 'terminal' | 'image' | 'web' | 'codebase' | 'symbol';
	uri?: URI;
	content?: string;
	preview?: string;
	name: string;
	range?: {
		startLine: number;
		endLine: number;
		startColumn?: number;
		endColumn?: number;
	};
}

export interface IAideAgent {
	id: string;
	name: string;
	createdAt: number;
	lastActiveAt: number;
	mode: AideMode;
	model: string;
	messages: IAideMessage[];
	attachments: IAideAttachment[];
}

export interface IAideCompletionRequest {
	messages: IAideMessage[];
	model: string;
	maxTokens?: number;
	temperature?: number;
	tools?: IAideTool[];
	stream?: boolean;
}

export interface IAideCompletionResponse {
	id: string;
	content: IAideMessageContent[];
	model: string;
	finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
	usage?: {
		inputTokens: number;
		outputTokens: number;
	};
}

export interface IAideStreamChunk {
	id: string;
	delta: Partial<IAideMessageContent>;
	finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface IAideTool {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, {
			type: string;
			description: string;
			enum?: string[];
		}>;
		required?: string[];
	};
}

export interface IAideToolResult {
	toolCallId: string;
	result: unknown;
	isError?: boolean;
}

// ============================================================================
// Model Provider Interface
// ============================================================================

export interface IAideModelInfo {
	id: string;
	name: string;
	provider: string;
	contextLength: number;
	supportsVision: boolean;
	supportsTools: boolean;
	supportsStreaming: boolean;
}

export interface IAideModelProvider {
	readonly id: string;
	readonly name: string;
	readonly onDidChangeModels: Event<void>;

	getAvailableModels(): Promise<IAideModelInfo[]>;

	chat(
		request: IAideCompletionRequest,
		token: CancellationToken
	): Promise<IAideCompletionResponse>;

	chatStream(
		request: IAideCompletionRequest,
		token: CancellationToken
	): AsyncIterable<IAideStreamChunk>;

	countTokens(text: string, model: string): Promise<number>;
}

// ============================================================================
// Embedding Provider Interface
// ============================================================================

export interface IAideEmbeddingProvider {
	readonly id: string;
	readonly name: string;

	embed(texts: string[], model?: string): Promise<number[][]>;
	getEmbeddingDimension(model?: string): number;
}

// ============================================================================
// Main AIDE Service Interface
// ============================================================================

export const IAideService = createDecorator<IAideService>('aideService');

export interface IAideService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onDidChangeAgents: Event<void>;
	readonly onDidChangeModels: Event<void>;
	readonly onDidChangeActiveAgent: Event<IAideAgent | undefined>;

	// Model Providers
	registerModelProvider(provider: IAideModelProvider): IDisposable;
	getModelProviders(): IAideModelProvider[];
	getAvailableModels(): Promise<IAideModelInfo[]>;
	getDefaultModel(): Promise<IAideModelInfo | undefined>;
	setDefaultModel(modelId: string): Promise<void>;

	// Embedding Providers
	registerEmbeddingProvider(provider: IAideEmbeddingProvider): IDisposable;
	getEmbeddingProviders(): IAideEmbeddingProvider[];

	// Agent Management
	createAgent(name?: string, mode?: AideMode): Promise<IAideAgent>;
	getAgents(): IAideAgent[];
	getAgent(id: string): IAideAgent | undefined;
	getActiveAgent(): IAideAgent | undefined;
	setActiveAgent(id: string): void;
	deleteAgent(id: string): Promise<void>;
	updateAgent(id: string, updates: Partial<Pick<IAideAgent, 'name' | 'mode' | 'model'>>): void;

	// Chat
	sendMessage(
		agentId: string,
		content: string,
		attachments?: IAideAttachment[],
		token?: CancellationToken
	): Promise<IAideMessage>;

	sendMessageStream(
		agentId: string,
		content: string,
		attachments?: IAideAttachment[],
		token?: CancellationToken
	): AsyncIterable<IAideStreamChunk>;

	// Tools
	registerTool(tool: IAideTool, handler: (args: Record<string, unknown>) => Promise<unknown>): IDisposable;
	executeToolCall(toolName: string, args: Record<string, unknown>): Promise<IAideToolResult>;

	// Utility
	countTokens(text: string, model?: string): Promise<number>;
}
