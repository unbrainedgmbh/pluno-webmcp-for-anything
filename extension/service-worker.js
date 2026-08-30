const API_ORIGIN = "https://app.pluno.ai";
const PAIRING_ALARM = "webmcp-pairing";
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const INJECTION_RETRY_MS = 250;
const INJECTION_RETRY_LIMIT = 40;
const tabState = new Map();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const pairingSecret = randomSecret();
  await chrome.storage.local.set({ webmcpPairingSecret: pairingSecret });
  await createPairing(pairingSecret);
  await chrome.alarms.create(PAIRING_ALARM, { periodInMinutes: 1 });
  await chrome.tabs.create({ url: `${API_ORIGIN}/webmcp/signup?pairing_secret=${encodeURIComponent(pairingSecret)}` });
});

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === PAIRING_ALARM) await exchangePairing();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "WEBMCP_CHECK_DEBUGGER" || sender.tab?.id === undefined) return false;
  checkDebuggerActivity(sender.tab.id, message.pageUrl).then(sendResponse);
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => tabState.delete(tabId));

async function checkDebuggerActivity(tabId, pageUrl) {
  if (pageUrl.startsWith(`${API_ORIGIN}/webmcp/signup`)) await exchangePairing();
  const targets = await chrome.debugger.getTargets();
  const active = targets.some((target) => target.tabId === tabId && target.attached);
  const previous = tabState.get(tabId) ?? { active: false, url: null, toolNames: [] };
  tabState.set(tabId, { ...previous, active, url: pageUrl });

  if (active && (!previous.active || previous.url !== pageUrl)) {
    activateTab(tabId, pageUrl);
  } else if (!active && previous.active) {
    await unregisterTools(tabId, previous.toolNames);
    tabState.set(tabId, { ...previous, active: false, url: pageUrl, toolNames: [] });
  }
  return { active };
}

async function activateTab(tabId, pageUrl) {
  const { webmcpToken } = await chrome.storage.local.get("webmcpToken");
  if (!webmcpToken) {
    await logSetupError(tabId);
    return;
  }
  const response = await fetch(`${API_ORIGIN}/webmcp/tools?page_url=${encodeURIComponent(pageUrl)}`, {
    headers: { Authorization: `Bearer ${webmcpToken}` },
  });
  if (response.status === 403) {
    await logPluginError(tabId);
    return;
  }
  if (!response.ok) {
    await logPageError(tabId, `Pluno WebMCP could not load tools (${response.status}).`);
    return;
  }
  const { tools } = await response.json();
  await injectThroughDebugger(tabId, tools);
  const current = tabState.get(tabId) ?? { active: true, url: pageUrl };
  tabState.set(tabId, { ...current, toolNames: tools.map((tool) => tool.name) });
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
      return;
    }
    await delay(INJECTION_RETRY_MS);
  }
  await logPageError(tabId, "Pluno WebMCP could not inject tools while the browser debugger was busy.");
}

function buildRegistrationExpression(tools) {
  const serialized = JSON.stringify(tools);
  return `(() => {
    const definitions = ${serialized};
    if (!document.modelContext?.registerTool) {
      console.error("Pluno WebMCP could not inject tools because this page does not expose the WebMCP API.");
      return;
    }
    Object.defineProperty(globalThis, "__PLUNO_WEBMCP_TOOLS__", {
      value: definitions,
      configurable: true,
      enumerable: false
    });
    for (const definition of definitions) {
      document.modelContext.unregisterTool?.(definition.name);
      const execute = (0, eval)("(" + definition.code + ")");
      document.modelContext.registerTool({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
        execute
      });
    }
  })()`;
}

async function unregisterTools(tabId, toolNames) {
  if (!toolNames.length) return;
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
    "Pluno WebMCP tools were not injected because the Pluno WebMCP for Anything plugin is not connected to Codex.",
  );
}

async function logSetupError(tabId) {
  await logPageError(
    tabId,
    "Pluno WebMCP tools were not injected because setup is incomplete. Install and connect the Pluno WebMCP for Anything Codex plugin.",
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
  await fetch(`${API_ORIGIN}/webmcp/extension/pairings`, {
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
  const response = await fetch(`${API_ORIGIN}/webmcp/extension/pairings/exchange`, {
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
  if (result.status === "expired") await chrome.alarms.clear(PAIRING_ALARM);
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
