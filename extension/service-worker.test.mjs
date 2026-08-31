import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

let debuggerTargets = [];
const requestedUrls = [];

globalThis.chrome = {
  action: { onClicked: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} } },
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} },
  },
  storage: {
    local: {
      async get() {
        return { webmcpToken: "token" };
      },
    },
  },
  debugger: {
    async attach() {},
    async detach() {},
    async getTargets() {
      return debuggerTargets;
    },
    async sendCommand() {},
  },
  scripting: { async executeScript() {} },
  tabs: {
    async get(tabId) {
      return { id: tabId, url: `https://tab-${tabId}.example/page` };
    },
    onRemoved: { addListener() {} },
  },
};

globalThis.fetch = async (url) => {
  requestedUrls.push(url);
  return {
    ok: true,
    status: 200,
    async json() {
      return { tools: [] };
    },
  };
};

const { buildRegistrationExpression, checkDebuggerActivity, getAttachedTabIds, getStatus } =
  await import("./service-worker.js");

const definition = {
  name: "get_title",
  description: "Return the current title",
  inputSchema: { type: "object", properties: {} },
  code: "async (input) => ({ title: input.title })",
};

test("exposes directly callable tools without native WebMCP", async () => {
  const lazyDefinition = {
    ...definition,
    code: "(() => { globalThis.evaluationCount += 1; return async (input) => ({ title: input.title }); })()",
  };
  const context = vm.createContext({ document: {}, evaluationCount: 0 });
  vm.runInContext(buildRegistrationExpression([lazyDefinition]), context);

  const tools = vm.runInContext("globalThis.__PLUNO_WEBMCP_TOOLS__", context);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "get_title");
  assert.equal(typeof tools[0].execute, "function");
  assert.equal(context.evaluationCount, 0);
  assert.equal((await tools[0].execute({ title: "Example" })).title, "Example");
  assert.equal(context.evaluationCount, 1);
  assert.equal((await tools[0].execute({ title: "Again" })).title, "Again");
  assert.equal(context.evaluationCount, 1);
});

test("registers the same callable tool when native WebMCP exists", async () => {
  const registrations = [];
  const context = vm.createContext({
    document: {
      modelContext: {
        registerTool(tool) {
          registrations.push(tool);
        },
        unregisterTool() {},
      },
    },
  });
  vm.runInContext(buildRegistrationExpression([definition]), context);

  const tools = vm.runInContext("globalThis.__PLUNO_WEBMCP_TOOLS__", context);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].execute, tools[0].execute);
  assert.equal((await registrations[0].execute({ title: "Native" })).title, "Native");
});

test("reports paired idle status before an AI agent activates a tab", async () => {
  assert.deepEqual(await getStatus(123), {
    paired: true,
    active: false,
    injecting: false,
    loaded: false,
    toolCount: 0,
    lastError: null,
  });
});

test("finds every debugger-attached tab without including unrelated targets", () => {
  assert.deepEqual(
    getAttachedTabIds([
      { attached: true, tabId: 7 },
      { attached: false, tabId: 8 },
      { attached: true, tabId: 9 },
      { attached: true, tabId: 7 },
      { attached: true, type: "worker" },
    ]),
    [7, 9],
  );
});

test("activates an attached background tab from another tab's heartbeat", async () => {
  debuggerTargets = [{ attached: true, tabId: 9 }];

  assert.deepEqual(
    await checkDebuggerActivity(7, "https://foreground.example/page"),
    { active: false },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    requestedUrls.at(-1),
    "https://app.pluno.ai/api/webmcp/tools?page_url=https%3A%2F%2Ftab-9.example%2Fpage",
  );
  assert.deepEqual(await getStatus(9), {
    paired: true,
    active: true,
    injecting: false,
    loaded: true,
    toolCount: 0,
    lastError: null,
  });
});
