const API_ORIGIN = "https://app.pluno.ai";
const PAIRING_ALARM = "webmcp-pairing";
const PLUGIN_ERROR =
  "The Pluno WebMCP for Anything integration is not connected in Claude/Codex.";
const SETUP_ERROR = "Extension setup is incomplete.";
const LOCAL_TOOLS_STORAGE_KEY = "webmcpLocalTools";
const SUBMITTED_FINGERPRINTS_STORAGE_KEY = "webmcpSubmittedToolFingerprints";
const tabState = new Map();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await openSetup();
    return;
  }
  await activateOpenTabs();
});

chrome.runtime.onStartup.addListener(activateOpenTabs);

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === PAIRING_ALARM) await exchangePairing();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WEBMCP_ACTIVATE_PAGE" && sender.tab?.id !== undefined) {
    activatePage(sender.tab.id, message.pageUrl).then(() => sendResponse({ activated: true }));
    return true;
  }
  if (message?.type === "WEBMCP_GET_STATUS") {
    getStatus(message.tabId).then(sendResponse);
    return true;
  }
  if (message?.type === "WEBMCP_OPEN_SETUP") {
    openSetup().then(() => sendResponse({ opened: true }));
    return true;
  }
  if (message?.type === "WEBMCP_ADD_LOCAL_TOOL" && sender.tab?.id !== undefined && sender.tab.url) {
    persistAndSubmitLocalTool(sender.tab.id, sender.tab.url, message.tool)
      .then(sendResponse)
      .catch(async (error) => {
        await logPageError(sender.tab.id, `Pluno WebMCP could not save the new tool: ${error.message}`);
        sendResponse({ saved: false });
      });
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => tabState.delete(tabId));

async function activatePage(tabId, pageUrl) {
  if (pageUrl.startsWith(`${API_ORIGIN}/webmcp/signup`)) await exchangePairing();
  const previous = tabState.get(tabId) ?? {
    revision: 0,
    url: null,
    toolNames: [],
    loaded: false,
    injecting: false,
    lastError: null,
    publishedToolNames: [],
  };
  const revision = previous.revision + 1;
  if (!isSupportedPageUrl(pageUrl)) {
    tabState.set(tabId, {
      ...previous,
      revision,
      url: pageUrl,
      toolNames: [],
      loaded: false,
      injecting: false,
      lastError: null,
      publishedToolNames: [],
    });
    return;
  }
  tabState.set(tabId, { ...previous, revision, url: pageUrl, injecting: true, lastError: null });

  activateTab(tabId, pageUrl, previous.url !== pageUrl ? previous.toolNames : [], revision).catch(async () => {
    if (tabState.get(tabId)?.revision === revision) {
      const current = tabState.get(tabId) ?? previous;
      tabState.set(tabId, { ...current, injecting: false, loaded: false, lastError: "Tool injection failed." });
      await logPageError(tabId, "Pluno WebMCP could not inject tools.");
    }
  });
}

function isSupportedPageUrl(pageUrl) {
  if (!URL.canParse(pageUrl)) return false;
  const parsed = new URL(pageUrl);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return ["http:", "https:"].includes(parsed.protocol) && !isLocalHostname(hostname);
}

function isLocalHostname(hostname) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return hostname === "::1" || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(hostname);
}

