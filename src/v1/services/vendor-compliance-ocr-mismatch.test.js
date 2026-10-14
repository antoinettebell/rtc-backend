const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getOcrMismatchOutcome,
  getTaxIdentifierOcrOutcome,
  getDocumentBusinessNames,
  nameMatchesProfile,
  taxDigits,
} = require('./vendor-compliance-service');

assert.equal(
  taxDigits('12-345 6789'),
  '123456789',
  'Tax-ID comparison must use the shared vendor sanitizer for spaces and dashes'
);
assert.deepEqual(
  getDocumentBusinessNames({
    extracted_fields: { taxpayer_name: 'Jazzy Fried Rice LLC', business_name: 'Jazzy Fried Rice' },
  }),
  ['Jazzy Fried Rice', 'Jazzy Fried Rice LLC'],
  'W-9 name candidates must use the shared vendor extractor'
);

assert.equal(
  getTaxIdentifierOcrOutcome({ extractedDigits: '', profileDigits: '123456789' }),
  'NOT_DETECTED'
);
assert.equal(
  getTaxIdentifierOcrOutcome({ extractedDigits: '123456789', profileDigits: '' }),
  'PROFILE_UNAVAILABLE'
);
assert.equal(
  getTaxIdentifierOcrOutcome({ extractedDigits: '123456789', profileDigits: '123456789' }),
  'MATCHED'
);
assert.equal(
  getTaxIdentifierOcrOutcome({ extractedDigits: '123456789', profileDigits: '987654321' }),
  'MISMATCH'
);
assert.equal(
  nameMatchesProfile({ name: 'Jazzy Fried Rice' }, 'Jazzy Fried Rice'),
  true,
  'A legacy profile without a Legal Business Name or DBA may match its food-truck name'
);
assert.equal(
  nameMatchesProfile(
    { name: 'Jazzy Fried Rice', legal_business_name: 'Jazzy Fried Rice LLC' },
    'Jazzy Fried Rice'
  ),
  false,
  'A populated Legal Business Name remains authoritative over the food-truck name'
);

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
  /tax_identifier_ocr_outcome = taxIdentifierOcrOutcome/,
  'Only the non-sensitive W-9 tax-ID OCR outcome may be retained'
);
assert.match(
  serviceSource,
  /const legalBusinessNameMatches = extractedBusinessNames\.some\(\(value\) =>\s*nameMatchesProfile\(foodTruck, value\)/,
  'W-9 and business-license OCR names must be checked against every permitted profile business name'
);
assert.match(
  serviceSource,
  /if \(!complianceNames\.length\)[\s\S]*foodTruck\.name/,
  'Food Truck Name must be used only as a fallback for legacy profiles without compliance names'
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
assert.match(
  serviceSource,
  /documentTypes = \[\]/,
  'OCR submission must accept explicit document-type retries'
);
assert.match(
  serviceSource,
  /!isExplicitDocumentRetry && document\.ocr_status !== 'not_configured'/,
  'Normal OCR submission must leave unchanged verified/reviewed documents untouched'
);

const coordinatorSource = fs.readFileSync(
  path.join(__dirname, '../controllers/coordinator-compliance-controller.js'),
  'utf8'
);
assert.match(
  coordinatorSource,
  /getDocumentBusinessNames\(\{\s*extracted_fields: extractedFields,\s*\}\)/,
  'Coordinator W-9 OCR must use the vendor W-9 document-name extractor'
);
assert.match(
  coordinatorSource,
  /const extractedTaxId = taxDigits\(extractedFields\.tax_identifier \|\| extractedFields\.ein \|\| extractedFields\.ssn\)/,
  'Coordinator W-9 OCR must use the vendor tax-ID sanitizer'
);

console.log('vendor compliance OCR mismatch tests passed');
