#!/usr/bin/env bash

set -euo pipefail

for required_variable in \
  CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON \
  CHROME_WEB_STORE_PUBLISHER_ID \
  CHROME_WEB_STORE_EXTENSION_ID \
  EXTENSION_ZIP_PATH; do
  if [[ -z "${!required_variable:-}" ]]; then
    echo "Missing $required_variable"
    exit 1
  fi
done

if [[ ! -f "$EXTENSION_ZIP_PATH" ]]; then
  echo "Extension archive not found: $EXTENSION_ZIP_PATH"
  exit 1
fi

ASSERTION=$(node --input-type=module <<'NODE'
import crypto from "node:crypto";

const serviceAccount = JSON.parse(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON);
const now = Math.floor(Date.now() / 1000);
const header = {
  alg: "RS256",
  typ: "JWT",
};
const payload = {
  iss: serviceAccount.client_email,
  scope: "https://www.googleapis.com/auth/chromewebstore",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
};

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const unsignedJwt = `${base64Url(header)}.${base64Url(payload)}`;
const signature = crypto
  .createSign("RSA-SHA256")
  .update(unsignedJwt)
  .sign(serviceAccount.private_key, "base64url");

console.log(`${unsignedJwt}.${signature}`);
NODE
)

TOKEN_RESPONSE=$(curl --fail-with-body --silent --show-error \
  --request POST \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=$ASSERTION" \
  "https://oauth2.googleapis.com/token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r ".access_token")
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
  echo "Chrome Web Store access token response did not include access_token"
  exit 1
fi
echo "::add-mask::$ACCESS_TOKEN"

ITEM_URL="https://chromewebstore.googleapis.com/v2/publishers/$CHROME_WEB_STORE_PUBLISHER_ID/items/$CHROME_WEB_STORE_EXTENSION_ID"
UPLOAD_URL="https://chromewebstore.googleapis.com/upload/v2/publishers/$CHROME_WEB_STORE_PUBLISHER_ID/items/$CHROME_WEB_STORE_EXTENSION_ID:upload"
RESPONSE_BODY=$(mktemp)
trap 'rm -f "$RESPONSE_BODY"' EXIT

HTTP_CODE=$(curl --silent --show-error --output "$RESPONSE_BODY" --write-out "%{http_code}" \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --request POST \
  --upload-file "$EXTENSION_ZIP_PATH" \
  "$UPLOAD_URL")

echo "Chrome Web Store upload HTTP $HTTP_CODE response:"
cat "$RESPONSE_BODY"

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  REASON=$(jq -r '.error.details[]? | select(."@type"=="type.googleapis.com/google.rpc.ErrorInfo") | .reason // empty' "$RESPONSE_BODY" 2>/dev/null || true)

  if [[ "$HTTP_CODE" == "400" && "$REASON" == "NOT_UPDATEABLE" ]]; then
    if [[ "${CHROME_WEB_STORE_DEFER_NOT_UPDATEABLE:-false}" == "true" ]]; then
      echo "::warning::Chrome Web Store upload deferred because the previous version is still in review (NOT_UPDATEABLE). Rerun this workflow after that review finishes."
      exit 0
    fi

    echo "::error::Chrome Web Store upload blocked because the previous version is still in review (NOT_UPDATEABLE). Rerun this workflow after that review finishes."
    exit 1
  fi

  echo "::error::Chrome Web Store upload failed with HTTP $HTTP_CODE"
  exit 1
fi

UPLOAD_STATE=$(jq -r '.uploadState // empty' "$RESPONSE_BODY")
UPLOAD_READY=false

case "$UPLOAD_STATE" in
  SUCCEEDED|UPLOAD_SUCCEEDED)
    UPLOAD_READY=true
    ;;
  IN_PROGRESS|UPLOAD_IN_PROGRESS)
    for attempt in {1..30}; do
      echo "Chrome Web Store upload is still processing; status check $attempt/30"
      sleep 10

      STATUS_RESPONSE=$(curl --fail-with-body --silent --show-error \
        --header "Authorization: Bearer $ACCESS_TOKEN" \
        "$ITEM_URL:fetchStatus")
      UPLOAD_STATE=$(echo "$STATUS_RESPONSE" | jq -r '.lastAsyncUploadState // empty')

      case "$UPLOAD_STATE" in
        SUCCEEDED|UPLOAD_SUCCEEDED)
          UPLOAD_READY=true
          break
          ;;
        IN_PROGRESS|UPLOAD_IN_PROGRESS)
          ;;
        *)
          echo "::error::Chrome Web Store asynchronous upload ended in state: ${UPLOAD_STATE:-missing}"
          exit 1
          ;;
      esac
    done
    ;;
  *)
    echo "::error::Chrome Web Store upload ended in state: ${UPLOAD_STATE:-missing}"
    exit 1
    ;;
esac

if [[ "$UPLOAD_READY" != "true" ]]; then
  echo "::error::Chrome Web Store upload did not finish within 5 minutes"
  exit 1
fi

curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --request POST \
  "$ITEM_URL:publish"
