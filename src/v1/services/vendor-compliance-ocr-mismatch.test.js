const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getOcrMismatchOutcome,
} = require('./vendor-compliance-service');

const firstMismatch = getOcrMismatchOutcome({
  message: 'OCR could not confirm the W-9 EIN or SSN matches the vendor profile.',
  revalidationAttempt: 0,
});
assert.deepEqual(firstMismatch, {
  reviewStatus: 'revalidation_needed',
  ocrStatus: 'revalidation_needed',
  errorMessage: 'OCR could not confirm the W-9 EIN or SSN matches the vendor profile.',
});

const replacementMismatch = getOcrMismatchOutcome({
  message: 'OCR could not confirm the W-9 EIN or SSN matches the vendor profile.',
  revalidationAttempt: 1,
});
assert.equal(replacementMismatch.reviewStatus, 'manual_review');
assert.equal(replacementMismatch.ocrStatus, 'manual_review');
assert.match(replacementMismatch.errorMessage, /replacement requires manual review/);

const serviceSource = fs.readFileSync(
  path.join(__dirname, 'vendor-compliance-service.js'),
  'utf8'
);
assert.match(
  serviceSource,
  /extractedDigits === profileDigits/,
  'W-9 and tax-proof OCR must compare the extracted tax ID with the encrypted profile value'
);
assert.match(
  serviceSource,
  /delete normalizedExtractedFields\[key\]/,
  'Raw OCR tax identifiers must be removed before metadata is saved'
);
assert.match(
  serviceSource,
  /legal_business_name_match = nameMatchesProfile/,
  'W-9 and business-license names must be checked against the profile business names'
);
assert.match(
  serviceSource,
  /applyOcrMismatchOutcome\(document, automaticValidationFailure\)/,
  'Identity mismatches must use the revalidation-first outcome'
);
assert.match(
  serviceSource,
  /applyOcrMismatchOutcome\(\s*document,\s*expirationMismatch/,
  'Expiration mismatches must use the revalidation-first outcome'
);

console.log('vendor compliance OCR mismatch tests passed');
