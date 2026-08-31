const CHECK_INTERVAL_MS = 2000;
let lastActive = null;

async function reportDebuggerState() {
  const response = await chrome.runtime.sendMessage({ type: "WEBMCP_CHECK_DEBUGGER", pageUrl: location.href });
  if (response?.active !== lastActive) {
    lastActive = response?.active ?? false;
  }
}

reportDebuggerState();
setInterval(reportDebuggerState, CHECK_INTERVAL_MS);
