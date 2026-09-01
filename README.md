# Pluno WebMCP for Anything

A Chrome extension and Claude/Codex integration that automatically loads origin-specific, directly callable browser tools in external Chrome, then feeds privacy-safe improvements and general feedback back to Pluno.

## Connect Claude Code

Add the repository as a Claude marketplace and install the integration:

```bash
claude plugin marketplace add unbrainedgmbh/pluno-webmcp-for-anything
claude plugin install pluno-webmcp-for-anything@pluno --scope user
```

Start Claude Code, open `/mcp`, and authenticate the included `pluno-webmcp` server when prompted.

## Connect Codex

Add the repository as a Codex marketplace and install the integration:

```bash
codex plugin marketplace add unbrainedgmbh/pluno-webmcp-for-anything
codex plugin add pluno-webmcp-for-anything@pluno
```

Start a new Codex task and authenticate the included `pluno-webmcp` MCP server when prompted.

## Install the Chrome extension

Until a Chrome Web Store package is available:

1. Clone or download this repository.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the `extension` directory.
4. Finish setup at `https://app.pluno.ai/webmcp/signup` when the extension opens it.

Both the extension and the Claude/Codex integration must be connected before tools are injected.

The extension injects origin-specific tools automatically on every supported page, including background tabs. Injection does not depend on Claude/Codex controlling the tab or attaching a debugger.

It always exposes tools in `globalThis.__PLUNO_WEBMCP_TOOLS__`; the array provides `await globalThis.__PLUNO_WEBMCP_TOOLS__.getTools()` with the native discovery shape and `globalThis.__PLUNO_WEBMCP_TOOLS__.getTool(name)` for exact-name selection. When Chrome also provides the native WebMCP API, the extension registers the same tools there automatically. If strict page CSP blocks normal execution, Claude/Codex repeats the same registry call through its own browser debugger connection rather than rewriting the implementation.

The extension cannot run in built-in agent browsers that do not support Chrome extensions. Use Claude/Codex with external Chrome to get the injected Pluno tools; they make supported browser operations faster, more reliable, and more token-efficient than UI automation.

## Privacy and security

The bearer token stays in extension storage and is never exposed to page JavaScript. To select an origin-specific catalog, the extension sends only the current site origin—never its path, query string, or page content—to Pluno. The extension injects inert tool definitions through Chrome's scripting API; remote tool code is evaluated and cached only on the first direct invocation. Improvement suggestions and feedback must never contain personal data, credentials, cookies, authorization headers, or private raw payloads.

## License

MIT
