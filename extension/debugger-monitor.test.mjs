import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./debugger-monitor.js", import.meta.url), "utf8");

test("reports debugger state from a background tab", async () => {
  const messages = [];
  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          return { active: true };
        },
      },
    },
    document: { visibilityState: "hidden" },
    location: { href: "https://example.com/background" },
    setInterval() {},
  });

  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    JSON.stringify(messages),
    JSON.stringify([
      {
        type: "WEBMCP_CHECK_DEBUGGER",
        pageUrl: "https://example.com/background",
      },
    ]),
  );
});
