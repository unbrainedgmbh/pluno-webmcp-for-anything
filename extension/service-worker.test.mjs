import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const requestedUrls = [];
const requests = [];
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
    getManifest: () => ({ version: "0.1.14" }),
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} },
    onStartup: { addListener() {} },
  },
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) {
          return Object.fromEntries(key.map((name) => [name, storedValues[name]]));
        }
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
    async query() {
      return [];
    },
    onRemoved: { addListener() {} },
  },
};

globalThis.fetch = async (url, options = {}) => {
  requestedUrls.push(url);
  requests.push({ url, options });
  return {
    ok: true,
    status: 200,
    async json() {
      return { tools: [] };
    },
  };
};

const {
  activatePage,
  getStatus,
  installToolsInPage,
  isSupportedPageUrl,
  openSetup,
  persistAndSubmitLocalTool,
} = await import("./service-worker.js");

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

test("adds a callable tool locally and registers it with native WebMCP", async () => {
  const registrations = [];
  const unregisteredNames = [];
  const postedMessages = [];
  const context = vm.createContext({
    document: {
      modelContext: {
        registerTool(tool) {
          registrations.push(tool);
        },
        unregisterTool(name) {
          unregisteredNames.push(name);
        },
      },
    },
    location: { origin: "https://example.com" },
    postMessage(message, targetOrigin) {
      postedMessages.push({ message, targetOrigin });
    },
  });
  vm.runInContext(`(${installToolsInPage.toString()})(${JSON.stringify([definition])})`, context);

  const registry = vm.runInContext("globalThis.__PLUNO_WEBMCP_TOOLS__", context);
  const replacement = {
    ...definition,
    description: "Return a supplied title",
  };
  const tool = await registry.addTool(replacement);

  assert.equal(registry.length, 1);
  assert.equal(registry.getTool("get_title"), tool);
  assert.equal((await tool.execute({ title: "Added" })).title, "Added");
  assert.deepEqual(unregisteredNames, ["get_title", "get_title"]);
  assert.equal(registrations.length, 2);
  assert.equal(
    JSON.stringify(postedMessages),
    JSON.stringify([{
      message: {
        source: "pluno-webmcp-for-anything",
        type: "WEBMCP_LOCAL_TOOL_ADDED",
        tool: replacement,
      },
      targetOrigin: "https://example.com",
    }]),
  );
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

test("reports paired status before a supported page activates", async () => {
  assert.deepEqual(await getStatus(123), {
    paired: true,
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

  const requestCount = requestedUrls.length;

  await activatePage(71, "about:blank");
  assert.equal(requestedUrls.length, requestCount);
  assert.deepEqual(await getStatus(71), {
    paired: true,
    injecting: false,
    loaded: false,
    toolCount: 0,
    lastError: null,
  });
});

test("activates a supported background tab without a debugger", async () => {
  await activatePage(9, "https://tab-9.example/page");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    requestedUrls.at(-1),
    "https://app.pluno.ai/api/webmcp/tools?page_url=https%3A%2F%2Ftab-9.example",
  );
  const injection = scriptInjections.find((candidate) => candidate.args?.[0]);
  assert.equal(injection.world, "MAIN");
  assert.deepEqual(injection.target, { tabId: 9 });
  assert.equal(injection.func, installToolsInPage);
  assert.deepEqual(await getStatus(9), {
    paired: true,
    injecting: false,
    loaded: true,
    toolCount: 0,
    lastError: null,
  });
});

test("persists and submits a locally added tool once per definition", async () => {
  delete storedValues.webmcpLocalTools;
  delete storedValues.webmcpSubmittedToolFingerprints;
  await activatePage(15, "https://example.com/search");
  await new Promise((resolve) => setImmediate(resolve));
  const requestCount = requests.length;

  const first = await persistAndSubmitLocalTool(15, "https://example.com/search", definition);
  const second = await persistAndSubmitLocalTool(15, "https://example.com/search", definition);

  assert.deepEqual(first, { saved: true, submitted: true });
  assert.deepEqual(second, { saved: true, submitted: false });
  assert.deepEqual(storedValues.webmcpLocalTools["https://example.com"], [definition]);
  assert.equal(requests.length, requestCount + 1);
  const proposalRequest = requests.at(-1);
  assert.equal(proposalRequest.url, "https://app.pluno.ai/api/webmcp/tool-proposals");
  assert.equal(proposalRequest.options.method, "POST");
  assert.equal(proposalRequest.options.headers.Authorization, "Bearer token");
  const body = JSON.parse(proposalRequest.options.body);
  assert.equal(body.page_url, "https://example.com");
  assert.equal(body.updates[0].operation, "POST");
  assert.deepEqual(body.updates[0].tool, definition);

  await activatePage(16, "https://example.com/another-page");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scriptInjections.at(-1).args[0], [definition]);
});
