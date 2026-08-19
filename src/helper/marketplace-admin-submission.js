const SUBMISSION_TYPES = {
  FOOD_BID: {
    idField: 'bid_id',
    statusField: 'bid_status',
    editableFields: [
      'price_per_guest',
      'average_price_per_meal',
      'full_bid_amount',
      'guest_coverage',
      'regular_guest_amount',
      'vip_catering_amount',
      'menu_description',
      'notes',
      'insurance_confirmed',
      'permits_confirmed',
      'liquor_license_confirmed',
    ],
    lockedAfterAwardFields: [
      'price_per_guest',
      'average_price_per_meal',
      'full_bid_amount',
      'guest_coverage',
      'regular_guest_amount',
      'vip_catering_amount',
    ],
  },
  FOOD_APPLICATION: {
    idField: 'application_id',
    statusField: 'application_status',
    editableFields: [
      'business_name',
      'contact_name',
      'phone',
      'email',
      'food_type_cuisine',
      'menu_description',
      'notes',
      'insurance_confirmed',
      'permits_confirmed',
      'liquor_license_confirmed',
    ],
    lockedAfterAwardFields: [],
  },
  MARKETPLACE_APPLICATION: {
    idField: 'application_id',
    statusField: 'status',
    editableFields: [
      'vendor_types',
      'business_name',
      'contact_name',
      'contact_number',
      'offering_bullets',
      'average_price',
      'additional_notes',
      'electricity_required',
    ],
    lockedAfterAwardFields: [
      'vendor_types',
      'average_price',
      'electricity_required',
    ],
  },
};

const LOCKED_STATUSES = new Set([
  'AWARDED',
  'ACCEPTED',
  'PAYMENT_DUE',
  'PAID',
  'CONFIRMED',
]);

const getSubmissionConfig = (value) => {
  const type = String(value || '').trim().toUpperCase();
  return { type, config: SUBMISSION_TYPES[type] || null };
};

const pickEditableSubmissionFields = (type, payload = {}) => {
  const { config } = getSubmissionConfig(type);
  if (!config) return {};
  return config.editableFields.reduce((updates, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = payload[field];
    }
    return updates;
  }, {});
};

const getSubmissionStatus = (type, submission) => {
  const { config } = getSubmissionConfig(type);
  return config && submission ? submission[config.statusField] : null;
};

const getSubmissionId = (type, submission) => {
  const { config } = getSubmissionConfig(type);
  return config && submission ? submission[config.idField] : null;
};

const buildSubmissionSummary = (type, submission) => ({
  submission_type: type,
  submission_id: getSubmissionId(type, submission),
  status: getSubmissionStatus(type, submission),
  business_name:
    submission.business_name || submission.food_truck_id?.name || null,
  vendor_types: submission.vendor_types || [],
  vendor_user_id: submission.vendor_user_id || null,
  food_truck_id: submission.food_truck_id || null,
  event_vendor_profile_id: submission.profile_id || null,
  created_at: submission.created_at || null,
  updated_at: submission.updated_at || null,
});

const isSubmissionLifecycleLocked = (type, submission) =>
  LOCKED_STATUSES.has(getSubmissionStatus(type, submission));

const getLockedSubmissionFields = (type, submission) => {
  const { config } = getSubmissionConfig(type);
  if (!config || !isSubmissionLifecycleLocked(type, submission)) return [];
  return config.lockedAfterAwardFields || [];
};

