import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./page-activator.js", import.meta.url), "utf8");

test("activates every page immediately", async () => {
  const messages = [];
  const listeners = {};
  const window = {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          return { activated: true };
        },
      },
    },
    location: { href: "https://example.com/background" },
    window,
  });

  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    JSON.stringify(messages),
    JSON.stringify([
      {
        type: "WEBMCP_ACTIVATE_PAGE",
        pageUrl: "https://example.com/background",
      },
    ]),
  );

  listeners.message({
    source: window,
    data: {
      source: "pluno-webmcp-for-anything",
      type: "WEBMCP_LOCAL_TOOL_ADDED",
      tool: { name: "get_title" },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    JSON.stringify(messages.at(-1)),
    JSON.stringify({
      type: "WEBMCP_ADD_LOCAL_TOOL",
      tool: { name: "get_title" },
    }),
  );
});
