import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

let debuggerTargets = [];
let debuggerAttachCalls = 0;
const requestedUrls = [];
const createdTabUrls = [];
const scriptInjections = [];
const storedValues = {
  webmcpPairingSecret: "stale-pairing-secret",
  webmcpToken: "token",
};

globalThis.chrome = {
  action: { onClicked: { addListener() {} } },
  alarms: {
    async clear() {},
    async create() {},
    onAlarm: { addListener() {} },
  },
  runtime: {
    getManifest: () => ({ version: "0.1.11" }),
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} },
  },
  storage: {
    local: {
      async get(key) {
        return { [key]: storedValues[key] };
      },
      async set(values) {
        Object.assign(storedValues, values);
      },
      async remove(key) {
        delete storedValues[key];
      },
    },
  },
  debugger: {
    async attach() {
      debuggerAttachCalls += 1;
    },
    async detach() {},
    async getTargets() {
      return debuggerTargets;
    },
    async sendCommand() {},
  },
  scripting: {
    async executeScript(injection) {
      scriptInjections.push(injection);
    },
  },
  tabs: {
    async create({ url }) {
      createdTabUrls.push(url);
    },
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

const { checkDebuggerActivity, getAttachedTabIds, getStatus, installToolsInPage, isSupportedPageUrl, openSetup } =
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
  vm.runInContext(`(${installToolsInPage.toString()})(${JSON.stringify([lazyDefinition])})`, context);

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
  vm.runInContext(`(${installToolsInPage.toString()})(${JSON.stringify([definition])})`, context);

  const tools = vm.runInContext("globalThis.__PLUNO_WEBMCP_TOOLS__", context);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].execute, tools[0].execute);
  assert.equal((await registrations[0].execute({ title: "Native" })).title, "Native");
});

test("mirrors native getTools discovery on the fallback registry", async () => {
  const context = vm.createContext({
    document: {},
    location: { origin: "https://example.com" },
  });
  const secondDefinition = {
    ...definition,
    name: "archive_title",
    annotations: { readOnlyHint: false },
  };
  vm.runInContext(
    `(${installToolsInPage.toString()})(${JSON.stringify([definition, secondDefinition])})`,
    context,
  );

  const registry = vm.runInContext("globalThis.__PLUNO_WEBMCP_TOOLS__", context);
  const tools = await registry.getTools();

  assert.equal(typeof registry.getTools, "function");
  assert.deepEqual(Object.keys(registry), ["0", "1"]);
  assert.deepEqual(Array.from(tools, (tool) => tool.name), ["archive_title", "get_title"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify({
      ...tools[0],
      window: undefined,
    })),
    {
      name: "archive_title",
      title: "",
      description: "Return the current title",
      inputSchema: { type: "object", properties: {} },
      origin: "https://example.com",
      annotations: { readOnlyHint: false },
    },
  );
  assert.equal(tools[0].window, vm.runInContext("globalThis", context));
  assert.equal("execute" in tools[0], false);
});

test("selects a directly callable fallback tool by name", async () => {
  const context = vm.createContext({ document: {} });
  vm.runInContext(`(${installToolsInPage.toString()})(${JSON.stringify([definition])})`, context);

  const registry = vm.runInContext("globalThis.__PLUNO_WEBMCP_TOOLS__", context);

  assert.equal(typeof registry.getTool, "function");
  assert.equal(registry.getTool("get_title"), registry[0]);
  assert.equal((await registry.getTool("get_title").execute({ title: "Named" })).title, "Named");
  assert.throws(() => registry.getTool("missing"), /Unknown Pluno WebMCP tool: missing/);
});

test("reports when page CSP blocks lazy tool evaluation", async () => {
  const context = vm.createContext({
    document: {},
    eval() {
      const error = new Error("Refused to evaluate because 'unsafe-eval' violates Content Security Policy");
      error.name = "EvalError";
      throw error;
    },
  });
  vm.runInContext(`(${installToolsInPage.toString()})(${JSON.stringify([definition])})`, context);

  const tool = vm.runInContext("globalThis.__PLUNO_WEBMCP_TOOLS__[0]", context);
  await assert.rejects(
    tool.execute({ title: "Blocked" }),
    (error) =>
      error.code === "PLUNO_WEBMCP_PAGE_EXECUTION_BLOCKED" &&
      error.toolName === "get_title",
  );
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

test("starts each setup attempt with a fresh pairing secret", async () => {
  const previousPairingSecret = storedValues.webmcpPairingSecret;

  await openSetup();

  assert.notEqual(storedValues.webmcpPairingSecret, previousPairingSecret);
  assert.equal(
    createdTabUrls.at(-1),
    `https://app.pluno.ai/webmcp/signup?pairing_secret=${encodeURIComponent(storedValues.webmcpPairingSecret)}`,
  );
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

test("skips non-web and local pages before requesting tools", async () => {
  for (const pageUrl of [
    "about:blank",
    "chrome://extensions",
    "http://localhost:3000/page",
    "http://localhost.:3000/page",
    "https://app.localhost/page",
    "http://127.0.0.1:8080/page",
    "http://127.0.0.2:8080/page",
    "http://[::1]:8080/page",
    "http://[::ffff:127.0.0.1]:8080/page",
  ]) {
    assert.equal(isSupportedPageUrl(pageUrl), false);
  }
  assert.equal(isSupportedPageUrl("https://example.com/page"), true);

  debuggerTargets = [{ attached: true, tabId: 71 }];
  const requestCount = requestedUrls.length;

  assert.deepEqual(await checkDebuggerActivity(71, "about:blank"), { active: true });
  assert.equal(requestedUrls.length, requestCount);
  assert.deepEqual(await getStatus(71), {
    paired: true,
    active: true,
    injecting: false,
    loaded: false,
    toolCount: 0,
    lastError: null,
  });
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
  const injection = scriptInjections.find((candidate) => candidate.args?.[0]);
  assert.equal(injection.world, "MAIN");
  assert.deepEqual(injection.target, { tabId: 9 });
  assert.equal(injection.func, installToolsInPage);
  assert.equal(debuggerAttachCalls, 0);
  assert.deepEqual(await getStatus(9), {
    paired: true,
    active: true,
    injecting: false,
    loaded: true,
    toolCount: 0,
    lastError: null,
  });
});