const validateAdminSubmissionPublish = ({ type, current = {}, updates = {} }) =>
  getLockedSubmissionFields(type, current)
    .filter((field) => Object.prototype.hasOwnProperty.call(updates, field))
    .filter((field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(updates[field] ?? null))
    .map((field) => ({
      field,
      message: `${field.replace(/_/g, ' ')} cannot change after the submission is awarded. Revoke the award first.`,
    }));

const ADMIN_REPLACEABLE_ATTACHMENT_TYPES = new Set([
  'BID_MENU_PDF',
  'BID_IMAGE',
  'APPLICATION_MENU_PDF',
  'APPLICATION_IMAGE',
  'PERMIT_LICENSE',
  'REQUIREMENT_DOCUMENT',
]);

const isAdminSubmissionAttachmentReplaceable = (attachment = {}) =>
  attachment.status !== 'DELETED' &&
  ADMIN_REPLACEABLE_ATTACHMENT_TYPES.has(attachment.attachment_type);

const replaceArrayValue = (values, previousValue, nextValue) => {
  const result = Array.isArray(values) ? [...values] : [];
  const index = result.indexOf(previousValue);
  if (index >= 0) result[index] = nextValue;
  else result.push(nextValue);
  return result;
};

const applyAdminSubmissionAttachmentReplacement = (
  submission,
  previousAttachment,
  replacement
) => {
  const type = previousAttachment.attachment_type;
  if (type === 'BID_MENU_PDF' || type === 'APPLICATION_MENU_PDF') {
    submission.menu_pdf_url = replacement.file_url;
    submission.menu_pdf_key = replacement.file_key;
  } else if (type === 'BID_IMAGE' || type === 'APPLICATION_IMAGE') {
    submission.image_urls = replaceArrayValue(
      submission.image_urls,
      previousAttachment.file_url,
      replacement.file_url
    );
    submission.image_keys = replaceArrayValue(
      submission.image_keys,
      previousAttachment.file_key,
      replacement.file_key
    );
  } else if (type === 'PERMIT_LICENSE' || type === 'REQUIREMENT_DOCUMENT') {
    submission.permit_license_urls = replaceArrayValue(
      submission.permit_license_urls,
      previousAttachment.file_url,
      replacement.file_url
    );
    submission.permit_license_keys = replaceArrayValue(
      submission.permit_license_keys,
      previousAttachment.file_key,
      replacement.file_key
    );
  }
  return submission;
};

const buildMarketplaceApplicationPhotoAttachments = (submission = {}) =>
  (Array.isArray(submission.photos) ? submission.photos : [])
    .filter((photo) => photo && photo.photo_id && photo.file_url)
    .map((photo) => ({
      attachment_id: photo.photo_id,
      attachment_type: 'APPLICATION_IMAGE',
      source: 'APPLICATION_SNAPSHOT',
      original_name: photo.original_name || 'Application photo',
      file_url: photo.file_url,
      file_key: photo.file_key || null,
      mime_type: photo.mime_type || null,
      requirement_label: photo.category || null,
      status: 'ACTIVE',
    }));

const applyMarketplaceApplicationPhotoReplacement = (
  submission,
  photoId,
  replacement
) => {
  const photos = Array.isArray(submission.photos) ? [...submission.photos] : [];
  const index = photos.findIndex((photo) => String(photo?.photo_id) === String(photoId));
  if (index < 0) return false;
  photos[index] = {
    ...photos[index],
    file_url: replacement.file_url,
    file_key: replacement.file_key,
    original_name: replacement.original_name,
    mime_type: replacement.mime_type,
  };
  submission.photos = photos;
  return true;
};

const getSubmissionAdministrativeState = (submission = {}) => {
  if (submission.deleted_at) return 'DELETED';
  if (submission.archived_at) return 'ARCHIVED';
  return null;
};

const isSubmissionActionAlreadyApplied = (action, type, submission = {}) => {
  const normalizedAction = String(action || '').trim().toUpperCase();
  if (normalizedAction === 'DELETE') return Boolean(submission.deleted_at);
  if (normalizedAction === 'ARCHIVE') return Boolean(submission.archived_at);
  if (normalizedAction === 'WITHDRAW') {
    return getSubmissionStatus(type, submission) === 'WITHDRAWN';
  }
  if (normalizedAction === 'REVOKE') {
    return getSubmissionStatus(type, submission) === 'REVOKED';
  }
  return false;
};

module.exports = {
  ADMIN_REPLACEABLE_ATTACHMENT_TYPES,
  SUBMISSION_TYPES,
  buildSubmissionSummary,
  buildMarketplaceApplicationPhotoAttachments,
  applyAdminSubmissionAttachmentReplacement,
  applyMarketplaceApplicationPhotoReplacement,
  getSubmissionConfig,
  getSubmissionId,
  getSubmissionStatus,
  getLockedSubmissionFields,
  getSubmissionAdministrativeState,
  isSubmissionLifecycleLocked,
  isSubmissionActionAlreadyApplied,
  isAdminSubmissionAttachmentReplaceable,
  pickEditableSubmissionFields,
  validateAdminSubmissionPublish,
};
