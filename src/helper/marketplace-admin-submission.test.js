const assert = require('assert');

const {
  applyAdminSubmissionAttachmentReplacement,
  applyMarketplaceApplicationPhotoReplacement,
  buildMarketplaceApplicationPhotoAttachments,
  buildSubmissionSummary,
  getSubmissionAdministrativeState,
  getSubmissionConfig,
  getLockedSubmissionFields,
  isSubmissionActionAlreadyApplied,
  isAdminSubmissionAttachmentReplaceable,
  isSubmissionLifecycleLocked,
  pickEditableSubmissionFields,
  validateAdminSubmissionPublish,
} = require('./marketplace-admin-submission');

const run = () => {
  assert.strictEqual(getSubmissionConfig('food_bid').type, 'FOOD_BID');
  assert.strictEqual(getSubmissionConfig('unknown').config, null);

  assert.deepStrictEqual(
    pickEditableSubmissionFields('FOOD_BID', {
      price_per_guest: 12.5,
      notes: 'Updated by support',
      bid_status: 'AWARDED',
      payment_status: 'PAID',
      vendor_user_id: 'unsafe-change',
    }),
    {
      price_per_guest: 12.5,
      notes: 'Updated by support',
    }
  );

  const summary = buildSubmissionSummary('MARKETPLACE_APPLICATION', {
    application_id: 'application-1',
    status: 'SUBMITTED',
    business_name: 'Vendor One',
    vendor_types: ['MERCHANDISE'],
    vendor_user_id: 'vendor-1',
    profile_id: 'profile-1',
    created_at: new Date('2026-08-19T12:00:00.000Z'),
  });
  assert.strictEqual(summary.submission_id, 'application-1');
  assert.strictEqual(summary.status, 'SUBMITTED');
  assert.deepStrictEqual(summary.vendor_types, ['MERCHANDISE']);
  assert.strictEqual(summary.event_vendor_profile_id, 'profile-1');

  assert.strictEqual(
    isSubmissionLifecycleLocked('FOOD_APPLICATION', {
      application_status: 'PAYMENT_DUE',
    }),
    true
  );
  assert.strictEqual(
    isSubmissionLifecycleLocked('FOOD_APPLICATION', {
      application_status: 'UNDER_REVIEW',
    }),
    false
  );
  assert.strictEqual(
    getSubmissionAdministrativeState({ archived_at: new Date() }),
    'ARCHIVED'
  );
  assert.strictEqual(
    getSubmissionAdministrativeState({ deleted_at: new Date() }),
    'DELETED'
  );
  assert.strictEqual(
    isSubmissionActionAlreadyApplied('WITHDRAW', 'FOOD_BID', {
      bid_status: 'WITHDRAWN',
    }),
    true
  );
  assert.strictEqual(
    isSubmissionActionAlreadyApplied('ARCHIVE', 'FOOD_BID', {
      bid_status: 'SUBMITTED',
      archived_at: new Date(),
    }),
    true
  );
  assert.deepStrictEqual(
    getLockedSubmissionFields('FOOD_BID', { bid_status: 'AWARDED' }),
    [
      'price_per_guest',
      'average_price_per_meal',
      'full_bid_amount',
      'guest_coverage',
      'regular_guest_amount',
      'vip_catering_amount',
    ]
  );
  assert.deepStrictEqual(
    validateAdminSubmissionPublish({
      type: 'FOOD_BID',
      current: { bid_status: 'AWARDED', price_per_guest: 25 },
      updates: { price_per_guest: 30, notes: 'Safe note correction' },
    }),
    [{
      field: 'price_per_guest',
      message: 'price per guest cannot change after the submission is awarded. Revoke the award first.',
    }]
  );
  assert.deepStrictEqual(
    validateAdminSubmissionPublish({
      type: 'FOOD_BID',
      current: { bid_status: 'SUBMITTED', price_per_guest: 25 },
      updates: { price_per_guest: 30 },
    }),
    []
  );

  assert.strictEqual(
    isAdminSubmissionAttachmentReplaceable({
      attachment_type: 'BID_IMAGE',
      status: 'ACTIVE',
    }),
    true
  );
  assert.strictEqual(
    isAdminSubmissionAttachmentReplaceable({
      attachment_type: 'AGREEMENT_DOCUMENT',
      status: 'ACTIVE',
    }),
    false
  );
  assert.strictEqual(
    isAdminSubmissionAttachmentReplaceable({
      attachment_type: 'BID_IMAGE',
      status: 'DELETED',
    }),
    false
  );

  const imageSubmission = applyAdminSubmissionAttachmentReplacement(
    {
      image_urls: ['https://old.example/image.jpg'],
      image_keys: ['old/image.jpg'],
    },
    {
      attachment_type: 'BID_IMAGE',
      file_url: 'https://old.example/image.jpg',
      file_key: 'old/image.jpg',
    },
    {
      file_url: 'https://new.example/image.jpg',
      file_key: 'new/image.jpg',
    }
  );
  assert.deepStrictEqual(imageSubmission.image_urls, [
    'https://new.example/image.jpg',
  ]);
  assert.deepStrictEqual(imageSubmission.image_keys, ['new/image.jpg']);

  const permitSubmission = applyAdminSubmissionAttachmentReplacement(
    { permit_license_urls: null, permit_license_keys: null },
    {
      attachment_type: 'REQUIREMENT_DOCUMENT',
      file_url: 'missing-old-url',
      file_key: 'missing-old-key',
    },
    {
      file_url: 'https://new.example/permit.pdf',
      file_key: 'new/permit.pdf',
    }
  );
  assert.deepStrictEqual(permitSubmission.permit_license_urls, [
    'https://new.example/permit.pdf',
  ]);
  assert.deepStrictEqual(permitSubmission.permit_license_keys, [
    'new/permit.pdf',
  ]);

  const menuSubmission = applyAdminSubmissionAttachmentReplacement(
    {},
    { attachment_type: 'APPLICATION_MENU_PDF' },
    {
      file_url: 'https://new.example/menu.pdf',
      file_key: 'new/menu.pdf',
    }
  );
  assert.strictEqual(menuSubmission.menu_pdf_url, 'https://new.example/menu.pdf');
  assert.strictEqual(menuSubmission.menu_pdf_key, 'new/menu.pdf');

  const marketplacePhotoSubmission = {
    photos: [{
      photo_id: 'photo-1',
      file_url: 'https://old.example/photo.jpg',
      file_key: 'old/photo.jpg',
      category: 'MERCHANDISE',
    }],
  };
  assert.deepStrictEqual(
    buildMarketplaceApplicationPhotoAttachments(marketplacePhotoSubmission),
    [{
      attachment_id: 'photo-1',
      attachment_type: 'APPLICATION_IMAGE',
      source: 'APPLICATION_SNAPSHOT',
      original_name: 'Application photo',
      file_url: 'https://old.example/photo.jpg',
      file_key: 'old/photo.jpg',
      mime_type: null,
      requirement_label: 'MERCHANDISE',
      status: 'ACTIVE',
    }]
  );
  assert.strictEqual(applyMarketplaceApplicationPhotoReplacement(
    marketplacePhotoSubmission,
    'photo-1',
    {
      file_url: 'https://new.example/photo.jpg',
      file_key: 'new/photo.jpg',
      original_name: 'new-photo.jpg',
      mime_type: 'image/jpeg',
    }
  ), true);
  assert.strictEqual(
    marketplacePhotoSubmission.photos[0].file_url,
    'https://new.example/photo.jpg'
  );
};

run();
console.log('marketplace admin submission helper tests passed');
