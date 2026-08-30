const CHECK_INTERVAL_MS = 750;
let lastActive = null;

async function reportDebuggerState() {
  if (document.visibilityState !== "visible") return;
  const response = await chrome.runtime.sendMessage({ type: "WEBMCP_CHECK_DEBUGGER", pageUrl: location.href });
  if (response?.active !== lastActive) {
    lastActive = response?.active ?? false;
  }
}

reportDebuggerState();
setInterval(reportDebuggerState, CHECK_INTERVAL_MS);

