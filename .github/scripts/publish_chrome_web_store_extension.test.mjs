import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = JSON.stringify({
  client_email: "publisher@example.invalid",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});
const publisher = resolve(".github/scripts/publish_chrome_web_store_extension.sh");

// Replace curl entirely: the publisher is exercised without credentials or network access.
const mockCurl = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const url = args.at(-1);
const scenario = process.env.PUBLISH_TEST_SCENARIO;
fs.appendFileSync(process.env.PUBLISH_TEST_LOG, url + "\\n");
if (url === "https://oauth2.googleapis.com/token") {
  console.log(JSON.stringify(scenario === "missing-token" ? {} : { access_token: "test-token" }));
} else if (url.endsWith(":upload")) {
  const failed = scenario === "upload-http-error";
  const state = scenario === "upload-state-error" ? "FAILED" :
    scenario.startsWith("async") ? "UPLOAD_IN_PROGRESS" : "SUCCEEDED";
  fs.writeFileSync(args[args.indexOf("--output") + 1], JSON.stringify({ uploadState: state }));
  process.stdout.write(failed ? "400" : "200");
} else if (url.endsWith(":fetchStatus")) {
  const state = scenario === "async-timeout" ? "IN_PROGRESS" :
    scenario === "async-error" ? "FAILED" : "SUCCEEDED";
  console.log(JSON.stringify({ lastAsyncUploadState: state }));
} else if (url.endsWith(":publish")) {
  if (scenario === "publish-http-error") process.exit(22);
  console.log(JSON.stringify({ state: "PENDING_REVIEW" }));
} else {
  throw new Error("Unexpected request: " + url);
}
`;

function runPublisher(scenario, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "webmcp-publisher-test-"));
  try {
    const log = join(directory, "requests.log");
    const archive = join(directory, "extension.zip");
    writeFileSync(join(directory, "curl"), mockCurl, { mode: 0o755 });
    writeFileSync(join(directory, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(archive, "test archive");
    const result = spawnSync("bash", [publisher], {
      encoding: "utf8",
      timeout: 20000,
      env: {
        ...process.env,
        PATH: directory + ":" + process.env.PATH,
        CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON: serviceAccount,
        CHROME_WEB_STORE_PUBLISHER_ID: "test-publisher",
        CHROME_WEB_STORE_EXTENSION_ID: "fbdnbpkcboonegpniiabdgpfjjkpnifn",
        CHROME_WEB_STORE_DEFER_NOT_UPDATEABLE: "false",
        EXTENSION_ZIP_PATH: archive,
        PUBLISH_TEST_LOG: log,
        PUBLISH_TEST_SCENARIO: scenario,
        ...overrides,
      },
    });
    assert.ifError(result.error);
    return { ...result, requests: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [] };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const scenario of ["success", "async-success"]) {
  test("submits exactly once after successful upload: " + scenario, () => {
    const result = runPublisher(scenario);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.requests.filter(url => url.endsWith(":publish")).length, 1);
    assert.equal(result.requests.at(-1),
      "https://chromewebstore.googleapis.com/v2/publishers/test-publisher/items/fbdnbpkcboonegpniiabdgpfjjkpnifn:publish");
  });
}

for (const scenario of ["missing-token", "upload-http-error", "upload-state-error", "async-error", "async-timeout"]) {
  test("does not publish after " + scenario, () => {
    const result = runPublisher(scenario);
    assert.notEqual(result.status, 0);
    assert.equal(result.requests.some(url => url.endsWith(":publish")), false);
  });
}

test("missing credentials fail before any request", () => {
  const result = runPublisher("success", { CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON: "" });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.requests, []);
});

test("publication failure fails CI rather than reporting success", () => {
  const result = runPublisher("publish-http-error");
  assert.notEqual(result.status, 0);
  assert.equal(result.requests.filter(url => url.endsWith(":publish")).length, 1);
});
