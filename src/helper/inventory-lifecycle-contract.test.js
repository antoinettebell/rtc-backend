const assert = require('assert');
const fs = require('fs');
const path = require('path');
const OperationalComplianceFormModel = require('../models/operational-compliance-form');

const itemSchema = OperationalComplianceFormModel.schema.path('inventory_items').schema;
assert.equal(itemSchema.path('beginning_quantity').options.min, 0);
assert.equal(itemSchema.path('current_quantity').options.min, 0);
assert.deepEqual(itemSchema.path('lifecycle_status').options.enum, ['ACTIVE', 'ARCHIVED']);
assert.ok(itemSchema.path('actions'));
assert.ok(itemSchema.path('source_form_id'));
assert.ok(itemSchema.path('applied_review_keys'));
assert.ok(itemSchema.path('reorder_resolved_at'));
assert.ok(itemSchema.path('actions').schema.path('action').options.enum.includes('ITEM_UPDATED'));
assert.ok(itemSchema.path('actions').schema.path('action').options.enum.includes('REORDER_RECEIVED'));
assert.ok(OperationalComplianceFormModel.schema.path('inventory_review_action').options.enum.includes('UPDATED'));
assert.ok(OperationalComplianceFormModel.schema.path('inventory_review_claimed_at'));
assert.ok(OperationalComplianceFormModel.schema.path('inventory_review_claim_action'));
assert.ok(OperationalComplianceFormModel.schema.path('inventory_review_claimed_by_id'));
assert.ok(OperationalComplianceFormModel.schema.path('status').options.enum.includes('CANCELLED'));

const routes = fs.readFileSync(
  path.join(__dirname, '../v1/routes/operational-compliance.js'),
  'utf8'
);
for (const action of ['close-count', 'items/:itemId/archive', 'inventory/:id/discard-draft', 'inventory/:id/review']) {
  assert.ok(routes.includes(action), `missing inventory route ${action}`);
}
assert.match(routes, /close-count', allowedTo\(\['VENDOR'\]\)/);
assert.match(routes, /items\/:itemId\/archive', allowedTo\(\['VENDOR'\]\)/);
assert.match(routes, /inventory\/:id\/discard-draft', allowedTo\(\['VENDOR'\]\)/);
assert.match(routes, /inventory\/:id\/review', allowedTo\(\['VENDOR'\]\)/);

const service = fs.readFileSync(
  path.join(__dirname, '../v1/services/operational-compliance-form-service.js'),
  'utf8'
);
assert.match(service, /Only the vendor can manage final inventory/);
assert.match(service, /Employee inventory submissions are immutable/);
assert.match(service, /expiration_notification_key/);
assert.match(service, /inventory-expired:/);
assert.match(service, /getEmployeeInventorySeed/);
assert.match(service, /item\.record_status !== 'SUBMITTED'/);
assert.match(service, /type === 'INVENTORY' \? \{ inventory_review_action: null \} : \{\}/);
assert.match(service, /inventory_review_action: \{ \$ne: null \}/);
assert.match(service, /source\.status = 'ARCHIVED'/);
assert.match(service, /Model\.find\(query\)\.cursor\(\)/);
assert.match(service, /Inventory Item: \$\{item\.item_name\} has expired\./);
assert.match(service, /Please update the expiration date or close the inventory count with a fresher item\./);

console.log('inventory lifecycle contract tests passed');
