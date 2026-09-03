# Chrome Web Store submission

## Listing

Live listing: [Pluno WebMCP for Anything](https://chromewebstore.google.com/detail/pluno-webmcp-for-anything/fbdnbpkcboonegpniiabdgpfjjkpnifn)

Name: Pluno WebMCP for Anything

Category: Developer Tools

Summary: Give Claude & Codex MCP tools for any website!

Detailed description:

Pluno WebMCP for Anything connects Claude/Codex to purpose-built browser tools in external Chrome. The extension automatically loads reviewed tools for each supported website and exposes them through native WebMCP when available and through the directly callable Pluno registry everywhere else. Background tabs are supported, so tools are ready when an AI agent needs them.

The extension sends only the current site origin—not its path, query string, or page content—to Pluno to select the matching tool catalog. The popup shows whether setup is complete and how many tools are ready for the current tab.

Setup requires one Pluno sign-in, the Chrome extension, and the companion Claude/Codex integration.

## Single purpose

Expose reviewed, site-specific browser tools to Claude/Codex in the user&apos;s external Chrome tabs.

## Permission justifications

- `scripting`: Injects the selected tool catalog into supported tabs, removes stale tools after navigation, and displays setup or connection errors without exposing the Pluno bearer token.
- `storage`: Stores the extension&apos;s Pluno pairing secret and bearer token locally.
- `tabs`: Opens onboarding, identifies the active tab for the status popup, and clears transient state when a tab closes.
- `alarms`: Checks the short-lived pairing flow in the background until onboarding completes or expires.
- `<all_urls>` host access: The product&apos;s single purpose is to make origin-specific tools available on websites the user may ask Claude/Codex to operate. The extension sends only the site origin to select tools and never sends the page path, query string, or content during discovery.

## Remote code declaration

Answer: Yes.

Justification: The extension downloads reviewed, origin-specific tool definitions from Pluno and exposes them only inside the matching website tab. The extension itself contains the complete activation, authentication, registry, status, and safety logic; remote definitions are never executed in the extension service worker or popup. Tool execution is initiated by Claude/Codex in the website tab. On pages whose Content Security Policy blocks ordinary evaluation, Claude/Codex may repeat the same injected registry call through the browser debugger connection it already owns.

## Data disclosures

Disclose these categories:

- Web history: the current site origin is sent to `https://app.pluno.ai` when a supported page opens so Pluno can select the origin-specific tool catalog. Paths, query strings, and page content are not included.
- Authentication information: a narrow Pluno bearer token is stored in `chrome.storage.local` and sent only to `https://app.pluno.ai` over HTTPS.
- Website content: invoked tools may read or modify the current website as required by the user&apos;s Claude/Codex task. That website data is returned to the local page/Claude/Codex flow and is not automatically uploaded to Pluno by the extension.

Certify that data is used only for the extension&apos;s single purpose, is not sold or used for advertising or credit decisions, and is not transferred except as necessary to provide the feature or comply with law and security obligations.

Privacy policy URL: `https://pluno.ai/privacy-policy`

Terms URL: `https://pluno.ai/terms`

## Reviewer instructions

1. Install the extension and click its toolbar icon.
2. Choose **Open setup**, sign in to Pluno, accept the terms, and leave the signup page open until the extension card shows **Connected**.
3. Import the public companion integration from `https://github.com/unbrainedgmbh/pluno-webmcp-for-anything` into Claude/Codex and approve its Pluno OAuth connection.
4. Ask Claude/Codex to use external Chrome on a normal HTTPS page.
5. Open the extension popup. It will show the paired account and the number of tools available for the current tab, or a clear pending/error state.

Tools load automatically on supported pages; Claude/Codex does not need to attach a debugger for discovery or normal execution.

## Assets

- Store icon: `extension/icons/icon-128.png`
- Listing screenshot: `store-assets/screenshot-1280x800.png`
- Small promotional tile: `store-assets/small-promo-440x280.png`
- Marquee promotional tile: `store-assets/marquee-1400x560.png`

## Final dashboard inputs

- Chrome Web Store developer/publisher account
- Support email and distribution countries
- Confirmation that the public privacy policy contains the data practices described above
