const connectionDot = document.querySelector("#connection-dot");
const connectionTitle = document.querySelector("#connection-title");
const connectionDetail = document.querySelector("#connection-detail");
const tabDot = document.querySelector("#tab-dot");
const tabDetail = document.querySelector("#tab-detail");
const setupButton = document.querySelector("#setup-button");

setupButton.addEventListener("click", async () => {
  setupButton.disabled = true;
  await chrome.runtime.sendMessage({ type: "WEBMCP_OPEN_SETUP" });
  window.close();
});

void loadStatus();

async function loadStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const status = await chrome.runtime.sendMessage({ type: "WEBMCP_GET_STATUS", tabId: tab?.id });

  setDot(connectionDot, status.paired ? "connected" : "error");
  connectionTitle.textContent = status.paired ? "Extension connected" : "Setup required";
  connectionDetail.textContent = status.paired
    ? "Your Pluno account is paired."
    : "Open setup to connect this extension to Pluno.";
  setupButton.textContent = status.paired ? "Reconnect or view setup" : "Open setup";

  if (status.lastError) {
    setDot(tabDot, "error");
    tabDetail.textContent = status.lastError;
  } else if (status.loaded) {
    setDot(tabDot, "connected");
    tabDetail.textContent = `${status.toolCount} ${status.toolCount === 1 ? "tool" : "tools"} ready.`;
  } else if (status.injecting) {
    setDot(tabDot, "pending");
    tabDetail.textContent = "Loading tools…";
  } else {
    setDot(tabDot, "pending");
    tabDetail.textContent = "Tools load automatically on supported web pages.";
  }
}

function setDot(element, state) {
  element.className = `dot ${state}`;
}
