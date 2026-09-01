const FAST_CHECK_INTERVAL_MS = 250;
const FAST_CHECK_DURATION_MS = 5000;
const STEADY_CHECK_INTERVAL_MS = 2000;
const startedAt = Date.now();
let lastActive = null;

async function reportDebuggerState() {
  const response = await chrome.runtime.sendMessage({ type: "WEBMCP_CHECK_DEBUGGER", pageUrl: location.href });
  if (response?.active !== lastActive) {
    lastActive = response?.active ?? false;
  }
  const elapsed = Date.now() - startedAt;
  setTimeout(
    reportDebuggerState,
    response?.active || elapsed >= FAST_CHECK_DURATION_MS ? STEADY_CHECK_INTERVAL_MS : FAST_CHECK_INTERVAL_MS,
  );
}

reportDebuggerState();
