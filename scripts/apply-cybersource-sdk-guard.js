"use strict";

const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "cybersource-rest-client",
  "src",
  "ApiClient.js",
);
const marker = "transport failures (timeout, DNS, TLS, connection reset)";

if (!fs.existsSync(target)) {
  throw new Error(`CyberSource SDK source was not found at ${target}`);
}

const source = fs.readFileSync(target, "utf8");
if (source.includes(marker)) {
  console.log("CyberSource transport-error guard already applied.");
  process.exit(0);
}

const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
const unsafe = [
  "      source.cancel('Stream ended.');",
  "      MLEUtility.checkAndDecryptEncryptedResponse(error.response.data, _this.merchantConfig)",
].join(lineEnding);

if (!source.includes(unsafe)) {
  throw new Error("CyberSource SDK source does not match the expected 0.0.81 error path.");
}

const guarded = [
  "      source.cancel('Stream ended.');",
  "      // CyberSource transport failures (timeout, DNS, TLS, connection reset) have",
  "      // no response object. Return the original error to the caller's retry path.",
  "      if (!error.response || typeof error.response.data === 'undefined') {",
  "        var userError = {};",
  '        if (error.code && error.code == "ECONNREFUSED") {',
  "          userError = _this.translateProxyIssue(error);",
  '        } else if (error.code && error.code == "ETIMEDOUT") {',
  "          userError = _this.translateProxyIssue(error);",
  "        } else {",
  "          userError = _this.translateError(error);",
  "          response = userError.response;",
  "        }",
  "",
  "        if (callback) {",
  "          callback(userError, null, response);",
  "        }",
  "        return;",
  "      }",
  "      MLEUtility.checkAndDecryptEncryptedResponse(error.response.data, _this.merchantConfig)",
].join(lineEnding);

fs.writeFileSync(target, source.replace(unsafe, guarded));
console.log("Applied CyberSource transport-error guard.");