async function activateTab(tabId, pageUrl, staleToolNames, revision) {
  if (staleToolNames.length) await unregisterTools(tabId, staleToolNames);
  if (tabState.get(tabId)?.revision !== revision) return;
  const { webmcpToken, webmcpLocalTools = {} } = await chrome.storage.local.get([
    "webmcpToken",
    LOCAL_TOOLS_STORAGE_KEY,
  ]);
  if (tabState.get(tabId)?.revision !== revision) return;
  if (!webmcpToken) {
    await logSetupError(tabId);
    updateCurrentTabState(tabId, revision, { injecting: false, loaded: false, lastError: SETUP_ERROR });
    return;
  }
  // Tool catalogs are origin-specific, so paths and query strings never need to leave the browser.
  const pageOrigin = new URL(pageUrl).origin;
  const response = await fetch(`${API_ORIGIN}/api/webmcp/tools?page_url=${encodeURIComponent(pageOrigin)}`, {
    headers: { Authorization: `Bearer ${webmcpToken}` },
  });
  if (tabState.get(tabId)?.revision !== revision) return;
  if (response.status === 403) {
    await logPluginError(tabId);
    updateCurrentTabState(tabId, revision, { injecting: false, loaded: false, lastError: PLUGIN_ERROR });
    return;
  }
  if (!response.ok) {
    await logPageError(tabId, `Pluno WebMCP could not load tools (${response.status}).`);
    updateCurrentTabState(tabId, revision, {
      injecting: false,
      loaded: false,
      lastError: `Could not load tools (${response.status}).`,
    });
    return;
  }
  const { tools: publishedTools } = await response.json();
  if (tabState.get(tabId)?.revision !== revision) return;
  const localTools = webmcpLocalTools[pageOrigin] ?? [];
  const toolsByName = new Map(publishedTools.map((tool) => [tool.name, tool]));
  for (const tool of localTools) toolsByName.set(tool.name, tool);
  const tools = [...toolsByName.values()];
  const injected = await injectThroughScripting(tabId, tools);
  updateCurrentTabState(tabId, revision, {
    injecting: false,
    toolNames: injected ? tools.map((tool) => tool.name) : [],
    loaded: injected,
    lastError: injected ? null : "Tool injection failed.",
    publishedToolNames: publishedTools.map((tool) => tool.name),
  });
}

async function persistAndSubmitLocalTool(tabId, pageUrl, candidate) {
  if (!isSupportedPageUrl(pageUrl)) throw new Error("Tools can only be added on public HTTP(S) pages.");
  const tool = normalizeToolDefinition(candidate);
  const pageOrigin = new URL(pageUrl).origin;
  const stored = await chrome.storage.local.get([
    "webmcpToken",
    LOCAL_TOOLS_STORAGE_KEY,
    SUBMITTED_FINGERPRINTS_STORAGE_KEY,
  ]);
  const localTools = stored[LOCAL_TOOLS_STORAGE_KEY] ?? {};
  const originTools = localTools[pageOrigin] ?? [];
  const existingIndex = originTools.findIndex((existing) => existing.name === tool.name);
  if (existingIndex === -1) originTools.push(tool);
  else originTools[existingIndex] = tool;
  localTools[pageOrigin] = originTools;
  await chrome.storage.local.set({ [LOCAL_TOOLS_STORAGE_KEY]: localTools });

  const fingerprint = JSON.stringify(tool);
  const fingerprintKey = `${pageOrigin}\n${tool.name}`;
  const submittedFingerprints = stored[SUBMITTED_FINGERPRINTS_STORAGE_KEY] ?? {};
  if (submittedFingerprints[fingerprintKey] === fingerprint) return { saved: true, submitted: false };
  if (!stored.webmcpToken) return { saved: true, submitted: false };

  const publishedToolNames = tabState.get(tabId)?.publishedToolNames ?? [];
  const response = await fetch(`${API_ORIGIN}/api/webmcp/tool-proposals`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stored.webmcpToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_url: pageOrigin,
      justification:
        "The existing WebMCP catalog was insufficient for the browser task. This origin-scoped tool was implemented and exercised in the page so the missing action can be reused.",
      updates: [{
        operation: publishedToolNames.includes(tool.name) ? "PUT" : "POST",
        tool,
      }],
    }),
  });
  if (!response.ok) throw new Error(`proposal submission failed (${response.status})`);
  submittedFingerprints[fingerprintKey] = fingerprint;
  await chrome.storage.local.set({ [SUBMITTED_FINGERPRINTS_STORAGE_KEY]: submittedFingerprints });
  return { saved: true, submitted: true };
}

function normalizeToolDefinition(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("A WebMCP tool definition must be an object.");
  }
  if (typeof candidate.name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(candidate.name)) {
    throw new TypeError("A WebMCP tool needs a valid name.");
  }
  if (typeof candidate.description !== "string" || !candidate.description.length) {
    throw new TypeError("A WebMCP tool needs a description.");
  }
  if (!candidate.inputSchema || candidate.inputSchema.type !== "object") {
    throw new TypeError("A WebMCP tool needs an object inputSchema.");
  }
  if (typeof candidate.code !== "string" || !candidate.code.length) {
    throw new TypeError("A WebMCP tool needs implementation code.");
  }
  return JSON.parse(JSON.stringify({
    name: candidate.name,
    description: candidate.description,
    inputSchema: candidate.inputSchema,
    ...(candidate.annotations ? { annotations: candidate.annotations } : {}),
    code: candidate.code,
  }));
}

