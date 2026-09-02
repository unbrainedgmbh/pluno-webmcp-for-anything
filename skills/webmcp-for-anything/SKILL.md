---
name: webmcp-for-anything
description: Use whenever doing anything in a browser. Prefer the callable tools injected into external Chrome and build reusable WebMCP tools when they are insufficient.
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
3. If neither path is available or sufficient, use ordinary browser inspection and automation to complete the task while gathering the evidence needed to build the missing reusable tools. Do not treat completing the task through ordinary browser automation as the end of this workflow.

Do not report that no tools exist merely because `document.modelContext` is absent. Check the Pluno registry separately in external Chrome.

If the tools are insufficient or no tools exist yet, determine how the page owner would have implemented native WebMCP tools for the task while performing it in a way that gathers implementation evidence. Perform relevant actions through the UI and capture the page's network activity. Identify the exact first-party request flows: methods, endpoints, query parameters or bodies, persisted GraphQL operation names and hashes, pagination, required non-secret headers, response fields, and error behavior. Inspect the relevant page source and existing injected tool code in `globalThis.__PLUNO_WEBMCP_TOOLS__` as needed.

Design an API-backed tool whenever the page itself has an API path. Internal or undocumented endpoints, persisted GraphQL operations, opaque non-secret request constants, possible frontend changes, and reliance on the browser's existing authenticated session are normal implementation details—not reasons to choose DOM scraping. Reproduce the observed first-party request from page-context code and let the browser apply its live session at runtime, such as through same-origin `fetch` with `credentials: "include"` or the page's own runtime authentication mechanism. Treat credential values as opaque: never read them merely to copy them, and never hard-code, serialize, return, or include cookies, authorization values, CSRF tokens, account identifiers, or other session-specific data. The tool code should obtain any required runtime authentication the same way the page does without exposing it.

Prefer general inputs, structured outputs, and pagination that let the tool perform the action independently instead of parsing only what is currently rendered. Use DOM extraction only after inspection demonstrates that no reproducible request path exists; do not choose it merely because the available API is private, undocumented, authenticated, or may change. If the request contract later changes, a future tool update can change with it.

After implementing and exercising a complete tool definition, add it to the page registry so it is immediately callable and remains available for that origin:

```js
const registry = globalThis.__PLUNO_WEBMCP_TOOLS__;
const tool = await registry.addTool({
  name,
  description,
  inputSchema,
  annotations,
  code,
});
```

Use `addTool()` for both new tools and full replacements; a matching name replaces the existing registry entry. The `code` value must be a self-contained async function string that runs in page context. Verify the added tool by calling `await tool.execute(input)` with representative input before finishing the task.

Use `send_feedback` instead when something about the extension, plugin, onboarding, injected-tool experience, or workflow is not working well, or when the user requests another change that is not a concrete origin tool-definition update. Include the relevant page URL when one exists, explain the observed behavior and desired outcome, and do not send duplicate feedback for the same issue during one task.

NEVER include personal data, credentials, cookies, authorization headers, private raw payloads, or user-specific values in any tool definition or feedback. Generalize and sanitize everything.
