# AI-Native IDE Specification

> A VSCode fork with native AI integration, inspired by Cursor

## Project Overview

**Goal:** Create an open-source AI-native IDE by forking VSCode and integrating AI capabilities at the core, similar to Cursor.

**Base Repository:** https://github.com/microsoft/vscode

---

## Table of Contents

1. [Feature Requirements](#feature-requirements)
2. [VSCode Architecture Reference](#vscode-architecture-reference)
3. [Implementation Phases](#implementation-phases)
4. [Technical Specifications](#technical-specifications)
5. [UI/UX Specifications](#uiux-specifications)

---

## Feature Requirements

### 1. Composer Panel (Primary AI Interface)

The Composer is a unified AI interface panel that supports multiple interaction modes and agent management.

#### 1.1 Four Interaction Modes

| Mode | Icon | Shortcut | Purpose |
|------|------|----------|---------|
| **Agent** | ∞ | ⌘I | Autonomous multi-file changes, tool use, iterative refinement |
| **Plan** | ≡ | - | Planning mode for complex tasks, generates step-by-step plans before execution |
| **Debug** | ⚙ | - | Hypothesis-driven debugging, instruments code, analyzes logs, proposes fixes |
| **Ask** | 💬 | ⌘L | Q&A mode for asking questions about code without making changes |

#### 1.2 Agent Management

- **Multiple Agents**: Users can create and manage multiple AI agents
- **Agent Sidebar**: Right panel showing list of agents with search functionality
- **Agent History**: Each agent maintains its own conversation history
- **New Agent Button**: Create fresh agent instances
- **Agent Naming**: Agents can be renamed and organized

#### 1.3 Model Selection

- **Model Picker**: Dropdown to select AI model (e.g., "Opus 4.5", "GPT-4", "Claude Sonnet")
- **Speed/Cost Multiplier**: Option like "1x", "2x" for quality vs speed tradeoffs
- **Custom Model Support**: Allow users to configure custom API endpoints

#### 1.4 Input Features

- **Text Input**: Primary chat input with placeholder "Plan, @ for context, / for commands"
- **@ Mentions**: Type `@` to reference context (files, folders, symbols, docs)
- **/ Commands**: Type `/` for slash commands
- **Voice Input**: Microphone button for voice-to-text
- **Image Input**: Ability to paste/upload images for vision models
- **Web Search**: Globe icon to enable web search context

### 2. Context System (@ Mentions)

#### 2.1 Supported Context Types

| Mention | Description |
|---------|-------------|
| `@file.ts` | Include specific file content |
| `@folder/` | Include all files in a folder |
| `@codebase` | Semantic search across entire project |
| `@symbol` | Reference specific function/class/variable |
| `@docs` | Include external documentation |
| `@web` | Search the web for context |
| `@git` | Include git history/diff context |
| `@terminal` | Include terminal output |
| `@selection` | Include currently selected text |
| `@problems` | Include current errors/warnings |

#### 2.2 Drag-and-Drop Context

- **File Drag**: Drag files from explorer into chat to add as context
- **Text Selection**: Select code and drag into chat or use keyboard shortcut
- **Terminal Selection**: Select terminal output and add to chat context
- **Image Drag**: Drag images for vision model analysis

#### 2.3 Context Chips

- Visual chips showing what context is attached
- Click to expand/preview context
- X button to remove context
- Drag to reorder priority

### 3. Tab Completion (Inline AI Suggestions)

#### 3.1 Core Features

- **Multi-line Predictions**: Suggest multiple lines, not just single line completion
- **Ghost Text**: Semi-transparent preview of suggested code
- **Diff Popup**: Show changes as diff when modifying existing code
- **Fast Response**: Target <320ms latency for suggestions
- **Learning**: Improve suggestions based on accept/reject patterns

#### 3.2 Acceptance Controls

| Action | Key | Description |
|--------|-----|-------------|
| Accept all | `Tab` | Accept entire suggestion |
| Reject | `Escape` | Dismiss suggestion |
| Accept word | `⌘→` | Accept next word only |
| Accept line | `⌘⇧→` | Accept current line only |

#### 3.3 Auto-imports

- Automatically add import statements when completing code that requires them
- Support for TypeScript, JavaScript, Python, Go, Rust, etc.

### 4. Inline Edit (⌘K)

#### 4.1 Features

- **Natural Language Editing**: Describe changes in plain English
- **Selection-based**: Works on selected code or at cursor position
- **Diff Preview**: Show proposed changes before applying
- **Accept/Reject**: Approve or dismiss changes
- **Iterative Refinement**: Provide feedback to adjust changes

#### 4.2 Terminal Integration

- **⌘K in Terminal**: Generate terminal commands from natural language
- **Command Explanation**: Explain what a command does before running
- **Error Fixing**: Suggest fixes for failed commands

### 5. Agent Capabilities

#### 5.1 Tool Use

Agents should have access to:

| Tool | Description |
|------|-------------|
| **File Read** | Read file contents |
| **File Write** | Create or modify files |
| **File Delete** | Remove files |
| **Terminal** | Execute shell commands |
| **Search** | Search codebase (text and semantic) |
| **Web Browse** | Fetch web content |
| **Git** | Git operations (commit, branch, etc.) |

#### 5.2 Multi-file Editing

- Orchestrate changes across multiple files
- Show all pending changes before applying
- Atomic apply/reject for related changes
- Checkpoint/rollback support

#### 5.3 Background Agents

- Run agents in background while continuing to code
- Notification when agent completes
- Queue multiple agent tasks

### 6. Codebase Indexing

#### 6.1 Semantic Search

- **Embeddings**: Generate embeddings for all code files
- **Vector Store**: Local or remote vector database
- **Incremental Updates**: Update index on file changes
- **Cross-file Understanding**: Understand relationships between files

#### 6.2 Index Scope

- Full project indexing
- Exclude patterns (.gitignore, custom)
- Dependency indexing (node_modules optional)

### 7. Configuration System

#### 7.1 Rules (`.aide/rules/`)

Always-on constraints and guidelines for AI behavior:

```yaml
# .aide/rules/style.yaml
name: Code Style
description: Enforce project coding standards
rules:
  - Use TypeScript strict mode
  - Prefer async/await over callbacks
  - Use functional components in React
```

#### 7.2 Skills (`.aide/skills/`)

Reusable workflows and specialized commands:

```yaml
# .aide/skills/test.yaml
name: Generate Tests
trigger: /test
description: Generate unit tests for selected code
steps:
  - Analyze the selected code
  - Generate Jest/Vitest test cases
  - Include edge cases and error scenarios
```

#### 7.3 Project Context (`.aide/context.md`)

Project-specific information for AI:

```markdown
# Project Context

## Architecture
This is a Next.js 14 application using App Router...

## Conventions
- API routes in /app/api
- Components in /components
- Use Tailwind CSS for styling
```

### 8. Privacy & Security

#### 8.1 Data Handling

- Option for local-only mode (no cloud)
- Encrypted transmission for cloud features
- Clear data retention policies
- No training on user code without consent

#### 8.2 API Key Management

- Secure storage of API keys
- Support for multiple providers
- Environment variable support

---

## VSCode Architecture Reference

### Directory Structure

```
src/
├── vs/
│   ├── base/                    # Core utilities and UI primitives
│   ├── code/                    # Application entry points
│   │   ├── electron-main/       # Main process
│   │   └── electron-browser/    # Renderer process
│   ├── editor/                  # Monaco editor core
│   │   ├── browser/             # DOM-specific editor
│   │   ├── common/              # Language-agnostic logic
│   │   ├── contrib/             # Editor contributions
│   │   │   ├── suggest/         # Code completion
│   │   │   └── inlineCompletions/  # Ghost text suggestions
│   │   └── standalone/          # Monaco standalone
│   ├── platform/                # Platform services
│   │   ├── configuration/       # Settings system
│   │   ├── storage/             # Persistent storage
│   │   └── mcp/                 # Model Context Protocol
│   ├── workbench/              # Main IDE workbench
│   │   ├── api/                # Extension API implementation
│   │   │   └── common/
│   │   │       ├── extHostChatAgents2.ts      # Chat agents
│   │   │       ├── extHostLanguageModels.ts   # LLM integration
│   │   │       └── extHostLanguageFeatures.ts # Completions
│   │   ├── browser/            # Workbench UI
│   │   │   └── parts/          # UI components
│   │   │       ├── editor/     # Editor area
│   │   │       ├── sidebar/    # Sidebars
│   │   │       ├── panel/      # Bottom panel
│   │   │       └── auxiliarybar/  # Right sidebar
│   │   ├── contrib/            # Workbench contributions
│   │   │   ├── chat/           # Chat system (KEY)
│   │   │   │   ├── browser/    # Chat UI
│   │   │   │   └── common/     # Chat logic
│   │   │   ├── inlineChat/     # Inline chat (⌘K)
│   │   │   └── mcp/            # MCP integration
│   │   └── services/           # Workbench services
│   └── server/                 # Remote/web server
├── vscode-dts/                 # Extension API definitions
│   └── vscode.d.ts             # Main API types
└── typings/                    # External type definitions

build/                          # Build system
├── gulpfile.ts                 # Main build orchestration
├── gulpfile.vscode.ts          # VSCode-specific build
└── lib/                        # Build utilities

extensions/                     # Built-in extensions
```

### Key Integration Points

#### For Composer/Chat Panel

```
src/vs/workbench/contrib/chat/
├── browser/
│   ├── chat.ts                           # Main chat widget
│   ├── chatWidget.ts                     # Chat UI component
│   ├── chatInputPart.ts                  # Input area
│   └── chatParticipant.contribution.ts   # Agent registration
└── common/
    ├── chatService/
    │   └── chatService.ts                # Core chat service
    ├── chatModel.ts                      # Chat data model
    ├── chatModes.ts                      # Mode system (Ask, Edit, etc.)
    ├── languageModels.ts                 # LLM provider registry
    └── participants/
        └── chatAgents.ts                 # Agent definitions
```

#### For Tab Completion

```
src/vs/editor/contrib/
├── suggest/
│   └── browser/
│       ├── suggestController.ts    # Completion triggering
│       ├── suggestModel.ts         # Suggestion fetching
│       └── suggestWidget.ts        # Completion UI
└── inlineCompletions/
    └── browser/
        ├── inlineCompletions.contribution.ts
        ├── inlineCompletionsController.ts
        └── ghostTextWidget.ts      # Ghost text rendering
```

#### For Inline Edit (⌘K)

```
src/vs/workbench/contrib/inlineChat/
└── browser/
    ├── inlineChatController.ts     # Main controller
    ├── inlineChatWidget.ts         # UI widget
    └── inlineChatActions.ts        # Commands/keybindings
```

#### For Context/MCP

```
src/vs/workbench/contrib/mcp/
├── browser/
│   ├── mcp.contribution.ts         # Registration
│   ├── mcpWorkbenchService.ts      # Main MCP service
│   └── mcpCommands.ts              # Commands
└── common/
    ├── mcpService.ts               # Core implementation
    ├── mcpRegistry.ts              # Server registry
    └── mcpTypes.ts                 # Type definitions
```

### Extension API for AI Features

```typescript
// Key APIs in vscode.d.ts

// Chat/Agent API
vscode.chat.createChatParticipant(id, handler)
vscode.chat.registerChatVariableResolver()

// Language Model API
vscode.lm.selectChatModels(selector)
vscode.lm.sendChatRequest(model, messages, options)

// Completion API
vscode.languages.registerCompletionItemProvider()
vscode.languages.registerInlineCompletionItemProvider()

// Commands
vscode.commands.registerCommand()
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-3)

#### 1.1 LLM Backend Service

Create a unified language model service:

```typescript
// src/vs/workbench/services/aiModel/common/aiModelService.ts

interface IAIModelService {
  // Provider management
  registerProvider(provider: IAIModelProvider): IDisposable;
  getAvailableModels(): IAIModel[];

  // Chat completions
  chat(request: IChatRequest): AsyncIterable<IChatResponse>;

  // Embeddings
  embed(text: string): Promise<number[]>;

  // Configuration
  setApiKey(provider: string, key: string): Promise<void>;
}
```

**Tasks:**
- [ ] Create `IAIModelService` interface
- [ ] Implement OpenAI provider
- [ ] Implement Anthropic provider
- [ ] Implement local model support (Ollama)
- [ ] Add API key management in settings
- [ ] Create model selection UI

#### 1.2 Codebase Indexing Service

```typescript
// src/vs/workbench/services/codebaseIndex/common/codebaseIndexService.ts

interface ICodebaseIndexService {
  // Indexing
  indexWorkspace(): Promise<void>;
  indexFile(uri: URI): Promise<void>;

  // Search
  semanticSearch(query: string, limit?: number): Promise<ISearchResult[]>;

  // Status
  getIndexStatus(): IIndexStatus;
}
```

**Tasks:**
- [ ] Create embedding generation pipeline
- [ ] Implement local vector store (SQLite + vector extension)
- [ ] Add file watcher for incremental updates
- [ ] Create indexing progress UI
- [ ] Implement semantic search

#### 1.3 Branding & Configuration

**Tasks:**
- [ ] Update product.json with new name/branding
- [ ] Create new application icons
- [ ] Update about dialog
- [ ] Configure telemetry settings
- [ ] Set up build pipeline

### Phase 2: Composer Panel (Weeks 4-7)

#### 2.1 Multi-Mode Chat Interface

**Tasks:**
- [ ] Extend existing chat contribution
- [ ] Implement mode switching (Agent, Plan, Debug, Ask)
- [ ] Create mode-specific behavior handlers
- [ ] Add mode indicator in UI

#### 2.2 Agent Management

**Tasks:**
- [ ] Create agent sidebar component
- [ ] Implement agent creation/deletion
- [ ] Add agent search functionality
- [ ] Persist agent conversations
- [ ] Implement agent naming/renaming

#### 2.3 Context System (@ Mentions)

**Tasks:**
- [ ] Implement @ mention parser
- [ ] Create file/folder context provider
- [ ] Create symbol context provider
- [ ] Implement @codebase semantic search
- [ ] Add @web search integration
- [ ] Create @terminal context provider
- [ ] Build context chip UI

#### 2.4 Input Enhancements

**Tasks:**
- [ ] Add voice input (Web Speech API)
- [ ] Implement image paste/upload
- [ ] Create drag-and-drop handlers
- [ ] Add / command system

### Phase 3: Tab Completion (Weeks 8-10)

#### 3.1 Enhanced Inline Completions

**Tasks:**
- [ ] Extend `InlineCompletionsController`
- [ ] Implement multi-line completion support
- [ ] Add completion caching
- [ ] Create debounced completion requests
- [ ] Implement word-by-word acceptance

#### 3.2 Auto-imports

**Tasks:**
- [ ] Detect required imports from completions
- [ ] Integrate with language services
- [ ] Implement import insertion logic

#### 3.3 Learning & Adaptation

**Tasks:**
- [ ] Track accept/reject patterns
- [ ] Implement local preference storage
- [ ] Add completion ranking adjustments

### Phase 4: Inline Edit (Weeks 11-12)

#### 4.1 Enhanced ⌘K Experience

**Tasks:**
- [ ] Extend `InlineChatController`
- [ ] Improve diff preview rendering
- [ ] Add iterative refinement support
- [ ] Implement partial acceptance

#### 4.2 Terminal Integration

**Tasks:**
- [ ] Add ⌘K handler for terminal
- [ ] Implement command generation
- [ ] Add command explanation feature

### Phase 5: Agent Capabilities (Weeks 13-16)

#### 5.1 Tool System

**Tasks:**
- [ ] Define tool interface
- [ ] Implement file operation tools
- [ ] Implement terminal tool
- [ ] Implement search tools
- [ ] Implement git tools
- [ ] Add tool approval UI

#### 5.2 Multi-file Orchestration

**Tasks:**
- [ ] Create change set management
- [ ] Implement atomic apply/reject
- [ ] Add checkpoint/rollback system
- [ ] Create multi-file diff view

#### 5.3 Background Agents

**Tasks:**
- [ ] Implement background execution
- [ ] Add notification system
- [ ] Create agent queue management

### Phase 6: Polish & Configuration (Weeks 17-18)

#### 6.1 Rules & Skills System

**Tasks:**
- [ ] Create rules file parser
- [ ] Implement skills system
- [ ] Add project context support
- [ ] Create configuration UI

#### 6.2 Final Polish

**Tasks:**
- [ ] Performance optimization
- [ ] Error handling improvements
- [ ] Documentation
- [ ] Testing suite

---

## Technical Specifications

### API Integration

#### OpenAI Provider

```typescript
interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;  // For Azure or proxies
  organization?: string;
  models: {
    chat: string;      // e.g., "gpt-4-turbo"
    completion: string; // e.g., "gpt-3.5-turbo-instruct"
    embedding: string;  // e.g., "text-embedding-3-small"
  };
}
```

#### Anthropic Provider

```typescript
interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  models: {
    chat: string;  // e.g., "claude-3-opus-20240229"
  };
}
```

#### Local Model Provider (Ollama)

```typescript
interface OllamaConfig {
  baseUrl: string;  // e.g., "http://localhost:11434"
  models: {
    chat: string;      // e.g., "llama2"
    embedding: string; // e.g., "nomic-embed-text"
  };
}
```

### Data Models

#### Chat Message

```typescript
interface IChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: IChatAttachment[];
  timestamp: number;
  model?: string;
  tokens?: {
    input: number;
    output: number;
  };
}
```

#### Chat Attachment (Context)

```typescript
interface IChatAttachment {
  type: 'file' | 'folder' | 'selection' | 'terminal' | 'image' | 'web';
  uri?: URI;
  content?: string;
  preview?: string;
  range?: IRange;
}
```

#### Agent

```typescript
interface IAgent {
  id: string;
  name: string;
  createdAt: number;
  lastActiveAt: number;
  mode: 'agent' | 'plan' | 'debug' | 'ask';
  model: string;
  messages: IChatMessage[];
  context: IChatAttachment[];
}
```

#### Inline Completion

```typescript
interface IAIInlineCompletion {
  text: string;
  range: IRange;
  isMultiLine: boolean;
  imports?: IImportSuggestion[];
  confidence: number;
}
```

### Settings Schema

```json
{
  "aide.providers.openai.apiKey": {
    "type": "string",
    "description": "OpenAI API key"
  },
  "aide.providers.anthropic.apiKey": {
    "type": "string",
    "description": "Anthropic API key"
  },
  "aide.providers.ollama.baseUrl": {
    "type": "string",
    "default": "http://localhost:11434",
    "description": "Ollama server URL"
  },
  "aide.defaultModel": {
    "type": "string",
    "default": "gpt-4-turbo",
    "description": "Default model for AI features"
  },
  "aide.tabCompletion.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable AI tab completion"
  },
  "aide.tabCompletion.debounceMs": {
    "type": "number",
    "default": 150,
    "description": "Debounce delay for completions"
  },
  "aide.indexing.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable codebase indexing"
  },
  "aide.indexing.excludePatterns": {
    "type": "array",
    "default": ["**/node_modules/**", "**/.git/**"],
    "description": "Patterns to exclude from indexing"
  }
}
```

---

## UI/UX Specifications

### Composer Panel Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Mode: Agent ▼]    [Model: Opus 4.5 ▼]    [1x ▼]              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ User message with context                                │   │
│  │ [@file.ts] [@selection]                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Assistant response                                       │   │
│  │ ```typescript                                            │   │
│  │ // Generated code                                        │   │
│  │ ```                                                      │   │
│  │ [Apply] [Copy] [Insert]                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [📎 file.ts] [📝 selection] [×]                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Plan, @ for context, / for commands                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [@] [🌐] [📷] [🎤]                                    [Send]  │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Sidebar

```
┌─────────────────────┐
│ Search Agents...    │
├─────────────────────┤
│ [+ New Agent]       │
├─────────────────────┤
│ Agents              │
│ ┌─────────────────┐ │
│ │ ∞ Feature impl  │ │
│ │   2 hours ago   │ │
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ 🔧 Debug auth   │ │
│ │   Yesterday     │ │
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ 💬 Code review  │ │
│ │   3 days ago    │ │
│ └─────────────────┘ │
└─────────────────────┘
```

### Inline Completion Preview

```
function calculateTotal(items) {
  return items.reduce((sum, item) => {
    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← Ghost text
    ░░ return sum + item.price * item.qty; ░░
    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  }, 0);
}
                                          [Tab to accept]
