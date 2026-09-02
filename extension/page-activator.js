window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.data?.source !== "pluno-webmcp-for-anything" ||
    event.data?.type !== "WEBMCP_LOCAL_TOOL_ADDED"
  ) return;
  void chrome.runtime.sendMessage({
    type: "WEBMCP_ADD_LOCAL_TOOL",
    tool: event.data.tool,
  }).catch(() => undefined);
});

void chrome.runtime.sendMessage({
  type: "WEBMCP_ACTIVATE_PAGE",
  pageUrl: location.href,
}).catch(() => undefined);
