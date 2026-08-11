const assert = require('assert');
const {
  getEventVendorLifecycle,
  validateRepositoryCapacity,
  buildPhotoSlotReservation,
  isApplicationPhotoSelectionValid,
  buildAdminProfileQuery,
  getNextSubmissionCount,
  validateReviewDecision,
  usesMarketplaceVendorApproval,
  canDeleteReplacedRepositoryObject,
  hasMaterialProfileChange,
  validateApplicationPhotoUpload,
  applyMaterialMutation,
  applyProfileUserTransaction,
  isSelectedMerchandiseCategory,
  validateMerchandisePortfolio,
} = require('./event-vendor-profile-lifecycle');

assert.deepStrictEqual(getEventVendorLifecycle(null), {
  reviewStatus: 'DRAFT',
  canEdit: true,
  canSubmit: true,
  canAccessMarketplace: false,
});
assert.equal(getEventVendorLifecycle({ review_status: 'PENDING_REVIEW' }).canEdit, false);
assert.equal(getEventVendorLifecycle({ review_status: 'APPROVED' }).canAccessMarketplace, true);
assert.equal(getEventVendorLifecycle({ review_status: 'REJECTED' }).canSubmit, true);
assert.equal(validateRepositoryCapacity({ category: 'ARTISANS_CRAFTERS', categoryCount: 9, totalCount: 39 }), 'AVAILABLE');
assert.equal(validateRepositoryCapacity({ category: 'ARTISANS_CRAFTERS', categoryCount: 10, totalCount: 39 }), 'CATEGORY_FULL');
assert.equal(validateRepositoryCapacity({ category: 'ARTISANS_CRAFTERS', categoryCount: 9, totalCount: 40 }), 'REPOSITORY_FULL');
assert.equal(validateRepositoryCapacity({ category: 'ARTISANS_CRAFTERS', categoryCount: 10, totalCount: 40, replacing: true }), 'AVAILABLE');
assert.equal(validateRepositoryCapacity({ category: 'SERVICE', categoryCount: 0, totalCount: 0 }), 'INVALID_CATEGORY');
const activePhoto = (category) => ({ category, source: 'REPOSITORY', status: 'ACTIVE' });
assert.equal(validateMerchandisePortfolio({
  selectedCategories: ['ARTISANS_CRAFTERS'],
  photos: [activePhoto('ARTISANS_CRAFTERS'), activePhoto('ARTISANS_CRAFTERS'), activePhoto('ARTISANS_CRAFTERS')],
}), 'VALID', 'three photos may be in one selected category');
assert.equal(validateMerchandisePortfolio({
  selectedCategories: ['ARTISANS_CRAFTERS', 'APPAREL_ACCESSORIES'],
  photos: [activePhoto('ARTISANS_CRAFTERS'), activePhoto('ARTISANS_CRAFTERS'), activePhoto('ARTISANS_CRAFTERS')],
}), 'VALID', 'a second selected category may contain zero photos');
assert.equal(validateMerchandisePortfolio({
  selectedCategories: ['ARTISANS_CRAFTERS', 'APPAREL_ACCESSORIES'],
  photos: [activePhoto('ARTISANS_CRAFTERS'), activePhoto('APPAREL_ACCESSORIES'), activePhoto('APPAREL_ACCESSORIES')],
}), 'VALID', 'three photos may be distributed across selected categories');
assert.equal(validateMerchandisePortfolio({
  selectedCategories: ['ARTISANS_CRAFTERS'],
  photos: [activePhoto('ARTISANS_CRAFTERS'), activePhoto('ARTISANS_CRAFTERS')],
}), 'THREE_PHOTOS_REQUIRED');
assert.equal(validateMerchandisePortfolio({
  selectedCategories: ['ARTISANS_CRAFTERS'],
  photos: [activePhoto('ARTISANS_CRAFTERS'), activePhoto('ARTISANS_CRAFTERS'), activePhoto('APPAREL_ACCESSORIES')],
}), 'THREE_PHOTOS_REQUIRED', 'unselected-category photos do not count');
assert.equal(isSelectedMerchandiseCategory(['ARTISANS_CRAFTERS'], 'APPAREL_ACCESSORIES'), false);
assert.equal(isSelectedMerchandiseCategory(['ARTISANS_CRAFTERS'], 'ARTISANS_CRAFTERS'), true);
const reservation = buildPhotoSlotReservation('profile-1', 'ARTISANS_CRAFTERS');
assert.equal(reservation.query.$and[0].$or[0].repository_photo_total.$lt, 40);
assert.equal(reservation.query.$and[1].$or[0]['repository_photo_counts.ARTISANS_CRAFTERS'].$lt, 10);
assert.equal(reservation.update.$inc.repository_photo_total, 1);
assert.equal(isApplicationPhotoSelectionValid(new Array(5).fill({})), true);
assert.equal(isApplicationPhotoSelectionValid(new Array(6).fill({})), false);
assert.deepStrictEqual(buildAdminProfileQuery('PENDING_REVIEW'), {
  status: 'ACTIVE',
  review_status: 'PENDING_REVIEW',
});
assert.equal(Object.hasOwn(buildAdminProfileQuery('PENDING_REVIEW'), 'foodTruck'), false);
assert.equal(validateReviewDecision({ currentStatus: 'DRAFT', nextStatus: 'APPROVED' }), 'NOT_PENDING');
assert.equal(validateReviewDecision({ currentStatus: 'PENDING_REVIEW', nextStatus: 'REJECTED' }), 'REASON_REQUIRED');
assert.equal(validateReviewDecision({ currentStatus: 'PENDING_REVIEW', nextStatus: 'REJECTED', rejectionReason: 'Add clearer photos' }), 'VALID');
assert.equal(validateReviewDecision({ currentStatus: 'PENDING_REVIEW', nextStatus: 'APPROVED' }), 'VALID');
assert.equal(getNextSubmissionCount(0), 1);
assert.equal(getNextSubmissionCount(1), 2, 'a rejected profile returns to the queue as a resubmission');
assert.equal(usesMarketplaceVendorApproval('EVENT_VENDOR'), true);
assert.equal(usesMarketplaceVendorApproval('FOOD_VENDOR'), false, 'food-vendor approval remains separate');
assert.equal(canDeleteReplacedRepositoryObject(true), false, 'submitted application snapshots preserve their original object');
assert.equal(canDeleteReplacedRepositoryObject(false), true);
const approvedProfile = {
  review_status: 'APPROVED',
  business_name: 'Maker Shop',
  business_description: 'Handmade goods',
  vendor_types: ['MERCHANDISE'],
  merchandise_categories: ['ARTISANS_CRAFTERS'],
  social_links: ['https://example.com'],
};
assert.equal(hasMaterialProfileChange(approvedProfile, { ...approvedProfile }), false);
assert.equal(
  hasMaterialProfileChange(approvedProfile, {
    ...approvedProfile,
    social_links: ['example.com'],
  }),
  false,
  'a historical protocol-less link is equivalent to its normalized HTTPS form',
);
assert.equal(
  hasMaterialProfileChange(approvedProfile, {
    ...approvedProfile,
    social_links: ['instagram.com/maker-shop'],
  }),
  true,
  'changing to a different social account remains a material approved-profile change',
);
assert.equal(hasMaterialProfileChange(approvedProfile, { ...approvedProfile, business_description: 'Changed' }), true);
assert.equal(hasMaterialProfileChange(approvedProfile, { ...approvedProfile, merchandise_categories: ['APPAREL_ACCESSORIES'] }), true);
const approvedMerchandiseProfile = {
  review_status: 'APPROVED',
  vendor_types: ['MERCHANDISE'],
  merchandise_categories: ['ARTISANS_CRAFTERS'],
};
const openMerchandiseEvent = {
  status: 'OPEN',
  event_close_date: new Date(Date.now() + 60000),
  event_vendor_needs: [{ vendor_type: 'MERCHANDISE', quantity: 1 }],
};
assert.equal(validateApplicationPhotoUpload({ profile: approvedMerchandiseProfile, event: openMerchandiseEvent }), 'CATEGORY_REQUIRED');
assert.equal(validateApplicationPhotoUpload({ profile: approvedMerchandiseProfile, event: openMerchandiseEvent, category: 'ARTISANS_CRAFTERS' }), 'ELIGIBLE');
assert.equal(validateApplicationPhotoUpload({ profile: { ...approvedMerchandiseProfile, review_status: 'DRAFT' }, event: openMerchandiseEvent, category: 'ARTISANS_CRAFTERS' }), 'PROFILE_NOT_APPROVED');
assert.equal(validateApplicationPhotoUpload({ profile: approvedMerchandiseProfile, event: { ...openMerchandiseEvent, status: 'CLOSED' }, category: 'ARTISANS_CRAFTERS' }), 'EVENT_CLOSED');

