# Pluno WebMCP for Anything

An open-source Chrome extension and Codex plugin that loads origin-specific WebMCP tools only while Codex is actively debugging the browser, then feeds privacy-safe improvement suggestions back to Pluno for review.

## Install the Codex plugin

Import this GitHub repository as a non-marketplace plugin in Codex. The plugin lives at the repository root, which is the standard Git import layout. Connect the included `pluno-webmcp` MCP server when Codex prompts for OAuth.

## Install the Chrome extension

Until a Chrome Web Store package is available:

1. Clone or download this repository.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the `extension` directory.
4. Finish setup at `https://app.pluno.ai/webmcp/signup` when the extension opens it.

Both the extension and Codex plugin must be connected before tools are injected.

## Privacy and security

The bearer token stays in extension storage and is never exposed to page JavaScript. Remote tool code is evaluated only with Chrome's debugger API while debugger activity is present. Improvement suggestions must never contain personal data, credentials, cookies, authorization headers, or private raw payloads.

## License

MIT

