const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getComplianceRequirement,
} = require('./vendor-compliance-config');

const sanitationRequirement = getComplianceRequirement('HEALTH_PERMIT');
assert.ok(sanitationRequirement.ocrFields.includes('issue_date'));
assert.equal(sanitationRequirement.ocrFields.includes('expiration_date'), false);
assert.ok(getComplianceRequirement('BUSINESS_LICENSE').ocrFields.includes('issue_date'));
assert.ok(getComplianceRequirement('COI').ocrFields.includes('issue_date'));
assert.ok(getComplianceRequirement('LIQUOR_LICENSE').ocrFields.includes('issue_date'));

const equallyWeightedRequirements = [
  'BUSINESS_LICENSE',
  'COI',
  'LIQUOR_LICENSE',
  'EIN',
  'W9',
].map((type) => getComplianceRequirement(type));
assert.equal(equallyWeightedRequirements.length, 5);
assert.ok(
  equallyWeightedRequirements.every(
    (requirement) => requirement.scoreWeight === equallyWeightedRequirements[0].scoreWeight
  ),
  'The five scored compliance documents must contribute equally to the score'
);
assert.equal(
  sanitationRequirement.scoreWeight,
  0,
  'Sanitation Grade must not contribute to the compliance percentage'
);

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
  /vendor_entered_issue_date: vendorEnteredIssueDate/,
  'Vendor-entered issue and inspection dates must be preserved for OCR comparison'
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
assert.match(
  serviceSource,
  /action: 'ADMIN_ARCHIVE'/,
  'Manual document archiving must be audited'
);
assert.match(
  serviceSource,
  /action: 'ARCHIVE_REPLACED'/,
  'Replaced document versions must be archived for audit'
);
assert.match(
  serviceSource,
  /if \(document\.review_status !== 'verified'\)[\s\S]*deleteUnverifiedDocument/,
  'Only unverified replacement versions may be deleted'
);
assert.match(
  serviceSource,
  /document\.review_status === 'verified' \|\| attachedToMarketplace[\s\S]*archiveComplianceDocumentRecord/,
  'A verified document must be archived rather than deleted'
);
assert.match(
  serviceSource,
  /Archived compliance documents are read-only/,
  'Archived records must be immutable'
);
assert.match(
  serviceSource,
  /Math\.round\(\(score \/ totalScoreWeight\) \* 100\)/,
  'Compliance score must normalize the five equal document weights to 100 percent'
);
assert.match(
  serviceSource,
  /const profileTaxIdentifierVerified = isEinDocument[\s\S]*status = 'verified';[\s\S]*score \+= requirement\.scoreWeight/,
  'A securely stored profile EIN or SSN must satisfy the tax identifier score requirement'
);
assert.match(
  serviceSource,
  /score < 100 \|\| hasPendingReview \|\| !eligible/,
  'Compliance must remain yellow until the full score is complete and eligible'
);
assert.match(
  serviceSource,
  /const isPendingReview = document\.review_status === 'pending_review';[\s\S]*const hasFinishedOcr = \['completed', 'manual_review'\][\s\S]*if \(!isPendingReview \|\| hasFinishedOcr\) \{[\s\S]*continue;/,
  'Submitting OCR must not requeue verified, completed, or manual-review documents'
);
assert.match(
  serviceSource,
  /extractedExpirationDate && !isSanitationGrade && !expirationMismatch[\s\S]*expirationMismatch && document\.vendor_entered_expiration_date[\s\S]*document\.expiration_date = asDate\(document\.vendor_entered_expiration_date\)/,
  'A mismatched OCR expiration date must not replace the vendor-entered operative date'
);
assert.match(
  serviceSource,
  /extractedIssueDate && requiresIssueDate && !issueDateMismatch[\s\S]*issueDateMismatch && document\.vendor_entered_issue_date[\s\S]*document\.issue_date = asDate\(document\.vendor_entered_issue_date\)/,
  'A mismatched OCR issue date must not replace the vendor-entered operative date'
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
assert.match(
  routesSource,
  /admin\/documents\/\:documentId\/archive'[\s\S]*Controller\.adminArchiveDocument/,
  'Admins must have a dedicated compliance archive endpoint'
);

const foodTruckControllerSource = fs.readFileSync(
  path.join(__dirname, '../v1/controllers/food-truck-controller.js'),
  'utf8'
);
assert.match(
  foodTruckControllerSource,
  /const applyFoodTruckTaxId = \(item, \{ ein, ssn \}\)/,
  'Tax identifier persistence must infer EIN or SSN from the tax fields, not the truck profile type'
);
assert.doesNotMatch(
  foodTruckControllerSource,
  /applyFoodTruckTaxId\(item, \{ ein, ssn, infoType \}\)/,
  'Food truck or caterer profile type must not be interpreted as the tax identifier type'
);

console.log('vendor compliance inspection date tests passed');
