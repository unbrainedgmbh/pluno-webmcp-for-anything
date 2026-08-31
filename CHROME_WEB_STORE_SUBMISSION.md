# Chrome Web Store submission

## Listing

Name: Pluno WebMCP for Anything

Category: Developer Tools

Summary: Gives Claude/Codex fast, reliable, API-first tools while it controls external Chrome.

Detailed description:

Pluno WebMCP for Anything connects Claude/Codex to purpose-built browser tools in external Chrome. When an AI agent attaches a debugger to a tab, the extension loads reviewed tools for that website and exposes them through native WebMCP when available and through the directly callable Pluno registry everywhere else. Debugger-attached background tabs are supported; unrelated tabs remain untouched.

The extension stays inactive during normal browsing. It only requests and injects tools while Chrome reports that Claude/Codex has attached a debugger to that specific tab. The popup shows whether setup is complete and whether tools are active for the current tab.

Setup requires one Pluno sign-in, the Chrome extension, and the companion Claude/Codex integration.

## Single purpose

Expose reviewed, site-specific browser tools while Claude/Codex controls the user&apos;s external Chrome tab.

## Permission justifications

- `debugger`: Detects when Claude/Codex is actively controlling a tab and uses Chrome&apos;s documented Debugger API to deliver the selected tool catalog into that tab, including when it is in the background. The extension detaches immediately after delivery.
- `scripting`: Removes stale tools after navigation and displays setup or connection errors in the affected page without exposing the Pluno bearer token.
- `storage`: Stores the extension&apos;s Pluno pairing secret and bearer token locally.
- `tabs`: Opens onboarding, identifies the active tab for the status popup, and clears transient state when a tab closes.
- `alarms`: Checks the short-lived pairing flow in the background until onboarding completes or expires.
- `<all_urls>` host access: The product&apos;s single purpose is to provide origin-specific tools on any website the user asks Claude/Codex to operate. Tool activation remains gated on an attached debugger.

## Remote code declaration

Answer: Yes.

Justification: The extension downloads reviewed, origin-specific tool definitions from Pluno and executes their JavaScript only inside the website tab after the user asks Claude/Codex to control that tab. Delivery and execution use Chrome&apos;s Debugger API, which the Manifest V3 remote-code policy explicitly permits for logic covered by that API. The extension itself contains the complete activation, authentication, status, and safety logic; remote definitions are never executed in the extension service worker or popup.

## Data disclosures

Disclose these categories:

- Web history: a debugger-attached tab&apos;s current page URL is sent to `https://app.pluno.ai` only while Claude/Codex controls that tab, so Pluno can select the origin-specific tool catalog.
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

Normal browsing without an attached Claude/Codex debugger causes no tool request or injection.

## Assets

- Store icon: `extension/icons/icon-128.png`
- Listing screenshot: `store-assets/screenshot-1280x800.png`
- Small promotional tile: `store-assets/small-promo-440x280.png`
- Marquee promotional tile: `store-assets/marquee-1400x560.png`

## Final dashboard inputs

- Chrome Web Store developer/publisher account
- Support email and distribution countries
- Production extension listing URL for `NEXT_PUBLIC_WEBMCP_EXTENSION_INSTALL_URL`
- Confirmation that the public privacy policy contains the data practices described above
