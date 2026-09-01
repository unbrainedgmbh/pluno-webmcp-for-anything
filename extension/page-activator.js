void chrome.runtime.sendMessage({
  type: "WEBMCP_ACTIVATE_PAGE",
  pageUrl: location.href,
}).catch(() => undefined);