const verifyAtomicOrdering = async () => {
  let suspended = false;
  await assert.rejects(
    applyMaterialMutation({
      mutate: async () => { throw new Error('photo create failed'); },
      suspend: async () => { suspended = true; return true; },
    }),
    /photo create failed/
  );
  assert.equal(suspended, false, 'a failed content mutation must not suspend an approved profile');
  const successful = await applyMaterialMutation({
    mutate: async () => ({ photo_id: 'photo-1' }),
    suspend: async () => true,
  });
  assert.equal(successful.requiresReapproval, true);

  const makeStore = () => ({ profile: 'APPROVED', user: 'APPROVED' });
  const transactional = (store) => async (work) => {
    const staged = { ...store };
    const result = await work(staged);
    Object.assign(store, staged);
    return result;
  };
  const materialStore = makeStore();
  await applyProfileUserTransaction({
    transact: transactional(materialStore),
    updateProfile: async (staged) => { staged.profile = 'DRAFT'; return { review_status: 'DRAFT' }; },
    updateUser: async (staged) => { staged.user = 'PENDING'; },
  });
  assert.deepStrictEqual(materialStore, { profile: 'DRAFT', user: 'PENDING' }, 'material edit atomically suspends access');

  const userFailureStore = makeStore();
  await assert.rejects(applyProfileUserTransaction({
    transact: transactional(userFailureStore),
    updateProfile: async (staged) => { staged.profile = 'DRAFT'; return {}; },
    updateUser: async () => { throw new Error('user update failed'); },
  }), /user update failed/);
  assert.deepStrictEqual(userFailureStore, makeStore(), 'failed user update rolls back profile');

  const profileFailureStore = makeStore();
  let userUpdated = false;
  await assert.rejects(applyProfileUserTransaction({
    transact: transactional(profileFailureStore),
    updateProfile: async () => { throw new Error('profile update failed'); },
    updateUser: async () => { userUpdated = true; },
  }), /profile update failed/);
  assert.equal(userUpdated, false);
  assert.deepStrictEqual(profileFailureStore, makeStore(), 'failed profile update leaves user unchanged');

  const submissionStore = { profile: 'DRAFT', user: 'DRAFT' };
  await applyProfileUserTransaction({
    transact: transactional(submissionStore),
    updateProfile: async (staged) => { staged.profile = 'PENDING_REVIEW'; return {}; },
    updateUser: async (staged) => { staged.user = 'PENDING'; },
  });
  assert.deepStrictEqual(submissionStore, { profile: 'PENDING_REVIEW', user: 'PENDING' });

  const nonMaterialStore = makeStore();
  await applyProfileUserTransaction({
    transact: transactional(nonMaterialStore),
    updateProfile: async () => ({ review_status: 'APPROVED' }),
    updateUser: async () => {},
  });
  assert.deepStrictEqual(nonMaterialStore, makeStore(), 'non-material edit remains approved');
};

verifyAtomicOrdering().then(() => console.log('Marketplace Vendor backend lifecycle tests passed'));
