const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(
  path.join(__dirname, '../v1/controllers/marketplace-controller.js'),
  'utf8'
);
const attachmentFailureBlock = controller.match(
  /catch \(error\) \{\s*console\.error\('DocuSign signed agreement attachment unavailable',[\s\S]*?\n\s*\}/
)?.[0] || '';

assert.match(attachmentFailureBlock, /getSafeErrorCode/);
assert.doesNotMatch(attachmentFailureBlock, /sendDeveloperAlert|agreement_id|envelope_id/);

console.log('Marketplace DocuSign coordinator email safety tests passed');
