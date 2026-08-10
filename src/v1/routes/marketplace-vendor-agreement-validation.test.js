const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MarketplaceValidation = require('../validations/marketplace-validation');

const schema = MarketplaceValidation.startVendorAgreementSigning.body;
const draftId = 'event-vendor:profile-123:event-456';
const accepted = schema.validate({ event_id: 'event-456', application_draft_id: draftId });
assert.equal(accepted.error, undefined);
assert.equal(accepted.value.application_draft_id, draftId);

for (const optionalValue of [undefined, null, '']) {
  const result = schema.validate({
    event_id: 'food-event-1',
    ...(optionalValue === undefined ? {} : { application_draft_id: optionalValue }),
  });
  assert.equal(result.error, undefined, `food-vendor signing permits ${String(optionalValue)}`);
}

assert.ok(schema.validate({ event_id: 'event-1', application_draft_id: 'x'.repeat(161) }).error);
assert.ok(schema.validate({ event_id: 'event-1', application_draft_id: 42 }).error);
assert.ok(schema.validate({ event_id: 'event-1', application_draft_id: { id: draftId } }).error);

const finalPayment = MarketplaceValidation.createFinalEventPayment.body.validate({
  bid_id: 'bid-1',
  application_draft_id: draftId,
});
assert.ok(finalPayment.error, 'application_draft_id is not accepted by final-event payment');

const routeSource = fs.readFileSync(path.join(__dirname, 'marketplace.js'), 'utf8');
const signingRoute = routeSource.slice(
  routeSource.indexOf("'/vendor-agreements/signing'"),
  routeSource.indexOf("'/vendor-agreements/:agreementId/return'")
);
assert.match(signingRoute, /validate\(Validation\.startVendorAgreementSigning\)/);

const controllerSource = fs.readFileSync(
  path.join(__dirname, '../controllers/marketplace-controller.js'),
  'utf8'
);
assert.match(
  controllerSource,
  /application_draft_id: req\.body\.application_draft_id \|\| null/,
  'the validated opaque draft identity is persisted unchanged'
);

console.log('marketplace vendor agreement route validation tests passed');
