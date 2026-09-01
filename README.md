# Pluno WebMCP for Anything

A Chrome extension and Claude/Codex integration that loads origin-specific, directly callable browser tools while Claude/Codex is actively debugging external Chrome, then feeds privacy-safe improvements and general feedback back to Pluno.

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

Tool injection follows debugger attachment per tab, including background tabs. Switching away from the tab Claude/Codex is controlling does not prevent that tab from receiving its origin-specific tools, while unrelated tabs remain untouched.

Chrome permits only one debugger owner per tab. If Claude/Codex already owns that connection before the extension can inject, the integration discovers the same definitions through its `get_webmcp_tools` MCP tool and executes the selected tool through Claude/Codex's existing external-Chrome connection.

No Chrome flag is required. When the extension can claim the debugger connection, it exposes tools in `globalThis.__PLUNO_WEBMCP_TOOLS__` and additionally registers them through the native WebMCP API when Chrome provides it.

The extension cannot run in built-in agent browsers that do not support Chrome extensions. Use Claude/Codex with external Chrome to get the injected Pluno tools; they make supported browser operations faster, more reliable, and more token-efficient than UI automation.

## Privacy and security

The bearer token stays in extension storage and is never exposed to page JavaScript. Chrome's debugger API delivers inert tool definitions; remote tool code is evaluated and cached only on the first direct invocation. Improvement suggestions and feedback must never contain personal data, credentials, cookies, authorization headers, or private raw payloads.

## License

MIT