function updateCurrentTabState(tabId, revision, updates) {
  const current = tabState.get(tabId);
  if (current?.revision !== revision) return;
  tabState.set(tabId, { ...current, ...updates });
}

async function activateOpenTabs() {
  const { webmcpToken } = await chrome.storage.local.get("webmcpToken");
  if (!webmcpToken) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id !== undefined && tab.url) await activatePage(tab.id, tab.url);
    }),
  );
}

async function getStatus(tabId) {
  const { webmcpToken } = await chrome.storage.local.get("webmcpToken");
  const state = typeof tabId === "number" ? tabState.get(tabId) : undefined;
  return {
    paired: Boolean(webmcpToken),
    injecting: state?.injecting ?? false,
    loaded: state?.loaded ?? false,
    toolCount: state?.toolNames?.length ?? 0,
    lastError: state?.lastError ?? null,
  };
}

async function injectThroughScripting(tabId, tools) {
  return await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: installToolsInPage,
    args: [tools],
  }).then(() => true).catch(async () => {
    await logPageError(tabId, "Pluno WebMCP could not inject tools.");
    return false;
  });
}

function installToolsInPage(definitions) {
  // External Chrome remains useful before native WebMCP is enabled because the agent can call this registry through code.
  const createCallableTool = (definition) => {
    let implementation;
    return Object.freeze({
      ...definition,
      execute: async (input) => {
        if (!implementation) {
          try {
            implementation = (0, eval)("(" + definition.code + ")");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error?.name === "EvalError" || /Content Security Policy|unsafe-eval|TrustedScript/i.test(message)) {
              const blockedError = new Error(
                "The page blocked WebMCP code evaluation. Repeat this exact registry call through the existing browser debugger connection.",
              );
              blockedError.name = "PlunoWebMCPPageExecutionBlockedError";
              blockedError.code = "PLUNO_WEBMCP_PAGE_EXECUTION_BLOCKED";
              blockedError.toolName = definition.name;
              throw blockedError;
            }
            throw error;
          }
        }
        if (typeof implementation !== "function") {
          throw new TypeError("Pluno WebMCP tool " + definition.name + " did not evaluate to a function.");
        }
        return implementation(input);
      },
    });
  };
  const registerNativeTool = (definition) => {
    if (!document.modelContext?.registerTool) return;
    document.modelContext.unregisterTool?.(definition.name);
    const registration = {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: definition.execute,
    };
    if (definition.annotations) registration.annotations = definition.annotations;
    document.modelContext.registerTool(registration);
  };
  const normalizeDefinition = (candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError("A WebMCP tool definition must be an object.");
    }
    if (typeof candidate.name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(candidate.name)) {
      throw new TypeError("A WebMCP tool needs a valid name.");
    }
    if (typeof candidate.description !== "string" || !candidate.description.length) {
      throw new TypeError("A WebMCP tool needs a description.");
    }
    if (!candidate.inputSchema || candidate.inputSchema.type !== "object") {
      throw new TypeError("A WebMCP tool needs an object inputSchema.");
    }
    if (typeof candidate.code !== "string" || !candidate.code.length) {
      throw new TypeError("A WebMCP tool needs implementation code.");
    }
    return JSON.parse(JSON.stringify({
      name: candidate.name,
      description: candidate.description,
      inputSchema: candidate.inputSchema,
      ...(candidate.annotations ? { annotations: candidate.annotations } : {}),
      code: candidate.code,
    }));
  };
  const callableTools = definitions.map((definition) => createCallableTool(normalizeDefinition(definition)));
  Object.defineProperty(callableTools, "getTool", {
    value: (name) => {
      const tool = callableTools.find((definition) => definition.name === name);
      if (!tool) throw new Error("Unknown Pluno WebMCP tool: " + name);
      return tool;
    },
    configurable: false,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(callableTools, "getTools", {
    value: async (_options = {}) => callableTools
      .map((definition) => {
        const registeredTool = {
          name: definition.name,
          title: definition.title ?? "",
          description: definition.description,
          inputSchema: definition.inputSchema,
          origin: location.origin,
          window: globalThis,
        };
        if (definition.annotations) registeredTool.annotations = definition.annotations;
        return registeredTool;
      })
      .sort((first, second) => first.name.localeCompare(second.name)),
    configurable: false,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(callableTools, "addTool", {
    value: async (candidate) => {
      const definition = normalizeDefinition(candidate);
      const tool = createCallableTool(definition);
      const existingIndex = callableTools.findIndex((existing) => existing.name === tool.name);
      if (existingIndex === -1) callableTools.push(tool);
      else callableTools.splice(existingIndex, 1, tool);
      registerNativeTool(tool);
      globalThis.postMessage({
        source: "pluno-webmcp-for-anything",
        type: "WEBMCP_LOCAL_TOOL_ADDED",
        tool: definition,
      }, location.origin);
      return tool;
    },
    configurable: false,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(globalThis, "__PLUNO_WEBMCP_TOOLS__", {
    value: callableTools,
    configurable: true,
    enumerable: false,
  });
  for (const definition of callableTools) registerNativeTool(definition);
}

async function unregisterTools(tabId, toolNames) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (names) => {
      for (const name of names) document.modelContext?.unregisterTool?.(name);
      delete globalThis.__PLUNO_WEBMCP_TOOLS__;
    },
    args: [toolNames],
  }).catch(() => undefined);
}

async function logPluginError(tabId) {
  await logPageError(
    tabId,
    `Pluno WebMCP tools were not injected because ${PLUGIN_ERROR}`,
  );
}

async function logSetupError(tabId) {
  await logPageError(
    tabId,
    `Pluno WebMCP tools were not injected because ${SETUP_ERROR} Install and connect the Pluno WebMCP for Anything integration in Claude/Codex.`,
  );
}

async function logPageError(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (text) => console.error(text),
    args: [message],
  }).catch(() => undefined);
}