```

### Inline Edit (⌘K) Widget

```
┌────────────────────────────────────────────┐
│ 🔧 Describe your edit...                   │
│ ┌────────────────────────────────────────┐ │
│ │ Add error handling for null items      │ │
│ └────────────────────────────────────────┘ │
│                              [Cancel] [Go] │
└────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────┐
│ Proposed changes:                          │
│ ┌────────────────────────────────────────┐ │
│ │ - return items.reduce(...)             │ │
│ │ + if (!items?.length) return 0;        │ │
│ │ + return items.reduce(...)             │ │
│ └────────────────────────────────────────┘ │
│                         [Reject] [Accept]  │
└────────────────────────────────────────────┘
```

---

## File Structure for New Code

```
src/vs/workbench/
├── contrib/
│   └── aide/                              # New: AI IDE features
│       ├── browser/
│       │   ├── aide.contribution.ts       # Main registration
│       │   ├── composer/
│       │   │   ├── composerWidget.ts      # Main composer UI
│       │   │   ├── composerInput.ts       # Input area
│       │   │   ├── composerModes.ts       # Mode handling
│       │   │   └── agentSidebar.ts        # Agent management
│       │   ├── tabCompletion/
│       │   │   ├── tabCompletionController.ts
│       │   │   └── tabCompletionProvider.ts
│       │   └── context/
│       │       ├── contextParser.ts       # @ mention parsing
│       │       └── contextProviders.ts    # Context providers
│       └── common/
│           ├── aideService.ts             # Core service
│           ├── agentService.ts            # Agent management
│           └── types.ts                   # Type definitions
└── services/
    ├── aiModel/                           # New: LLM service
    │   ├── common/
    │   │   ├── aiModelService.ts
    │   │   └── aiModelTypes.ts
    │   └── browser/
    │       ├── aiModelServiceImpl.ts
    │       └── providers/
    │           ├── openaiProvider.ts
    │           ├── anthropicProvider.ts
    │           └── ollamaProvider.ts
    └── codebaseIndex/                     # New: Indexing service
        ├── common/
        │   ├── codebaseIndexService.ts
        │   └── vectorStore.ts
        └── browser/
            └── codebaseIndexServiceImpl.ts
```

---

## Success Criteria

### MVP (Minimum Viable Product)

- [ ] Basic chat interface with single mode
- [ ] OpenAI/Anthropic API integration
- [ ] Simple @ file mentions
- [ ] Basic inline completion
- [ ] ⌘K inline edit

### v1.0 Release

- [ ] All four modes (Agent, Plan, Debug, Ask)
- [ ] Full @ mention system
- [ ] Multi-agent management
- [ ] Multi-line tab completion
- [ ] Codebase semantic search
- [ ] Multi-file editing
- [ ] Rules & configuration system

### v2.0 Goals

- [ ] Background agents
- [ ] Voice input
- [ ] Image understanding
- [ ] Plugin system for custom tools
- [ ] Team collaboration features

---

## References

- [VSCode Repository](https://github.com/microsoft/vscode)
- [Cursor Features](https://cursor.com/features)
- [Cursor Documentation](https://cursor.com/docs)
- [Model Context Protocol](https://modelcontextprotocol.io/)

---

*Last updated: 2026-02-01*
