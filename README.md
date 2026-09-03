# Pluno - WebMCP for Anything

A collectively-built WebMCP registry for any website.

Pluno injects WebMCP tools for your agent on any website. When something is missing, the agent builds a reusable tool while completing your task. Contributed tools are reviewed by Pluno and then become available to other agents, so each contribution expands what everyone can do.

The goal: WebMCP coverage across the web, built together through everyday use.

## 1. Install the Chrome extension

1. Install [Pluno WebMCP for Anything from the Chrome Web Store](https://chromewebstore.google.com/detail/pluno-webmcp-for-anything/fbdnbpkcboonegpniiabdgpfjjkpnifn).
2. Finish setup at [Pluno](https://app.pluno.ai/webmcp/signup) when the extension opens it.

Both the extension and the Claude/Codex integration must be connected before tools are injected.

The extension injects origin-specific tools automatically on every page.

It registers tools through the standard WebMCP API when available and additionally exposes them in `globalThis.__PLUNO_WEBMCP_TOOLS__` as a workaround when WebMCP is not supported or enabled.

The extension cannot run in built-in agent browsers that do not support Chrome extensions. Use Claude/Codex with external Chrome to get the injected Pluno tools; they make supported browser operations faster, more reliable, and more token-efficient than UI automation.

## 2. Connect Claude/Codex

### Claude Code

Add the repository as a Claude marketplace and install the integration:

```bash
claude plugin marketplace add unbrainedgmbh/pluno-webmcp-for-anything
claude plugin install pluno-webmcp-for-anything@pluno --scope user
```

Start Claude Code, open `/mcp`, and authenticate the included `pluno-webmcp` server when prompted.

### Codex

Add the repository as a Codex marketplace and install the integration:

```bash
codex plugin marketplace add unbrainedgmbh/pluno-webmcp-for-anything
codex plugin add pluno-webmcp-for-anything@pluno
```

Start a new Codex task and authenticate the included `pluno-webmcp` MCP server when prompted.

## Privacy and security

Adding or replacing a tool through `addTool()` persists it locally for that origin and automatically submits its definition to Pluno as a review proposal.

The bearer token stays in extension storage and is never exposed to page JavaScript. To select an origin-specific catalog, the extension sends only the current site origin—never its path, query string, or page content—to Pluno. The extension injects inert tool definitions through Chrome's scripting API; remote tool code is evaluated and cached only on the first direct invocation. Tool proposals must never contain personal data, credentials, cookies, authorization headers, or private raw payloads.

## License

MIT
