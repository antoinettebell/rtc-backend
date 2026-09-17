const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getComplianceRequirement,
} = require('./vendor-compliance-config');

const sanitationRequirement = getComplianceRequirement('HEALTH_PERMIT');
assert.ok(sanitationRequirement.ocrFields.includes('issue_date'));
assert.equal(sanitationRequirement.ocrFields.includes('expiration_date'), false);

const serviceSource = fs.readFileSync(
  path.join(__dirname, '../v1/services/vendor-compliance-service.js'),
  'utf8'
);
assert.match(
  serviceSource,
  /document_type: \{ \$ne: 'HEALTH_PERMIT' \},\s*expiration_date: \{ \$lt: now \}/,
  'Sanitation Grades must not be archived as expired'
);
assert.match(
  serviceSource,
  /document_type: \{ \$ne: 'HEALTH_PERMIT' \},\s*expiration_date: \{ \$ne: null \}/,
  'Sanitation Grades must not receive expiration reminders'
);
assert.match(
  serviceSource,
  /vendor_entered_issue_date: isSanitationGrade \? vendorEnteredIssueDate : null/,
  'The vendor-entered inspection date must be preserved for OCR comparison'
);
assert.match(
  serviceSource,
  /OCR inspection date does not match the vendor-entered inspection date/,
  'OCR must flag a mismatched inspection date for manual review'
);
assert.match(
  serviceSource,
  /action: 'ADMIN_UPDATE_DATES'/,
  'Admin date corrections must be audited'
);

const routesSource = fs.readFileSync(
  path.join(__dirname, '../v1/routes/vendor-compliance.js'),
  'utf8'
);
assert.match(
  routesSource,
  /admin\/documents\/\:documentId'[\s\S]*Controller\.adminUpdateDocument/,
  'Admins must have a dedicated compliance date-correction endpoint'
);

console.log('vendor compliance inspection date tests passed');
