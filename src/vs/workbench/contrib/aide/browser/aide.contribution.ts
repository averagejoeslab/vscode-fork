/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IAideService } from '../../../services/aide/common/aideService.js';
import { AideService } from '../../../services/aide/browser/aideServiceImpl.js';
import { IAideContextService } from '../../../services/aide/common/aideContextService.js';
import { AideContextService } from '../../../services/aide/browser/aideContextServiceImpl.js';
import { OpenAIProvider } from '../../../services/aide/browser/providers/openaiProvider.js';
import { AnthropicProvider } from '../../../services/aide/browser/providers/anthropicProvider.js';
import { OllamaProvider } from '../../../services/aide/browser/providers/ollamaProvider.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

// ============================================================================
// Register Services
// ============================================================================

registerSingleton(IAideService, AideService, InstantiationType.Delayed);
registerSingleton(IAideContextService, AideContextService, InstantiationType.Delayed);

// ============================================================================
// Configuration
// ============================================================================

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'aide',
	title: localize('aideConfigurationTitle', "AIDE"),
	type: 'object',
	properties: {
		'aide.providers.openai.apiKey': {
			type: 'string',
			default: '',
			description: localize('aide.providers.openai.apiKey', "OpenAI API key for GPT models"),
			scope: 3 // ConfigurationScope.APPLICATION
		},
		'aide.providers.openai.baseUrl': {
			type: 'string',
			default: 'https://api.openai.com/v1',
			description: localize('aide.providers.openai.baseUrl', "OpenAI API base URL (for Azure or proxies)")
		},
		'aide.providers.anthropic.apiKey': {
			type: 'string',
			default: '',
			description: localize('aide.providers.anthropic.apiKey', "Anthropic API key for Claude models"),
			scope: 3
		},
		'aide.providers.anthropic.baseUrl': {
			type: 'string',
			default: 'https://api.anthropic.com',
			description: localize('aide.providers.anthropic.baseUrl', "Anthropic API base URL")
		},
		'aide.providers.ollama.baseUrl': {
			type: 'string',
			default: 'http://localhost:11434',
			description: localize('aide.providers.ollama.baseUrl', "Ollama server URL for local models")
		},
		'aide.defaultModel': {
			type: 'string',
			default: '',
			description: localize('aide.defaultModel', "Default model to use for AI features")
		},
		'aide.tabCompletion.enabled': {
			type: 'boolean',
			default: true,
			description: localize('aide.tabCompletion.enabled', "Enable AI-powered tab completion")
		},
		'aide.tabCompletion.debounceMs': {
			type: 'number',
			default: 150,
			description: localize('aide.tabCompletion.debounceMs', "Debounce delay in milliseconds before requesting completions")
		},
		'aide.tabCompletion.maxTokens': {
			type: 'number',
			default: 256,
			description: localize('aide.tabCompletion.maxTokens', "Maximum tokens for tab completion responses")
		},
		'aide.indexing.enabled': {
			type: 'boolean',
			default: true,
			description: localize('aide.indexing.enabled', "Enable codebase indexing for semantic search")
		},
		'aide.indexing.excludePatterns': {
			type: 'array',
			default: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
			description: localize('aide.indexing.excludePatterns', "Glob patterns to exclude from indexing")
		},
		'aide.chat.streamResponses': {
			type: 'boolean',
			default: true,
			description: localize('aide.chat.streamResponses', "Stream AI responses in chat")
		}
	}
});

// ============================================================================
// Commands
// ============================================================================

// Open Composer command
CommandsRegistry.registerCommand('aide.openComposer', (accessor: ServicesAccessor) => {
	// TODO: Open the composer panel
});

// New Agent command
CommandsRegistry.registerCommand('aide.newAgent', async (accessor: ServicesAccessor) => {
	const aideService = accessor.get(IAideService);
	await aideService.createAgent();
});

// Toggle mode commands
CommandsRegistry.registerCommand('aide.setModeAgent', (accessor: ServicesAccessor) => {
	const aideService = accessor.get(IAideService);
	const agent = aideService.getActiveAgent();
	if (agent) {
		aideService.updateAgent(agent.id, { mode: 'agent' as any });
	}
});

CommandsRegistry.registerCommand('aide.setModePlan', (accessor: ServicesAccessor) => {
	const aideService = accessor.get(IAideService);
	const agent = aideService.getActiveAgent();
	if (agent) {
		aideService.updateAgent(agent.id, { mode: 'plan' as any });
	}
});

CommandsRegistry.registerCommand('aide.setModeDebug', (accessor: ServicesAccessor) => {
	const aideService = accessor.get(IAideService);
	const agent = aideService.getActiveAgent();
	if (agent) {
		aideService.updateAgent(agent.id, { mode: 'debug' as any });
	}
});

CommandsRegistry.registerCommand('aide.setModeAsk', (accessor: ServicesAccessor) => {
	const aideService = accessor.get(IAideService);
	const agent = aideService.getActiveAgent();
	if (agent) {
		aideService.updateAgent(agent.id, { mode: 'ask' as any });
	}
});

// Index workspace command
CommandsRegistry.registerCommand('aide.indexWorkspace', async (accessor: ServicesAccessor) => {
	const contextService = accessor.get(IAideContextService);
	const { CancellationToken } = await import('../../../../base/common/cancellation.js');
	await contextService.indexWorkspace(CancellationToken.None);
});

// ============================================================================
// Keybindings
// ============================================================================

KeybindingsRegistry.registerKeybindingRule({
	id: 'aide.openComposer',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyI,
	when: undefined,
});

KeybindingsRegistry.registerKeybindingRule({
	id: 'aide.newAgent',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyN,
	when: undefined,
});

// ============================================================================
// Workbench Contribution
// ============================================================================

class AideContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.aide';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAideService private readonly aideService: IAideService
	) {
		super();

		// Register AI model providers
		this._registerProviders();
	}

	private _registerProviders(): void {
		// Register OpenAI provider
		const openaiProvider = this.instantiationService.createInstance(OpenAIProvider);
		this._register(this.aideService.registerModelProvider(openaiProvider));

		// Register Anthropic provider
		const anthropicProvider = this.instantiationService.createInstance(AnthropicProvider);
		this._register(this.aideService.registerModelProvider(anthropicProvider));

		// Register Ollama provider
		const ollamaProvider = this.instantiationService.createInstance(OllamaProvider);
		this._register(this.aideService.registerModelProvider(ollamaProvider));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AideContribution, LifecyclePhase.Restored);
