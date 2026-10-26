const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getOcrMismatchOutcome,
  getTaxIdentifierOcrOutcome,
  getDocumentBusinessNames,
  nameMatchesProfile,
  taxDigits,
  getSelectedTaxIdentifierType,
  getRequiredIdentityDocumentType,
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
  true,
  'OCR may omit a legal entity suffix from an otherwise matching Legal Business Name'
);
assert.equal(
  nameMatchesProfile(
    { name: 'Jazzy Fried Rice', legal_business_name: 'Jazzy Fried Rice LLC' },
    'Jazzy Fried Rice Kitchen'
  ),
  false,
  'OCR business-name matching must remain strict beyond the optional legal entity suffix'
);
assert.equal(
  getSelectedTaxIdentifierType({ tax_identifier_type: 'EIN', ssn: '123-45-6789' }),
  'EIN',
  'The saved legal-payee account type must win over a stale legacy SSN field'
);
assert.equal(
  getRequiredIdentityDocumentType({ tax_identifier_type: 'SSN' }),
  'DRIVER_LICENSE_FRONT',
  'SSN legal payees use only the Driver License identity route'
);
assert.equal(
  getRequiredIdentityDocumentType({ tax_identifier_type: 'EIN' }),
  'BUSINESS_LICENSE',
  'EIN legal payees use only the Permit/Business License identity route'
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
assert.match(
  serviceSource,
  /document\.document_type !== 'W9' && document\.document_type !== requiredIdentityDocumentType/,
  'OCR submission must ignore an inactive legacy identity-document route'
);

const coordinatorSource = fs.readFileSync(
  path.join(__dirname, '../controllers/coordinator-compliance-controller.js'),
  'utf8'
);
assert.match(
  coordinatorSource,
  /getDocumentBusinessNames\(\{\s*extracted_fields: extractedFields\s*\}\)/,
  'Coordinator W-9 OCR must use the vendor W-9 document-name extractor'
);
assert.match(
  coordinatorSource,
  /const extractedTaxId = taxDigits\(extractedFields\.tax_identifier \|\| extractedFields\.ein \|\| extractedFields\.ssn\)/,
  'Coordinator W-9 OCR must use the vendor tax-ID sanitizer'
);
assert.match(
  coordinatorSource,
  /Date\.now\(\) - requestedAt >= 2 \* 60 \* 1000/,
  'Coordinator OCR must retry a queued handoff only after the vendor two-minute stale-request window'
);
assert.match(
  coordinatorSource,
  /record\.ocr_status === 'not_configured'/,
  'Coordinator Save & Run OCR must continue to submit new evidence only'
);
assert.match(
  coordinatorSource,
  /if \(requiresPayoutCompliance\(coordinator\)\) \{[\s\S]*status: 'SIGNED'/,
  'Paid individual and business coordinators must both submit their signed W-9 for OCR'
);
assert.doesNotMatch(
  coordinatorSource,
  /w9Profile\.party_type !== 'BUSINESS'/,
  'Individual coordinator W-9 OCR must not be rejected as a business-only document'
);

console.log('vendor compliance OCR mismatch tests passed');
