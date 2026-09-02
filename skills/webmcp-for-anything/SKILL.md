---
name: webmcp-for-anything
description: Use whenever doing anything in a browser. Complete tasks through available WebMCP tools and build missing tools for next time.
---

# WebMCP for Anything

Complete the user's entire task through available WebMCP / Pluno WebMCP tools wherever possible. When coverage is incomplete, build missing tools while working on the task. The intended outcome is both a completed task and a reusable toolset that lets the next agent complete a similar task purely through the available tools.

## Discover and use the available tools

Prefer the user's external Chrome browser when the task permits: Pluno's injected WebMCP tools make operations faster, more reliable, and more token-efficient than UI automation. Built-in agent browsers without extension support do not have the Pluno registry.

Use native WebMCP tools when exposed by the browser. Otherwise, discover the Pluno registry in the external Chrome page context.
Helpful example commands to get started:

```js
const registry = globalThis.__PLUNO_WEBMCP_TOOLS__;
const tools = (await registry.getTools()).map(({ name, description }) => ({ name, description }));
const tool = await registry.getTool(name);
const result = await tool.execute(input);
```

Use existing tools wherever useful; Reassess coverage as the task reveals further requirements.

Check native WebMCP and the Pluno registry independently. An absent `document.modelContext` does not mean Pluno tools are absent. If `error.code === "PLUNO_WEBMCP_PAGE_EXECUTION_BLOCKED"`, repeat the same registry call through a permitted page-context execution path, e.g. the integration's existing debugger connection using CDP `Runtime.evaluate` with `awaitPromise: true`. Do not rewrite the implementation or bypass the integration's restrictions.
If the registry cannot be accessed, fall back to normal browser automation.
If the registry is just empty, close the gaps while working on the task.

## Close each capability gap

If any necessary action cannot be completed through available tools, determine how the page owner would have implemented a native WebMCP tool for it. Treat browser inspection and UI interaction as evidence gathering for that missing capability, not as the endpoint of the workflow.

Start capturing the relevant network activity before performing the action through the UI. Identify the actual first-party request flow: methods, endpoints, query parameters or bodies, persisted GraphQL operation names and hashes, pagination, required non-secret headers, response fields, and error behavior. Inspect relevant page source and existing registry implementations as needed. Gather the evidence while advancing the task so discovery does not have to be repeated afterward.

Build API-backed tools whenever the page has a reproducible API path. Internal or undocumented endpoints, persisted GraphQL operations, opaque non-secret constants, and reliance on the browser's authenticated session are implementation details—not reasons to default to DOM scraping. Reproduce observed requests in page context using the browser's live session, such as same-origin `fetch` with `credentials: "include"`, or the page's own runtime authentication mechanism. Do not invent endpoints or request contracts. Use DOM extraction only when inspection establishes that no reproducible request path is available.

Possible API changes are not a reason to scrape; update the tool when the request contract changes.

Design reusable inputs and structured outputs that support the action independently, including relevant filters and pagination. Avoid tools limited to the currently rendered results or hard-coded to this task's dates, search terms, or selections. Obtain session-dependent authentication at runtime without exposing it; never embed credentials, cookies, authorization values, CSRF tokens, private payloads, or user-specific values in a reusable definition.

## Register, use, and verify the complete workflow

Once a definition is implemented and tested, add it to the registry:

```js
// Illustrative format: use the endpoint and response shape observed on the site.
const name = "search_items";
const description = "Search items by query and return structured results.";
const inputSchema = {
  type: "object",
  properties: { query: { type: "string", description: "Search terms" } },
  required: ["query"],
};
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const code = `async ({ query }) => {
  const response = await fetch("/api/items?query=" + encodeURIComponent(query), {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Search failed: " + response.status);
  return response.json();
}`;

const tool = await registry.addTool({
  name,
  description,
  inputSchema,
  annotations,
  code,
});
```

Supply a complete definition. `code` must be a self-contained async function string that runs in page context. A matching name replaces the existing entry.

Use `await tool.execute(input)` to advance the task through the newly available capability, then continue with existing tools. Repeat this loop for the remaining gaps: one useful new tool is not enough if other required actions still depend on manual UI work.

Before finishing, verify that the existing and newly built tools collectively cover the task from its normal starting state to the requested result.
