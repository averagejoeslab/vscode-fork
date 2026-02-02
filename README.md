# AIDE - AI Development Environment

An open-source AI-native IDE built on Visual Studio Code. AIDE integrates AI capabilities directly into the core editor experience, providing intelligent coding assistance without requiring external subscriptions.

## Features

### Composer
The central AI chat interface with multiple interaction modes:

- **Agent Mode** - Full autonomous coding assistant with tool access (file read/write, terminal, search)
- **Plan Mode** - Strategic planning for complex tasks before execution
- **Debug Mode** - Focused debugging assistance with error analysis
- **Ask Mode** - Quick Q&A without code modifications

### Multi-Agent Management
- Create and manage multiple AI agents for different tasks
- Each agent maintains its own conversation history and context
- Quick switching between agents via the sidebar

### Context System
Rich context integration using `@` mentions:
- `@file` - Reference specific files
- `@folder` - Include entire directories
- `@codebase` - Semantic search across your project
- `@terminal` - Include terminal output
- `@web` - Web search integration
- `@selection` - Current editor selection

### AI-Powered Tab Completion
Intelligent inline code suggestions powered by your configured AI models.

### Multi-Provider Support
Connect to multiple AI providers:
- **OpenAI** - GPT-4o, GPT-4, o1, and more
- **Anthropic** - Claude Opus, Sonnet, and Haiku models
- **Ollama** - Run local models (Llama, Mistral, CodeLlama, etc.)

## Getting Started

### Prerequisites
- Node.js 18.x or higher
- Git
- Python 3.x (for native module compilation)

### Building from Source

```bash
# Clone the repository
git clone https://github.com/averagejoeslab/vscode-fork.git
cd vscode-fork

# Install dependencies (this will also build native modules)
VSCODE_SKIP_NODE_VERSION_CHECK=1 npm install

# Compile the client
npm run gulp compile-client

# Run the application
./scripts/code.sh  # Linux/macOS
./scripts/code.bat # Windows
```

**Requirements:**
- Node.js v22.12.0 or later
- Python 3.x (for native module compilation)
- On macOS: Xcode Command Line Tools (`xcode-select --install`)
- On Windows: Visual Studio Build Tools

**Note:** The first run will download Electron and built-in extensions, which may take a few minutes.

### Configuration

Configure your AI providers in Settings (`Cmd/Ctrl + ,`):

```json
{
  "aide.providers.openai.apiKey": "your-api-key",
  "aide.providers.anthropic.apiKey": "your-api-key",
  "aide.providers.ollama.baseUrl": "http://localhost:11434",
  "aide.defaultModel": "openai/gpt-4o",
  "aide.tabCompletion.enabled": true
}
```

## Keyboard Shortcuts

| Command | Shortcut |
|---------|----------|
| Open Composer | `Cmd/Ctrl + I` |
| New Agent | `Cmd/Ctrl + N` |

## Architecture

AIDE extends VS Code with the following services:

- **AideService** - Core AI service managing agents, models, and chat
- **AideContextService** - Context resolution, codebase indexing, and semantic search
- **Model Providers** - Pluggable architecture for OpenAI, Anthropic, Ollama, and custom providers

## Project Structure

```
src/vs/workbench/
├── services/aide/
│   ├── common/           # Service interfaces
│   │   ├── aideService.ts
│   │   └── aideContextService.ts
│   └── browser/          # Service implementations
│       ├── aideServiceImpl.ts
│       ├── aideContextServiceImpl.ts
│       └── providers/    # AI model providers
│           ├── openaiProvider.ts
│           ├── anthropicProvider.ts
│           └── ollamaProvider.ts
└── contrib/aide/
    └── browser/
        ├── composer/     # Chat UI components
        ├── tabCompletion/
        └── media/        # Styles
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

### Development

```bash
# Run tests
npm test

# Watch mode for development
npm run watch
```

## Credits

AIDE is built on [Visual Studio Code](https://github.com/microsoft/vscode), an open-source project by Microsoft. We extend our thanks to the VS Code team and community for creating such an excellent foundation.

## License

This project is licensed under the [MIT License](LICENSE.txt).

---

**Note:** This is an independent open-source project and is not affiliated with Microsoft, Cursor, or any AI provider. You must provide your own API keys for the AI services you wish to use.
