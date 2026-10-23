const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
const controller = read('marketplace-vendor-bank-detail-controller.js');
const model = read('../../models/marketplace-vendor-bank-detail.js');
const routes = read('../routes/marketplace.js');

assert.match(model, /mongoose\.model\('marketplace-vendor-bank-details'/);
assert.match(model, /marketplace_vendor_profile_id/);
assert.match(model, /vendor_user_id/);
assert.match(controller, /EncryptionService\.encryptFields/);
assert.match(controller, /EncryptionService\.decryptFields/);
assert.match(controller, /MarketplaceVendorBankDetailModel\.findOneAndUpdate/);
assert.match(controller, /Marketplace Vendor profile is required/);
assert.match(routes, /\/event-vendor\/payment-details/);
assert.match(routes, /UserValidation\.bankDetail/);

console.log('Marketplace Vendor bank-detail isolation tests passed');