async function createPairing(pairingSecret) {
  await fetch(`${API_ORIGIN}/api/webmcp/extension/pairings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairing_secret: pairingSecret, extension_version: chrome.runtime.getManifest().version }),
  });
}

async function exchangePairing() {
  const { webmcpPairingSecret } = await chrome.storage.local.get("webmcpPairingSecret");
  if (!webmcpPairingSecret) {
    await chrome.alarms.clear(PAIRING_ALARM);
    return;
  }
  const response = await fetch(`${API_ORIGIN}/api/webmcp/extension/pairings/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairing_secret: webmcpPairingSecret,
      extension_version: chrome.runtime.getManifest().version,
    }),
  });
  if (!response.ok) return;
  const result = await response.json();
  if (result.status === "ready" && result.token) {
    await chrome.storage.local.set({ webmcpToken: result.token });
    await chrome.storage.local.remove("webmcpPairingSecret");
    await chrome.alarms.clear(PAIRING_ALARM);
    await activateOpenTabs();
  }
  if (result.status === "expired") {
    await chrome.storage.local.remove("webmcpPairingSecret");
    await chrome.alarms.clear(PAIRING_ALARM);
  }
}

async function openSetup() {
  // A previous setup page may have consumed or expired its one-time pairing. Every explicit setup attempt needs a
  // fresh secret so reinstalling or reconnecting cannot reopen an unusable pairing URL.
  const pairingSecret = randomSecret();
  await chrome.storage.local.set({ webmcpPairingSecret: pairingSecret });
  await createPairing(pairingSecret);
  await chrome.alarms.create(PAIRING_ALARM, { periodInMinutes: 1 });
  await chrome.tabs.create({ url: `${API_ORIGIN}/webmcp/signup?pairing_secret=${encodeURIComponent(pairingSecret)}` });
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export {
  activateOpenTabs,
  activatePage,
  getStatus,
  installToolsInPage,
  isSupportedPageUrl,
  normalizeToolDefinition,
  openSetup,
  persistAndSubmitLocalTool,
};
