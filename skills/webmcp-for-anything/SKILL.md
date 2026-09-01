---
name: webmcp-for-anything
description: Use whenever doing anything in a browser. Prefer the callable tools injected into external Chrome and prepare reusable WebMCP tool proposals when they are insufficient.
---

# WebMCP for Anything

The Pluno extension can inject tools only into the user's external Chrome browser. Built-in agent browsers that do not support extensions cannot expose `globalThis.__PLUNO_WEBMCP_TOOLS__`. When the task can use external Chrome, prefer it because the injected tools make browser operations faster, more reliable, and more token-efficient than UI automation.

Use tools in this order:

1. Use native WebMCP tools when the browser exposes them to Claude/Codex.
2. In external Chrome, use the fallback registry in the page context:

   ```js
   const registry = globalThis.__PLUNO_WEBMCP_TOOLS__;
   const tools = (await registry.getTools()).map(({ name, description }) => ({ name, description }));
   const tool = await registry.getTool(name);
   const result = await tool.execute(input);
   ```

   Use the compact `tools` list to choose an exact name. Then inspect `tool.inputSchema` and its other metadata, construct matching input, and call `execute()`. Only `execute()` evaluates and caches the implementation. If execution fails with `error.code === "PLUNO_WEBMCP_PAGE_EXECUTION_BLOCKED"`, repeat the exact same registry call through the external-browser debugger connection already controlled by Claude/Codex, enabling `allowUnsafeEvalBlockedByCSP` when raw CDP options are available. Do not rewrite or regenerate the implementation.
3. If neither path is available or sufficient, complete the task with ordinary browser inspection and automation.

Do not report that no tools exist merely because `document.modelContext` is absent. Check the Pluno registry separately in external Chrome.

If the tools are insufficient, determine how the page owner would have implemented a native WebMCP tool for the missing action while completing the original task. Perform the action once through the UI when useful and capture the page's network activity. Identify the exact first-party request flow: method, endpoint, query or body, persisted GraphQL operation names and hashes, pagination, required non-secret headers, response fields, and error behavior. Inspect the relevant page source and existing injected tool code in `globalThis.__PLUNO_WEBMCP_TOOLS__` as needed.

Design an API-backed proposal whenever the page itself has an API path. Internal or undocumented endpoints, persisted GraphQL operations, opaque non-secret request constants, possible frontend changes, and reliance on the browser's existing authenticated session are normal implementation details—not reasons to choose DOM scraping. Reproduce the observed first-party request from page-context code and let the browser apply its live session at runtime, such as through same-origin `fetch` with `credentials: "include"` or the page's own runtime authentication mechanism. Treat credential values as opaque: never read them merely to copy them, and never hard-code, serialize, return, or submit cookies, authorization values, CSRF tokens, account identifiers, or other session-specific data. The proposed code should obtain any required runtime authentication the same way the page does without exposing it.

Prefer general inputs, structured outputs, and pagination that let the tool perform the action independently instead of parsing only what is currently rendered. Use DOM extraction only after inspection demonstrates that no reproducible request path exists; do not choose it merely because the available API is private, undocumented, authenticated, or may change. If the request contract later changes, a future tool update can change with it.

During prelaunch testing, every valid proposal is automatically approved and published to the shared site catalog. Preparing a proposal does not authorize that external change. If the current user request does not explicitly authorize submitting or publishing shared WebMCP improvements, ask for confirmation immediately before calling `propose_webmcp_tool_update`. The existing Pluno connection is not per-task approval. This confirmation requirement can be removed once proposals remain pending for review instead of being published automatically.

Then use `propose_webmcp_tool_update` with:

- one detailed justification covering the attempted task, why existing WebMCP was insufficient, and why this is the best replacement design;
- complete proposed `POST`, `PUT`, or `DELETE` tool definitions in the exact requested format. Use `DELETE` plus `POST` for a rename.

Use `send_feedback` instead when something about the extension, plugin, onboarding, injected-tool experience, or workflow is not working well, or when the user requests another change that is not a concrete origin tool-definition update. Include the relevant page URL when one exists, explain the observed behavior and desired outcome, and do not send duplicate feedback for the same issue during one task.

NEVER include personal data, credentials, cookies, authorization headers, private raw payloads, or user-specific values in any suggestion or feedback. Generalize and sanitize everything before submission.
