import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./debugger-monitor.js", import.meta.url), "utf8");

test("reports debugger state from a background tab", async () => {
  const messages = [];
  const scheduledChecks = [];
  let now = 0;
  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          return { active: false };
        },
      },
    },
    Date: { now: () => now },
    document: { visibilityState: "hidden" },
    location: { href: "https://example.com/background" },
    setTimeout(callback, delay) {
      scheduledChecks.push({ callback, delay });
    },
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
  assert.equal(scheduledChecks[0].delay, 250);

  now = 5000;
  scheduledChecks.shift().callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.length, 2);
  assert.equal(scheduledChecks[0].delay, 2000);
});

test("stops fast polling as soon as the debugger is detected", async () => {
  const scheduledChecks = [];
  const context = vm.createContext({
    chrome: {
      runtime: {
        async sendMessage() {
          return { active: true };
        },
      },
    },
    Date: { now: () => 0 },
    location: { href: "https://example.com/controlled" },
    setTimeout(callback, delay) {
      scheduledChecks.push({ callback, delay });
    },
  });

  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(scheduledChecks[0].delay, 2000);
});
