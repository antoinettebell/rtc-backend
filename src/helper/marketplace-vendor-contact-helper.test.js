const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  deriveMarketplaceVendorContact,
  sanitizeMarketplaceContactForCoordinator,
} = require('./marketplace-vendor-contact-helper');

const derived = deriveMarketplaceVendorContact({
  user: { firstName: 'Pat', lastName: 'Vendor', email: 'pat@example.com', mobileNumber: '5551112222' },
  foodTruck: { name: 'Pat Foods', phone: '5550000000' },
});
assert.deepStrictEqual(derived, {
  contact_name: 'Pat Vendor',
  phone: '5551112222',
  email: 'pat@example.com',
});
assert.notStrictEqual(derived.phone, 'client-supplied');

const submission = {
  application_id: 'application-1',
  phone: derived.phone,
  email: derived.email,
  contact_name: derived.contact_name,
  vendor_user_id: { _id: 'vendor-1', email: derived.email },
};
const locked = sanitizeMarketplaceContactForCoordinator(submission);
assert.strictEqual(locked.phone, undefined);
assert.strictEqual(locked.email, undefined);
assert.strictEqual(locked.contact_name, undefined);
assert.deepStrictEqual(locked.vendor_user_id, { _id: 'vendor-1' });
assert.strictEqual(
  sanitizeMarketplaceContactForCoordinator({ contact_number: '5551234567' }).contact_number,
  undefined
);
const paid = sanitizeMarketplaceContactForCoordinator(submission, { detailsUnlocked: true });
assert.strictEqual(paid.phone, '5551112222');
assert.strictEqual(paid.email, 'pat@example.com');
const admin = sanitizeMarketplaceContactForCoordinator(submission, { fullAccess: true });
assert.strictEqual(admin.email, 'pat@example.com');

const controllerSource = fs.readFileSync(
  path.join(__dirname, '../v1/controllers/marketplace-controller.js'),
  'utf8'
);
assert.match(controllerSource, /const vendorContact = deriveMarketplaceVendorContact/);
assert.match(controllerSource, /const applicationPayload = \{[\s\S]*\.\.\.req\.body,[\s\S]*\.\.\.vendorContact,/);
assert.match(controllerSource, /sanitizeMarketplaceContactForCoordinator\(plainRecord\)/);

console.log('Marketplace vendor contact authorization tests passed');
