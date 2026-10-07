import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

globalThis.chrome = {
  runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} } },
  tabs: { onRemoved: { addListener() {} } },
};

const { activatePage, getStatus, installToolsInPage } = await import("./service-worker.js");
const definition = {
  name: "get_title",
  description: "Return a title",
  inputSchema: { type: "object", properties: {} },
  code: "async () => 'original'",
};

function createPage() {
  const registrations = new Map();
  const signals = [];
  const messages = [];
  const modelContext = {
    registerTool(tool, options = {}) {
      if (registrations.has(tool.name)) throw new DOMException("Duplicate tool name", "InvalidStateError");
      registrations.set(tool.name, tool);
      signals.push(options.signal);
      options.signal?.addEventListener("abort", () => registrations.delete(tool.name), { once: true });
    },
  };
  const context = vm.createContext({
    AbortController,
    document: { modelContext },
    location: { origin: "https://example.com" },
    postMessage(message) { messages.push(message); },
  });
  const install = (definitions) => vm.runInContext(
    `(${installToolsInPage.toString()})(${JSON.stringify(definitions)})`, context,
  );
  return { registrations, signals, messages, modelContext, context, install };
}

test("reinjects native tools without duplicate names and replaces their implementation", async () => {
  const page = createPage();
  await page.install([definition]);
  const originalSignal = page.signals[0];
  await page.install([{ ...definition, code: "async () => 'replacement'" }]);

  assert.equal(originalSignal.aborted, true);
  assert.equal(page.registrations.size, 1);
  assert.equal(await page.registrations.get(definition.name).execute({}), "replacement");
  assert.equal(page.signals[1].aborted, false);
});

test("addTool replaces its native registration before persisting the new definition", async () => {
  const page = createPage();
  await page.install([definition]);
  const registry = vm.runInContext("__PLUNO_WEBMCP_TOOLS__", page.context);
  await registry.addTool({ ...definition, code: "async () => 'replacement'" });

  assert.equal(page.signals[0].aborted, true);
  assert.equal(page.registrations.size, 1);
  assert.equal(await page.registrations.get(definition.name).execute({}), "replacement");
  assert.equal(await registry.getTool(definition.name).execute({}), "replacement");
  assert.equal(page.messages.length, 1);
});

test("catalog replacement removes stale Pluno tools and preserves page-owned tools", async () => {
  const page = createPage();
  const externalTool = { ...definition, name: "page_owned" };
  page.modelContext.registerTool(externalTool);
  await page.install([definition, { ...definition, name: "obsolete" }]);
  await page.install([{ ...definition, name: "current" }]);

  assert.deepEqual([...page.registrations.keys()], ["page_owned", "current"]);
  assert.equal(page.registrations.get("page_owned"), externalTool);
  await page.install([]);
  assert.deepEqual([...page.registrations.keys()], ["page_owned"]);
});

test("waits for asynchronous native registration before finishing injection", async () => {
  const page = createPage();
  const registerTool = page.modelContext.registerTool;
  let finish;
  page.modelContext.registerTool = (tool, options) => {
    registerTool(tool, options);
    return new Promise((resolve) => { finish = resolve; });
  };
  let settled = false;
  const installation = Promise.resolve(page.install([definition])).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  await installation;
  assert.equal(settled, true);
});

test("waits for native registration before publishing a local tool change", async () => {
  const page = createPage();
  await page.install([definition]);
  const registry = vm.runInContext("__PLUNO_WEBMCP_TOOLS__", page.context);
  const registerTool = page.modelContext.registerTool;
  let finish;
  page.modelContext.registerTool = (tool, options) => {
    registerTool(tool, options);
    return new Promise((resolve) => { finish = resolve; });
  };
  const addition = registry.addTool({ ...definition, name: "new_tool" });
  await Promise.resolve();
  assert.equal(page.messages.length, 0);
  finish();
  await addition;
  assert.equal(page.messages.length, 1);
});

test("propagates rejected native registration without an unhandled rejection", async () => {
  const page = createPage();
  const failure = new DOMException("Registration rejected", "InvalidStateError");
  const rejected = Promise.reject(failure);
  rejected.catch(() => {});
  page.modelContext.registerTool = () => rejected;
  await assert.rejects(async () => await page.install([definition]), (error) => error === failure);
});

test("does not remove a conflicting tool owned by another script", async () => {
  const page = createPage();
  const externalTool = { ...definition, execute: async () => "page owned" };
  page.modelContext.registerTool(externalTool);
  await assert.rejects(async () => await page.install([definition]), /Duplicate tool name/);
  assert.equal(page.registrations.get(definition.name), externalTool);
});

test("route activation unregisters Pluno tools through their signals", async () => {
  const page = createPage();
  let tools = [definition];
  let removedBeforeNextInjection = false;
  globalThis.chrome.storage = { local: { async get() { return { webmcpToken: "test-token" }; } } };
  globalThis.chrome.scripting = {
    async executeScript({ func, args }) {
      const result = await vm.runInContext(`(${func.toString()})(...${JSON.stringify(args)})`, page.context);
      if (typeof args[0]?.[0] === "string") {
        removedBeforeNextInjection = !page.registrations.has(definition.name);
      }
      return [{ result }];
    },
  };
  globalThis.fetch = async () => ({ ok: true, async json() { return { tools }; } });

  await activatePage(100, "https://example.com/first");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await getStatus(100)).loaded, true);
  const oldSignal = page.signals[0];
  tools = [{ ...definition, name: "next_route" }];
  await activatePage(100, "https://example.com/second");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal((await getStatus(100)).loaded, true);
  assert.equal(oldSignal.aborted, true);
  assert.equal(removedBeforeNextInjection, true);
  assert.deepEqual([...page.registrations.keys()], ["next_route"]);
});

test("overlapping injections cannot restore tools from a superseded catalog", async () => {
  const page = createPage();
  const original = page.install([definition, { ...definition, name: "obsolete" }]);
  const replacement = page.install([{ ...definition, name: "current" }]);
  await Promise.all([original, replacement]);
  assert.deepEqual([...page.registrations.keys()], ["current"]);
});
