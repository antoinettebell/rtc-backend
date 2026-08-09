const REVIEW_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'];
const MERCHANDISE_CATEGORIES = [
  'ARTISANS_CRAFTERS',
  'APPAREL_ACCESSORIES',
  'COMMERCIAL_RETAIL',
  'LOCAL_MAKERS_SPECIALTY',
];

const getEventVendorLifecycle = (profile) => {
  const reviewStatus = REVIEW_STATUSES.includes(profile?.review_status)
    ? profile.review_status
    : 'DRAFT';
  return {
    reviewStatus,
    canEdit: reviewStatus !== 'PENDING_REVIEW',
    canSubmit: ['DRAFT', 'REJECTED'].includes(reviewStatus),
    canAccessMarketplace: reviewStatus === 'APPROVED',
  };
};

const validateRepositoryCapacity = ({ category, categoryCount, totalCount, replacing = false }) => {
  if (!MERCHANDISE_CATEGORIES.includes(category)) return 'INVALID_CATEGORY';
  if (replacing) return 'AVAILABLE';
  if (categoryCount >= 10) return 'CATEGORY_FULL';
  if (totalCount >= 40) return 'REPOSITORY_FULL';
  return 'AVAILABLE';
};
const buildPhotoSlotReservation = (profileId, category) => {
  if (!MERCHANDISE_CATEGORIES.includes(category)) return null;
  const categoryPath = `repository_photo_counts.${category}`;
  return {
    query: {
      profile_id: profileId,
      status: 'ACTIVE',
      $and: [
        { $or: [{ repository_photo_total: { $lt: 40 } }, { repository_photo_total: { $exists: false } }] },
        { $or: [{ [categoryPath]: { $lt: 10 } }, { [categoryPath]: { $exists: false } }] },
      ],
    },
    update: { $inc: { repository_photo_total: 1, [categoryPath]: 1 } },
  };
};

const isApplicationPhotoSelectionValid = (photos) => Array.isArray(photos) && photos.length <= 5;
const buildAdminProfileQuery = (status) => ({
  status: 'ACTIVE',
  ...(REVIEW_STATUSES.includes(status) ? { review_status: status } : {}),
});
const getNextSubmissionCount = (current) => Math.max(0, Number(current || 0)) + 1;
const validateReviewDecision = ({ currentStatus, nextStatus, rejectionReason }) => {
  if (currentStatus !== 'PENDING_REVIEW') return 'NOT_PENDING';
  if (!['APPROVED', 'REJECTED'].includes(nextStatus)) return 'INVALID_DECISION';
  if (nextStatus === 'REJECTED' && !String(rejectionReason || '').trim()) return 'REASON_REQUIRED';
  return 'VALID';
};
const usesMarketplaceVendorApproval = (vendorSubtype) => vendorSubtype === 'EVENT_VENDOR';
const canDeleteReplacedRepositoryObject = (isSnapshotted) => isSnapshotted !== true;
const sameValues = (left, right) => JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
const hasMaterialProfileChange = (current, next) =>
  current?.review_status === 'APPROVED' && (
    current.business_name !== next.business_name ||
    current.business_description !== next.business_description ||
    !sameValues(current.vendor_types, next.vendor_types) ||
    !sameValues(current.merchandise_categories, next.merchandise_categories) ||
    !sameValues(current.social_links, next.social_links)
  );
const validateApplicationPhotoUpload = ({ profile, event, category, now = new Date() }) => {
  if (!profile || profile.review_status !== 'APPROVED') return 'PROFILE_NOT_APPROVED';
  if (
    !event ||
    !['OPEN', 'REOPENED'].includes(event.status) ||
    event.vendor_applications_closed_at ||
    (event.event_close_date && new Date(event.event_close_date) <= now)
  ) return 'EVENT_CLOSED';
  const eligibleTypes = (event.event_vendor_needs || [])
    .filter((need) => Number(need.quantity || 0) > 0)
    .map((need) => need.vendor_type)
    .filter((type) => (profile.vendor_types || []).includes(type));
  if (!eligibleTypes.length) return 'VENDOR_NOT_ELIGIBLE';
  if ((profile.vendor_types || []).includes('MERCHANDISE') && !category) return 'CATEGORY_REQUIRED';
  if (category && !(profile.merchandise_categories || []).includes(category)) return 'CATEGORY_NOT_APPROVED';
  if (category && !eligibleTypes.includes('MERCHANDISE')) return 'MERCHANDISE_NOT_REQUESTED';
  return 'ELIGIBLE';
};
const applyMaterialMutation = async ({ mutate, suspend }) => {
  const value = await mutate();
  const requiresReapproval = await suspend();
  return { value, requiresReapproval };
};
const applyProfileUserTransaction = ({ transact, updateProfile, updateUser }) =>
  transact(async (session) => {
    const profile = await updateProfile(session);
    await updateUser(session, profile);
    return profile;
  });

module.exports = {
  REVIEW_STATUSES,
  MERCHANDISE_CATEGORIES,
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
};
