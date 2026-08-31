const API_ORIGIN = "https://app.pluno.ai";
const PAIRING_ALARM = "webmcp-pairing";
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const INJECTION_RETRY_MS = 250;
const INJECTION_RETRY_LIMIT = 40;
const PLUGIN_ERROR =
  "The Pluno WebMCP for Anything integration is not connected in Claude/Codex.";
const SETUP_ERROR = "Extension setup is incomplete.";
const tabState = new Map();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  await openSetup();
});

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === PAIRING_ALARM) await exchangePairing();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WEBMCP_CHECK_DEBUGGER" && sender.tab?.id !== undefined) {
    checkDebuggerActivity(sender.tab.id, message.pageUrl).then(sendResponse);
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
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => tabState.delete(tabId));

async function checkDebuggerActivity(tabId, pageUrl) {
  if (pageUrl.startsWith(`${API_ORIGIN}/webmcp/signup`)) await exchangePairing();
  const targets = await chrome.debugger.getTargets();
  const attachedTabIds = getAttachedTabIds(targets);
  const attachedTabIdSet = new Set(attachedTabIds);
  for (const [knownTabId, state] of tabState) {
    if (!attachedTabIdSet.has(knownTabId)) {
      tabState.set(knownTabId, { ...state, active: false });
    }
  }
  await Promise.all(
    attachedTabIds.map(async (attachedTabId) => {
      const attachedPageUrl =
        attachedTabId === tabId
          ? pageUrl
          : await chrome.tabs.get(attachedTabId).then((tab) => tab.url).catch(() => undefined);
      if (attachedPageUrl) await activateAttachedTab(attachedTabId, attachedPageUrl);
    }),
  );
  return { active: attachedTabIdSet.has(tabId) };
}

async function activateAttachedTab(tabId, pageUrl) {
  const previous = tabState.get(tabId) ?? {
    active: false,
    url: null,
    toolNames: [],
    loaded: false,
    injecting: false,
    lastError: null,
  };
  tabState.set(tabId, { ...previous, active: true, url: pageUrl });

  if (
    !previous.injecting &&
    (previous.url !== pageUrl || !previous.loaded)
  ) {
    activateTab(tabId, pageUrl, previous.url !== pageUrl ? previous.toolNames : []).catch(async () => {
      const current = tabState.get(tabId) ?? previous;
      tabState.set(tabId, { ...current, injecting: false, loaded: false, lastError: "Tool injection failed." });
      await logPageError(tabId, "Pluno WebMCP could not inject tools.");
    });
  }
}

function getAttachedTabIds(targets) {
  return [
    ...new Set(
      targets
        .filter((target) => target.attached && target.tabId !== undefined)
        .map((target) => target.tabId),
    ),
  ];
}

async function activateTab(tabId, pageUrl, staleToolNames) {
  const initial = tabState.get(tabId) ?? { active: true, url: pageUrl, toolNames: [] };
  tabState.set(tabId, { ...initial, injecting: true, lastError: null });
  if (staleToolNames.length) await unregisterTools(tabId, staleToolNames);
  const { webmcpToken } = await chrome.storage.local.get("webmcpToken");
  if (!webmcpToken) {
    await logSetupError(tabId);
    tabState.set(tabId, { ...initial, injecting: false, loaded: false, lastError: SETUP_ERROR });
    return;
  }
  const response = await fetch(`${API_ORIGIN}/api/webmcp/tools?page_url=${encodeURIComponent(pageUrl)}`, {
    headers: { Authorization: `Bearer ${webmcpToken}` },
  });
  if (response.status === 403) {
    await logPluginError(tabId);
    tabState.set(tabId, { ...initial, injecting: false, loaded: false, lastError: PLUGIN_ERROR });
    return;
  }
  if (!response.ok) {
    await logPageError(tabId, `Pluno WebMCP could not load tools (${response.status}).`);
    tabState.set(tabId, {
      ...initial,
      injecting: false,
      loaded: false,
      lastError: `Could not load tools (${response.status}).`,
    });
    return;
  }
  const { tools } = await response.json();
  const injected = await injectThroughDebugger(tabId, tools);
  const current = tabState.get(tabId) ?? { active: true, url: pageUrl };
  tabState.set(tabId, {
    ...current,
    injecting: false,
    toolNames: injected ? tools.map((tool) => tool.name) : [],
    loaded: injected,
    lastError: injected ? null : "Tool injection failed while the browser debugger was busy.",
  });
}

async function getStatus(tabId) {
  const { webmcpToken } = await chrome.storage.local.get("webmcpToken");
  const state = typeof tabId === "number" ? tabState.get(tabId) : undefined;
  return {
    paired: Boolean(webmcpToken),
    active: state?.active ?? false,
    injecting: state?.injecting ?? false,
    loaded: state?.loaded ?? false,
    toolCount: state?.toolNames?.length ?? 0,
    lastError: state?.lastError ?? null,
  };
}

async function injectThroughDebugger(tabId, tools) {
  const target = { tabId };
  for (let attempt = 0; attempt < INJECTION_RETRY_LIMIT; attempt += 1) {
    const attached = await chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION).then(() => true).catch(() => false);
    if (attached) {
      const expression = buildRegistrationExpression(tools);
      await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      await chrome.debugger.detach(target);
      return true;
    }
    await delay(INJECTION_RETRY_MS);
  }
  await logPageError(tabId, "Pluno WebMCP could not inject tools while the browser debugger was busy.");
  return false;
}

function buildRegistrationExpression(tools) {
  const serialized = JSON.stringify(tools);
  return `(() => {
    const definitions = ${serialized};
    // External Chrome remains useful before native WebMCP is enabled because the agent can call this registry through code.
    const callableTools = definitions.map((definition) => {
      let implementation;
      return Object.freeze({
        ...definition,
        execute: async (input) => {
          implementation ??= (0, eval)("(" + definition.code + ")");
          if (typeof implementation !== "function") {
            throw new TypeError("Pluno WebMCP tool " + definition.name + " did not evaluate to a function.");
          }
          return implementation(input);
        }
      });
    });
    Object.defineProperty(globalThis, "__PLUNO_WEBMCP_TOOLS__", {
      value: Object.freeze(callableTools),
      configurable: true,
      enumerable: false
    });
    if (!document.modelContext?.registerTool) return;
    for (const definition of callableTools) {
      document.modelContext.unregisterTool?.(definition.name);
      const registration = {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: definition.execute
      };
      if (definition.annotations) registration.annotations = definition.annotations;
      document.modelContext.registerTool(registration);
    }
  })()`;
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export { buildRegistrationExpression, checkDebuggerActivity, getAttachedTabIds, getStatus, openSetup };
