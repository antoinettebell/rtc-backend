const assert = require('assert');
const {
  buildSignedAgreementAttachmentContext,
  buildSignedAgreementAttachmentLink,
  resolveMarketplaceAgreementVendorContext,
} = require('./marketplace-agreement-vendor-context');

(async () => {
  for (const vendorTypes of [['MERCHANDISE'], ['SERVICE'], ['OTHER']]) {
    let foodTruckLookup = false;
    const result = await resolveMarketplaceAgreementVendorContext({
      user: { _id: 'vendor-1', vendorSubtype: 'EVENT_VENDOR' },
      findApprovedEventVendorProfile: async () => ({ profile_id: 'profile-1', vendor_types: vendorTypes }),
      findFoodTruck: async () => { foodTruckLookup = true; },
    });
    assert.equal(result.eventVendorProfile.profile_id, 'profile-1');
    assert.equal(result.foodTruck, null);
    assert.equal(foodTruckLookup, false);
  }

  const foodTruck = { _id: 'truck-1' };
  const foodResult = await resolveMarketplaceAgreementVendorContext({
    user: { _id: 'vendor-2', vendorSubtype: 'FOOD_VENDOR' },
    findApprovedEventVendorProfile: async () => { throw new Error('must not run'); },
    findFoodTruck: async () => foodTruck,
  });
  assert.equal(foodResult.foodTruck, foodTruck);
  assert.equal(foodResult.eventVendorProfile, null);

  await assert.rejects(
    resolveMarketplaceAgreementVendorContext({
      user: { _id: 'vendor-3', vendorSubtype: 'EVENT_VENDOR' },
      findApprovedEventVendorProfile: async () => null,
      findFoodTruck: async () => null,
    }),
    /approved Marketplace Vendor profile/
  );

  const reusableContext = buildSignedAgreementAttachmentContext({
    agreement: { envelope_id: 'envelope-1' },
    eventId: 'event-1',
    vendorUserId: 'vendor-1',
    foodTruck: null,
    reuseExistingSignedDocument: true,
  });
  assert.equal(reusableContext.food_truck_id, null);
  assert.equal(reusableContext.reuse_existing_signed_document, true);

  const foodContext = buildSignedAgreementAttachmentContext({
    agreement: { envelope_id: 'envelope-2' },
    eventId: 'event-2',
    vendorUserId: 'vendor-2',
    foodTruck: { _id: 'truck-1' },
  });
  assert.equal(foodContext.food_truck_id, 'truck-1');

  const link = buildSignedAgreementAttachmentLink({
    eventId: 'event-1',
    vendorUserId: 'vendor-1',
    envelopeId: 'envelope-1',
    applicationId: 'application-1',
  });
  assert.equal(link.query.application_id, null);
  assert.equal(link.query.docusign_envelope_id, 'envelope-1');
  assert.equal(link.update.application_id, 'application-1');
  console.log('marketplace agreement vendor context tests passed');
})();
