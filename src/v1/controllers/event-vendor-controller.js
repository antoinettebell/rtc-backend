const fs = require('fs');
const mongoose = require('mongoose');
const {
  EventVendorProfileModel,
  EventVendorPhotoModel,
  EventVendorApplicationModel,
  MarketplaceEventModel,
  UserModel,
  MarketplacePaymentModel,
  MarketplaceVendorAgreementModel,
  MarketplaceAttachmentModel,
  MarketplaceAgreementAuditModel,
  MarketplaceEventImageModel,
  MarketplaceEventQuestionModel,
  MarketplaceGeneralPurchaseModel,
  TapToPayTerminalModel,
} = require('../../models');
const { addObjectWithKey } = require('../../helper/aws');
const { docusign } = require('../../config');
const CyberSourceRefundHelper = require('../../helper/cybersource-refund-helper');
const CyberSourcePaymentHelper = require('../../helper/cybersource-payment-helper');
const CyberSourceActivationCodeHelper = require('../../helper/cybersource-activation-code-helper');
const SmsHelper = require('../../helper/sms-helper');
const MarketplaceCommunications = require('../../helper/marketplace-communications-helper');
const {
  findOrCreateEventVendorApplication,
} = require('../../helper/event-vendor-application-idempotency');
const {
  MERCHANDISE_CATEGORIES,
  buildPhotoSlotReservation,
  buildAdminProfileQuery,
  getNextSubmissionCount,
  validateReviewDecision,
  validateApplicationPhotoUpload,
  hasMaterialProfileChange,
  applyMaterialMutation,
  applyProfileUserTransaction,
  isSelectedMerchandiseCategory,
} = require('../../helper/event-vendor-profile-lifecycle');
const { reconcileRepositoryPhotoCounters } = require('../../helper/event-vendor-photo-counter');
const { enqueueObjectCleanup } = require('../../helper/event-vendor-photo-cleanup');
const {
  buildSignedAgreementAttachmentLink,
} = require('../../helper/marketplace-agreement-vendor-context');
const {
  sanitizeMarketplaceContactForCoordinator,
} = require('../../helper/marketplace-vendor-contact-helper');
const {
  hideMarketplaceAgreementFromCoordinator,
} = require('../../helper/marketplace-coordinator-agreement-privacy');
const {
  ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES,
  isEventVendorApplicationEditable,
  isEventVendorApplicationWithdrawable,
  isEventOpenForOrdinaryWithdrawal,
  resolveSelectedApplicationPhotos,
  getCoordinatorNotSelectTransition,
} = require('../../helper/marketplace-submission-lifecycle');
const { resolveEventVendorParticipationPath } = require('../../helper/event-vendor-participation-helper');
const { normalizeExternalWebLink, normalizeExternalWebLinks } = require('../../helper/external-web-link');
const {
  hasMarketplaceVendorAwardCapacity,
  hasMarketplaceVendorCapacityForRequestedTypes,
} = require('../../helper/marketplace-event-visibility-helper');
const {
  getMarketplaceAwardRevocationDecision,
  getMarketplaceAwardRevocationError,
} = require('../../helper/marketplace-award-revocation');
const {
  refundPaidMarketplaceVendorFee,
} = require('../../helper/marketplace-vendor-fee-refund');
const {
  getMarketplaceVendorApplicationCheckoutFeeAmount,
} = require('../../helper/marketplace-regression-test-fees');
const {
  getUnlockedMarketplaceCoordinatorContact,
} = require('../../helper/marketplace-coordinator-contact');
const {
  applyMarketplaceEventLocationPrivacy,
} = require('../../helper/marketplace-event-location-privacy');
const {
  isEventVendorApplicationUnlocked,
} = require('../../helper/marketplace-vendor-access-policy');
const {
  buildGeneralPurchaseTotals,
  buildGeneralPurchaseRefundRequest,
} = require('../../helper/marketplace-general-purchase-helper');

const TYPES = ['MERCHANDISE', 'SERVICE', 'OTHER'];
const EVENT_VENDOR_PUBLIC_EVENT_FIELDS = [
  'event_id', 'event_name', 'event_description', 'event_type', 'status',
  'event_date', 'event_start_date', 'event_end_date', 'event_start_time',
  'event_end_time', 'event_time', 'event_close_time', 'event_timezone',
  'event_address', 'formatted_address', 'geocoded_address', 'event_city', 'event_state', 'event_zip',
  'expected_ga_guests', 'expected_vip_guests', 'expected_guest_count',
  'number_of_guests', 'vip_guest_count', 'payment_responsibility', 'who_pays',
  'last_date_to_accept_payments', 'vendor_payment_deadline',
  'vendor_fee_payment_deadline', 'event_vendor_needs',
  'event_vendor_electricity_fee', 'vendor_applications_closed_at', 'event_close_date',
];
const sanitizeEventVendorEvent = (event) => Object.fromEntries(
  EVENT_VENDOR_PUBLIC_EVENT_FIELDS
    .filter((field) => event?.[field] !== undefined)
    .map((field) => [field, event[field]])
);
const error = (message, code = 400) => Object.assign(new Error(message), { code });
const getEventVendorDisplayId = (profileId) => {
  const suffix = String(profileId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `Vendor RTC - ${suffix || 'MASKED'}`;
};
const cleanTypes = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim().toUpperCase()))]
  .filter((item) => TYPES.includes(item));
const cleanCategories = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).toUpperCase()))]
  .filter((item) => MERCHANDISE_CATEGORIES.includes(item));
const assertEventVendor = async (userId) => {
  const user = await UserModel.findById(userId);
  if (!user || user.userType !== 'VENDOR') throw error('Vendor account required', 403);
  if (user.vendorSubtype !== 'EVENT_VENDOR') throw error('Marketplace Vendor account required', 403);
  return user;
};

const assertApprovedProfile = async (userId) => {
  const profile = await EventVendorProfileModel.findOne({
    vendor_user_id: userId,
    status: 'ACTIVE',
  });
  if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
  if (profile.review_status !== 'APPROVED') {
    throw error('Your Marketplace Vendor profile must be approved first', 403);
  }
  return profile;
};

const sanitizePhone = (value) => {
  const phone = String(value || '').replace(/\D/g, '');
  return phone ? phone.slice(0, 15) : null;
};

const generalPurchaseReceiptBody = ({ purchase, profile }) =>
  [
    `RDC receipt: Tap to Pay approved for General Purchase from ${String(profile.business_name || 'Marketplace Vendor').slice(0, 60)}.`,
    `Subtotal $${Number(purchase.subtotal).toFixed(2)},`,
    `tax $${Number(purchase.tax_amount).toFixed(2)},`,
    `total $${Number(purchase.total).toFixed(2)}.`,
    'Reply STOP to opt out.',
  ].join(' ');

const validateProfileForSubmission = async (profile) => {
  if (!profile?.business_name || !profile?.business_description || !profile?.vendor_types?.length) {
    throw error('Complete the Marketplace Vendor profile before submitting', 409);
  }
  if (!profile.logo_url) throw error('Add a business logo before submitting', 409);
  if (profile.vendor_types.includes('MERCHANDISE')) {
    if (!profile.merchandise_categories?.length) {
      throw error('Select at least one merchandise category', 409);
    }
    const photoCount = await EventVendorPhotoModel.countDocuments({
      vendor_user_id: profile.vendor_user_id,
      source: 'REPOSITORY',
      status: 'ACTIVE',
      category: { $in: profile.merchandise_categories },
    });
    if (photoCount < 3) throw error('Add at least 3 portfolio photos in your selected merchandise categories', 409);
  }
};

const assertProfileEditable = (profile) => {
  if (profile?.review_status === 'PENDING_REVIEW') {
    throw error('This profile is awaiting review and cannot be changed', 409);
  }
};

const reserveRepositoryPhotoSlot = async (profileId, category, session = null) => {
  const reservation = buildPhotoSlotReservation(profileId, category);
  if (!reservation) throw error('Select a valid merchandise category');
  const profile = await EventVendorProfileModel.findOneAndUpdate(
    reservation.query,
    reservation.update,
    { new: true, session }
  );
  if (!profile) throw error('This merchandise category or repository is full', 409);
  return profile;
};

const releaseRepositoryPhotoSlot = async (profileId, category, session = null) => {
  if (!MERCHANDISE_CATEGORIES.includes(category)) return;
  const categoryPath = `repository_photo_counts.${category}`;
  await EventVendorProfileModel.updateOne(
    { profile_id: profileId, repository_photo_total: { $gt: 0 }, [categoryPath]: { $gt: 0 } },
    { $inc: { repository_photo_total: -1, [categoryPath]: -1 } },
    { session }
  );
};

const suspendApprovedProfileInSession = async (profileId, userId, session) => {
  const result = await EventVendorProfileModel.updateOne(
    { profile_id: profileId, review_status: 'APPROVED' },
    { $set: { review_status: 'DRAFT', rejection_reason: null } },
    { session }
  );
  if (!result.modifiedCount) return false;
  await UserModel.updateOne(
    { _id: userId, vendorSubtype: 'EVENT_VENDOR' },
    { $set: { requestStatus: 'PENDING', reasonForRejection: null } },
    { session }
  );
  return true;
};

const withTransaction = async (work) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
};

const queueObjectCleanupNonfatal = async (payload) => {
  try {
    await enqueueObjectCleanup(payload);
  } catch (cleanupError) {
    console.error('Marketplace Vendor object cleanup could not be queued', {
      objectKey: payload.objectKey,
      reason: payload.reason,
      message: cleanupError.message,
    });
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const profile = await EventVendorProfileModel.findOne({ vendor_user_id: req.user._id }).lean();
    return res.data({ eventVendorProfile: profile }, 'Marketplace Vendor profile');
  } catch (e) { return next(e); }
};

exports.saveProfile = async (req, res, next) => {
  try {
    const user = await assertEventVendor(req.user._id);
    const vendorTypes = cleanTypes(req.body.vendor_types);
    if (!vendorTypes.length) throw error('Select Merchandise, Service, or Other');
    const businessName = String(req.body.business_name || '').trim();
    const description = String(req.body.business_description || '').trim();
    if (!businessName) throw error('Business name is required');
    if (!description || description.length > 300) throw error('Business description must be 1–300 characters');
    const submittedSocialLinks = (req.body.social_links || [])
      .map((item) => String(item).trim())
      .filter(Boolean);
    const invalidSocialLink = submittedSocialLinks.some((link) => !normalizeExternalWebLink(link));
    if (invalidSocialLink) {
      throw error('Website/social links must be valid web addresses');
    }
    const socialLinks = normalizeExternalWebLinks(submittedSocialLinks);
    if (socialLinks.length > 2) throw error('Up to 2 website/social links are allowed');
    const merchandiseCategories = cleanCategories(req.body.merchandise_categories);
    if (vendorTypes.includes('MERCHANDISE') && !merchandiseCategories.length) {
      throw error('Select at least one merchandise category');
    }
    const profile = await applyProfileUserTransaction({
      transact: withTransaction,
      updateProfile: async (session) => {
        const existing = await EventVendorProfileModel.findOne({ vendor_user_id: user._id }).session(session);
        if (existing?.review_status === 'PENDING_REVIEW') {
          throw error('This profile is awaiting review and cannot be edited', 409);
        }
        const materialChange = hasMaterialProfileChange(existing, {
          business_name: businessName,
          business_description: description,
          vendor_types: vendorTypes,
          merchandise_categories: merchandiseCategories,
          social_links: socialLinks,
        });
        const reviewStatus = materialChange ? 'DRAFT' : existing?.review_status === 'APPROVED' ? 'APPROVED' : 'DRAFT';
        const updated = await EventVendorProfileModel.findOneAndUpdate(
          { vendor_user_id: user._id },
          { $set: {
            vendor_types: vendorTypes,
            merchandise_categories: merchandiseCategories,
            business_name: businessName,
            business_description: description,
            social_links: socialLinks,
            status: 'ACTIVE',
            review_status: reviewStatus,
            ...(reviewStatus === 'DRAFT' ? { rejection_reason: existing?.rejection_reason || null } : {}),
          } },
          { new: true, upsert: true, runValidators: true, session }
        );
        updated.$locals.materialChange = materialChange;
        return updated;
      },
      updateUser: async (session, updated) => {
        const userUpdate = { vendorSubtype: 'EVENT_VENDOR' };
        if (updated.$locals.materialChange) {
          userUpdate.requestStatus = 'PENDING';
          userUpdate.reasonForRejection = null;
        }
        const result = await UserModel.updateOne({ _id: user._id }, { $set: userUpdate }, { session });
        if (!result.matchedCount) throw error('Vendor account not found', 404);
      },
    });
    return res.data({ eventVendorProfile: profile }, 'Marketplace Vendor profile saved');
  } catch (e) { return next(e); }
};

exports.submitProfile = async (req, res, next) => {
  try {
    const user = await assertEventVendor(req.user._id);
    const profile = await EventVendorProfileModel.findOne({ vendor_user_id: user._id, status: 'ACTIVE' });
    if (!profile) throw error('Save the Marketplace Vendor profile before submitting', 409);
    if (profile.review_status === 'APPROVED') {
      return res.data({ eventVendorProfile: profile }, 'Marketplace Vendor profile is already approved');
    }
    await validateProfileForSubmission(profile);
    const submittedProfile = await applyProfileUserTransaction({
      transact: withTransaction,
      updateProfile: async (session) => {
        const current = await EventVendorProfileModel.findOne({
          vendor_user_id: user._id,
          status: 'ACTIVE',
          review_status: { $in: ['DRAFT', 'REJECTED'] },
        }).session(session);
        if (!current) throw error('Profile state changed before submission; refresh and try again', 409);
        const now = new Date();
        current.review_status = 'PENDING_REVIEW';
        current.submitted_at = now;
        current.submission_count = getNextSubmissionCount(current.submission_count);
        current.reviewed_at = null;
        current.reviewed_by = null;
        current.review_history.push({ status: 'PENDING_REVIEW', changed_at: now });
        return current.save({ session });
      },
      updateUser: async (session) => {
        const result = await UserModel.updateOne(
          { _id: user._id },
          { $set: { requestStatus: 'PENDING', reasonForRejection: null } },
          { session }
        );
        if (!result.matchedCount) throw error('Vendor account not found', 404);
      },
    });
    return res.data({ eventVendorProfile: submittedProfile }, 'Marketplace Vendor profile submitted for review');
  } catch (e) { return next(e); }
};

exports.uploadPhoto = async (req, res, next) => {
  let uploadedKey = null;
  let profile = null;
  let category = null;
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) throw error('A JPG, PNG, or HEIC photo is required');
    profile = await EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' });
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    assertProfileEditable(profile);
    category = String(req.body.category || '').toUpperCase();
    if (!MERCHANDISE_CATEGORIES.includes(category)) throw error('Select a valid merchandise category');
    if (!isSelectedMerchandiseCategory(profile.merchandise_categories || [], category)) {
      throw error('Select this merchandise category in your profile before adding photos', 403);
    }
    await reconcileRepositoryPhotoCounters(profile.profile_id);
    const { url, key } = await addObjectWithKey(req.file, 'marketplace/event-vendors/photos');
    uploadedKey = key;
    fs.unlink(req.file.path, () => {});
    const mutation = await withTransaction((session) => applyMaterialMutation({
      mutate: async () => {
        await reserveRepositoryPhotoSlot(profile.profile_id, category, session);
        const [created] = await EventVendorPhotoModel.create([{
          profile_id: profile.profile_id, vendor_user_id: req.user._id,
          file_url: url, file_key: key, original_name: req.file.originalname, mime_type: req.file.mimetype,
          category, source: 'REPOSITORY',
        }], { session });
        return created;
      },
      suspend: async () => false,
    }));
    const photo = mutation.value;
    const requiresReapproval = mutation.requiresReapproval;
    uploadedKey = null;
    return res.data({ photo, requires_reapproval: requiresReapproval }, 'Marketplace Vendor photo uploaded');
  } catch (e) {
    if (uploadedKey) await queueObjectCleanupNonfatal({ objectKey: uploadedKey, reason: 'FAILED_REPOSITORY_PHOTO_CREATE', protectSnapshots: false });
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(e);
  }
};

exports.replacePhoto = async (req, res, next) => {
  let uploadedKey = null;
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) throw error('A JPG, PNG, or HEIC photo is required');
    const [profile, existingPhoto] = await Promise.all([
      EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' }),
      EventVendorPhotoModel.findOne({
        photo_id: req.params.photoId,
        vendor_user_id: req.user._id,
        source: 'REPOSITORY',
        status: 'ACTIVE',
      }),
    ]);
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    assertProfileEditable(profile);
    if (!existingPhoto) throw error('Repository photo not found', 404);
    const previousKey = existingPhoto.file_key;
    const { url, key } = await addObjectWithKey(req.file, 'marketplace/event-vendors/photos');
    uploadedKey = key;
    const { photo, requiresReapproval } = await withTransaction(async (session) => {
      const updated = await EventVendorPhotoModel.findOneAndUpdate(
        { _id: existingPhoto._id, file_key: previousKey, status: 'ACTIVE' },
        { $set: { file_url: url, file_key: key, original_name: req.file.originalname, mime_type: req.file.mimetype } },
        { new: true, session }
      );
      if (!updated) throw error('The photo changed before replacement completed', 409);
      const suspended = false;
      if (previousKey) await enqueueObjectCleanup({ objectKey: previousKey, reason: 'REPOSITORY_PHOTO_REPLACED', session });
      return { photo: updated, requiresReapproval: suspended };
    });
    uploadedKey = null;
    fs.unlink(req.file.path, () => {});
    return res.data({ photo, requires_reapproval: requiresReapproval }, 'Marketplace Vendor photo replaced');
  } catch (e) {
    if (uploadedKey) await queueObjectCleanupNonfatal({ objectKey: uploadedKey, reason: 'FAILED_REPOSITORY_PHOTO_REPLACEMENT', protectSnapshots: false });
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(e);
  }
};

exports.uploadApplicationPhoto = async (req, res, next) => {
  let uploadedKey = null;
  let profile = null;
  let category = null;
  try {
    await assertEventVendor(req.user._id);
    if (!req.file || !req.file.mimetype?.startsWith('image/')) throw error('A JPG, PNG, or HEIC photo is required');
    const eventId = String(req.body.event_id || '').trim();
    if (!eventId) throw error('Event is required');
    category = String(req.body.category || '').toUpperCase();
    const saveToRepository = String(req.body.save_to_repository || '').toLowerCase() === 'true';
    if (category && !MERCHANDISE_CATEGORIES.includes(category)) throw error('Select a valid merchandise category');
    if (saveToRepository && !category) throw error('Select a merchandise category to save this photo');
    [profile] = await Promise.all([
      EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE', review_status: 'APPROVED' }),
    ]);
    if (!profile) throw error('An approved Marketplace Vendor profile is required', 403);
    const event = await MarketplaceEventModel.findOne({
      event_id: eventId,
      status: { $in: ['OPEN', 'REOPENED'] },
      vendor_applications_closed_at: null,
      event_close_date: { $gt: new Date() },
    }).lean();
    if (!event) throw error('This event is not accepting applications', 410);
    const eligibility = validateApplicationPhotoUpload({ profile, event, category });
    if (eligibility === 'CATEGORY_REQUIRED') throw error('A merchandise category is required for application photos', 400);
    if (eligibility === 'CATEGORY_NOT_APPROVED') throw error('This merchandise category is not part of your approved profile', 403);
    if (eligibility === 'MERCHANDISE_NOT_REQUESTED') throw error('This event is not accepting merchandise vendors', 403);
    if (eligibility === 'VENDOR_NOT_ELIGIBLE') throw error('Your Marketplace Vendor profile is not eligible for this event', 403);
    if (eligibility !== 'ELIGIBLE') throw error('This event is not accepting applications', 410);
    if (saveToRepository) {
      await reconcileRepositoryPhotoCounters(profile.profile_id);
    }
    const { url, key } = await addObjectWithKey(req.file, 'marketplace/event-vendors/application-photos');
    uploadedKey = key;
    fs.unlink(req.file.path, () => {});
    const createPhoto = async (session = null) => {
      if (saveToRepository) await reserveRepositoryPhotoSlot(profile.profile_id, category, session);
      const [created] = await EventVendorPhotoModel.create([{
        profile_id: profile.profile_id, vendor_user_id: req.user._id, file_url: url, file_key: key,
        original_name: req.file.originalname, mime_type: req.file.mimetype, category: category || null,
        source: saveToRepository ? 'REPOSITORY' : 'APPLICATION', event_id: saveToRepository ? null : eventId,
        expires_at: saveToRepository ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }], session ? { session } : undefined);
      const suspended = false;
      return { photo: created, requiresReapproval: suspended };
    };
    const { photo, requiresReapproval } = saveToRepository
      ? await withTransaction(createPhoto)
      : await createPhoto();
    uploadedKey = null;
    return res.data({ photo, requires_reapproval: requiresReapproval }, saveToRepository ? 'Photo uploaded and saved to repository' : 'Application photo uploaded');
  } catch (e) {
    if (uploadedKey) await queueObjectCleanupNonfatal({ objectKey: uploadedKey, reason: 'FAILED_APPLICATION_PHOTO_CREATE', protectSnapshots: false });
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(e);
  }
};

exports.uploadLogo = async (req, res, next) => {
  let uploadedKey = null;
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) throw error('A logo image is required');
    const profile = await EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' });
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    assertProfileEditable(profile);
    const { url, key } = await addObjectWithKey(req.file, 'marketplace/event-vendors/logos');
    uploadedKey = key;
    fs.unlink(req.file.path, () => {});
    const previousKey = profile.logo_key;
    const { eventVendorProfile, requiresReapproval } = await withTransaction(async (session) => {
      const updated = await EventVendorProfileModel.findOneAndUpdate(
        { profile_id: profile.profile_id, status: 'ACTIVE' },
        { $set: { logo_url: url, logo_key: key } },
        { new: true, session }
      );
      const suspended = await suspendApprovedProfileInSession(profile.profile_id, req.user._id, session);
      if (previousKey) await enqueueObjectCleanup({ objectKey: previousKey, reason: 'PROFILE_LOGO_REPLACED', protectSnapshots: false, session });
      return { eventVendorProfile: updated, requiresReapproval: suspended };
    });
    uploadedKey = null;
    return res.data({ eventVendorProfile, requires_reapproval: requiresReapproval }, 'Business logo uploaded');
  } catch (e) {
    if (uploadedKey) await queueObjectCleanupNonfatal({ objectKey: uploadedKey, reason: 'FAILED_PROFILE_LOGO_UPDATE', protectSnapshots: false });
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(e);
  }
};

exports.listPhotos = async (req, res, next) => {
  try {
    const eventId = String(req.query.event_id || '').trim();
    const photos = await EventVendorPhotoModel.find({
      vendor_user_id: req.user._id,
      status: 'ACTIVE',
      $or: [
        { source: 'REPOSITORY' },
        ...(eventId ? [{ source: 'APPLICATION', event_id: eventId }] : []),
      ],
    }).sort({ category: 1, created_at: -1 }).lean();
    return res.data({ photoList: photos }, 'Marketplace Vendor photos');
  } catch (e) { return next(e); }
};

exports.removePhoto = async (req, res, next) => {
  try {
    const profile = await EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' });
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    assertProfileEditable(profile);
    const existingPhoto = await EventVendorPhotoModel.findOne({
      photo_id: req.params.photoId,
      vendor_user_id: req.user._id,
      source: 'REPOSITORY',
      status: 'ACTIVE',
    });
    if (!existingPhoto) throw error('Repository photo not found', 404);
    const { photo, requiresReapproval } = await withTransaction(async (session) => {
      const archived = await EventVendorPhotoModel.findOneAndUpdate(
        { photo_id: req.params.photoId, vendor_user_id: req.user._id, status: 'ACTIVE' },
        { $set: { status: 'ARCHIVED', archived_at: new Date() } },
        { new: true, session }
      );
      if (!archived) throw error('Photo not found', 404);
      await releaseRepositoryPhotoSlot(profile.profile_id, existingPhoto.category, session);
      const suspended = false;
      if (existingPhoto.file_key) await enqueueObjectCleanup({ objectKey: existingPhoto.file_key, reason: 'REPOSITORY_PHOTO_REMOVED', session });
      return { photo: archived, requiresReapproval: suspended };
    });
    return res.data({ photo, requires_reapproval: requiresReapproval }, 'Photo removed from repository');
  } catch (e) { return next(e); }
};

exports.removeApplicationPhoto = async (req, res, next) => {
  try {
    const photo = await EventVendorPhotoModel.findOne({
      photo_id: req.params.photoId,
      vendor_user_id: req.user._id,
      source: 'APPLICATION',
      status: 'ACTIVE',
    });
    if (!photo) throw error('Application photo not found', 404);
    const submittedSnapshot = await EventVendorApplicationModel.exists({
      vendor_user_id: req.user._id,
      'photos.photo_id': photo.photo_id,
    });
    if (submittedSnapshot) throw error('Submitted application photos cannot be removed', 409);
    await withTransaction(async (session) => {
      await EventVendorPhotoModel.updateOne(
        { _id: photo._id, status: 'ACTIVE' },
        { $set: { status: 'ARCHIVED', archived_at: new Date(), expires_at: null } },
        { session }
      );
      if (photo.file_key) await enqueueObjectCleanup({ objectKey: photo.file_key, reason: 'APPLICATION_UPLOAD_REMOVED', session });
    });
    return res.data({ photo_id: photo.photo_id }, 'Application photo removed');
  } catch (e) { return next(e); }
};

exports.eligibleEvents = async (req, res, next) => {
  try {
    const profile = (await assertApprovedProfile(req.user._id)).toObject();
    const priorApplications = await EventVendorApplicationModel.find({
      vendor_user_id: req.user._id,
    }).select('event_id').lean();
    const excludedEventIds = priorApplications.map((item) => item.event_id);
    const events = await MarketplaceEventModel.find({
      event_id: { $nin: excludedEventIds },
      status: { $in: ['OPEN', 'REOPENED'] },
      vendor_applications_closed_at: null,
      event_close_date: { $gt: new Date() },
      event_vendor_needs: { $elemMatch: { vendor_type: { $in: profile.vendor_types }, quantity: { $gt: 0 } } },
    }).sort({ event_date: 1 }).lean();
    const eventVendorApplications = await EventVendorApplicationModel.find({
      event_id: { $in: events.map((event) => event.event_id) },
      status: { $in: ['AWARDED', 'PAYMENT_DUE', 'PAID'] },
    }).lean();
    const eventsWithCapacity = events.filter((event) => hasMarketplaceVendorAwardCapacity({
      event,
      profileTypes: profile.vendor_types,
      applications: eventVendorApplications.filter((application) => application.event_id === event.event_id),
    }));
    const images = await MarketplaceEventImageModel.find({
      event_id: { $in: eventsWithCapacity.map((event) => event.event_id) },
      status: 'ACTIVE',
    }).select('image_id event_id image_url original_name mime_type').lean();
    const marketplaceEventList = eventsWithCapacity.map((event) => ({
      ...applyMarketplaceEventLocationPrivacy(sanitizeEventVendorEvent(event), {
        locationUnlocked: false,
      }),
      public_images: images.filter((image) => image.event_id === event.event_id),
    }));
    return res.data({ marketplaceEventList }, 'Eligible Marketplace Vendor events');
  } catch (e) { return next(e); }
};

exports.submitApplication = async (req, res, next) => {
  try {
    const [user, profile, event] = await Promise.all([
      assertEventVendor(req.user._id),
      EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE', review_status: 'APPROVED' }).lean(),
      MarketplaceEventModel.findOne({ event_id: req.params.eventId, status: { $in: ['OPEN', 'REOPENED'] }, vendor_applications_closed_at: null }).lean(),
    ]);
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    if (!event || (event.event_close_date && new Date(event.event_close_date) <= new Date())) throw error('Applications are closed', 410);
    if (
      req.body.participation_path != null &&
      String(req.body.participation_path).toUpperCase() !== 'APPLICATION'
    ) {
      throw error('Marketplace Vendors may submit applications only.', 400);
    }
    const requestedTypes = cleanTypes(req.body.vendor_types);
    const eligibleNeeds = (event.event_vendor_needs || []).filter((need) => requestedTypes.includes(need.vendor_type) && profile.vendor_types.includes(need.vendor_type));
    if (!requestedTypes.length) throw error('Select at least one Marketplace Vendor type', 400);
    const capacityApplications = await EventVendorApplicationModel.find({
      event_id: event.event_id,
      status: { $in: ['AWARDED', 'PAYMENT_DUE', 'PAID'] },
    }).lean();
    if (!hasMarketplaceVendorCapacityForRequestedTypes({
      event,
      requestedTypes,
      approvedTypes: profile.vendor_types,
      applications: capacityApplications,
    })) {
      throw error('All requested Marketplace Vendor capacity has already been filled.', 409);
    }
    const photoIds = [...new Set(req.body.photo_ids || [])];
    if (photoIds.length > 5) throw error('Up to 5 application photos are allowed');
    const applicationQuery = { event_id: event.event_id, vendor_user_id: user._id };
    const existingApplication = await EventVendorApplicationModel.findOne(applicationQuery);
    const photos = await EventVendorPhotoModel.find({
      photo_id: { $in: photoIds },
      vendor_user_id: req.user._id,
      status: 'ACTIVE',
      $or: [
        { source: 'REPOSITORY' },
        { source: 'APPLICATION', event_id: event.event_id },
      ],
    }).lean();
    const selectedPhotos = resolveSelectedApplicationPhotos({
      photoIds,
      activePhotos: photos,
      priorSnapshots: (existingApplication?.photos || []).map((photo) => photo.toObject?.() || photo),
    });
    if (selectedPhotos.length !== photoIds.length) throw error('One or more selected photos are unavailable');
    const bullets = (req.body.offering_bullets || []).map((item) => String(item).trim()).filter(Boolean);
    if (!bullets.length) throw error('Add at least one product or service');
    const electricityRequired = req.body.electricity_required === true;
    if (electricityRequired && req.body.electricity_fee_acknowledged !== true) throw error('Acknowledge the electricity fee');
    const agreement = await MarketplaceVendorAgreementModel.findOne({
      vendor_user_id: req.user._id,
      event_vendor_profile_id: profile.profile_id,
      status: 'SIGNED',
      expires_at: { $gt: new Date() },
      governance_template_id: docusign.governanceTemplateId,
      nda_template_id: docusign.ndaTemplateId,
      governance_version: docusign.governanceVersion,
      nda_version: docusign.ndaVersion,
      required_document_count: { $gte: 2 },
      required_signature_document_count: { $gte: 2 },
      required_templates_verified_at: { $ne: null },
    }).sort({ signed_at: -1 }).lean();
    if (!agreement) throw error('Sign the Marketplace NDA and Governance Document before submitting', 409);
    const categoryFee = Math.max(...eligibleNeeds.map((need) => Number(need.fee || 0)));
    const participationPath = resolveEventVendorParticipationPath({
      paymentResponsibility: event.payment_responsibility,
      requestedPath: req.body.participation_path,
      existingApplication,
    });
    const electricityFee = electricityRequired ? Number(event.event_vendor_electricity_fee || 0) : 0;
    if (existingApplication && !isEventVendorApplicationEditable(existingApplication.status)) {
      const message = existingApplication.status === 'WITHDRAWN'
        ? 'This application was withdrawn. Reapplication requires coordinator support.'
        : 'This application can no longer be edited.';
      throw error(message, 409);
    }
    const applicationPayload = {
        event_id: event.event_id, profile_id: profile.profile_id, vendor_user_id: user._id,
        participation_path: participationPath,
        vendor_types: requestedTypes, business_name: profile.business_name,
        contact_name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        contact_number: `${user.countryCode || ''}${user.mobileNumber || ''}`,
        offering_bullets: bullets, average_price: Number(req.body.average_price),
        additional_notes: String(req.body.additional_notes || '').trim() || null,
        photos: selectedPhotos.map((photo) => ({
          photo_id: photo.photo_id, file_url: photo.file_url, file_key: photo.file_key,
          category: photo.category, source: photo.source,
          original_name: photo.original_name, mime_type: photo.mime_type,
        })),
        electricity_required: electricityRequired, electricity_fee: electricityFee,
        electricity_fee_acknowledged: electricityRequired,
        category_fee: participationPath === 'APPLICATION' ? categoryFee : 0,
        checkout_subtotal: (participationPath === 'APPLICATION' ? categoryFee : 0) + electricityFee,
        nda_version: agreement.nda_version, nda_accepted_at: agreement.signed_at,
        governance_version: agreement.governance_version, governance_accepted_at: agreement.signed_at,
        accepted_ip: req.ip,
    };
    let application;
    if (existingApplication) {
      Object.assign(existingApplication, applicationPayload);
      application = await existingApplication.save();
    } else {
      ({ application } = await findOrCreateEventVendorApplication({
      model: EventVendorApplicationModel,
      query: applicationQuery,
      payload: applicationPayload,
      }));
    }
    if (!agreement.application_id && agreement.event_id === event.event_id) {
      await MarketplaceVendorAgreementModel.updateOne(
        { agreement_id: agreement.agreement_id },
        { $set: { application_id: application.application_id } }
      );
      const attachmentLink = buildSignedAgreementAttachmentLink({
        eventId: event.event_id,
        vendorUserId: req.user._id,
        envelopeId: agreement.envelope_id,
        applicationId: application.application_id,
      });
      await MarketplaceAttachmentModel.updateMany(
        attachmentLink.query,
        attachmentLink.update
      );
      await MarketplaceAgreementAuditModel.create({
        event_id: event.event_id,
        agreement_id: agreement.agreement_id,
        agreement_envelope_id: agreement.envelope_id,
        vendor_user_id: req.user._id,
        event_vendor_profile_id: profile.profile_id,
        application_id: application.application_id,
        action: 'APPLICATION_FINALIZED',
        agreement_status: agreement.status,
        source: 'SYSTEM',
        message: 'Marketplace Vendor application finalized idempotently',
      }).catch((auditError) => {
        console.error('Marketplace application finalization audit failed', auditError?.message || auditError);
      });
    }
    await EventVendorPhotoModel.updateMany(
      {
        photo_id: { $in: photoIds },
        vendor_user_id: req.user._id,
        source: 'APPLICATION',
        event_id: event.event_id,
      },
      { $set: { status: 'ARCHIVED', archived_at: new Date() } }
    );
    return res.data({ eventVendorApplication: application }, 'Marketplace Vendor application submitted');
  } catch (e) { return next(e); }
};

exports.myApplications = async (req, res, next) => {
  try {
    const applications = await EventVendorApplicationModel.find({ vendor_user_id: req.user._id }).sort({ created_at: -1 }).lean();
    const events = await MarketplaceEventModel.find({
      event_id: { $in: applications.map((item) => item.event_id) },
    }).lean();
    const images = await MarketplaceEventImageModel.find({
      event_id: { $in: applications.map((item) => item.event_id) },
      status: 'ACTIVE',
    }).select('image_id event_id image_url original_name mime_type').lean();
    const questions = await MarketplaceEventQuestionModel.find({
      vendor_user_id: req.user._id,
      application_id: { $in: applications.map((item) => item.application_id) },
      status: 'PUBLISHED',
    }).select('application_id initiated_by_role created_at answered_at vendor_read_at answer_text_public').lean();
    const eventsById = new Map(events.map((event) => [event.event_id, event]));
    const unlockedEventIds = new Set(
      applications.filter(isEventVendorApplicationUnlocked).map((application) => application.event_id)
    );
    const coordinatorIds = [...new Set(
      events.filter((event) => unlockedEventIds.has(event.event_id)).map((event) => event.customer_user_id).filter(Boolean)
    )];
    const coordinators = coordinatorIds.length
      ? await UserModel.find({ _id: { $in: coordinatorIds } })
          .select('firstName lastName email mobileNumber countryCode')
          .lean()
      : [];
    const coordinatorsById = new Map(coordinators.map((coordinator) => [String(coordinator._id), coordinator]));
    return res.data({
      applicationList: applications.map((application) => {
        const event = eventsById.get(application.event_id);
        const accessUnlocked = isEventVendorApplicationUnlocked(application);
        const coordinator = accessUnlocked && event
          ? coordinatorsById.get(String(event.customer_user_id))
          : null;
        return {
          ...application,
          participation_path: resolveEventVendorParticipationPath({
            paymentResponsibility: event?.payment_responsibility,
            existingApplication: application,
          }),
          unread_message_count: questions.filter((question) => {
            if (question.application_id !== application.application_id) return false;
            const relevantAt = question.initiated_by_role === 'CUSTOMER'
              ? question.created_at
              : question.answered_at;
            return relevantAt && (!question.vendor_read_at || new Date(question.vendor_read_at) < new Date(relevantAt));
          }).length,
          event: event ? {
            ...applyMarketplaceEventLocationPrivacy(sanitizeEventVendorEvent(event), {
              locationUnlocked: accessUnlocked,
            }),
            ...(coordinator ? {
              coordinator_contact: getUnlockedMarketplaceCoordinatorContact({
                coordinator,
                detailsUnlocked: accessUnlocked,
              }),
            } : {}),
            public_images: images.filter((image) => image.event_id === application.event_id),
          } : null,
        };
      }),
    }, 'Marketplace Vendor applications');
  } catch (e) { return next(e); }
};

exports.withdrawApplication = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const application = await EventVendorApplicationModel.findOne({
      application_id: req.params.applicationId,
      vendor_user_id: req.user._id,
    });
    if (!application) throw error('Marketplace Vendor application not found', 404);
    if (application.status === 'WITHDRAWN') {
      return res.data({ eventVendorApplication: application }, 'Marketplace Vendor application already withdrawn');
    }
    const event = await MarketplaceEventModel.findOne({ event_id: application.event_id })
      .select('event_id status vendor_applications_closed_at event_close_date')
      .lean();
    const eventOpen = isEventOpenForOrdinaryWithdrawal(event);
    if (!eventOpen) {
      throw error('This event is closed and the application can no longer be withdrawn.', 409);
    }
    if (!isEventVendorApplicationWithdrawable(application.status)) {
      throw error('This application can no longer be withdrawn.', 409);
    }
    application.status = 'WITHDRAWN';
    application.withdrawn_at = new Date();
    await application.save();
    return res.data({ eventVendorApplication: application }, 'Marketplace Vendor application withdrawn');
  } catch (e) { return next(e); }
};

exports.awardApplication = async (req, res, next) => {
  try {
    const application = await EventVendorApplicationModel.findOne({ application_id: req.params.applicationId });
    if (!application) throw error('Marketplace Vendor application not found', 404);
    const event = await MarketplaceEventModel.findOne({ event_id: application.event_id, customer_user_id: req.user._id });
    if (!event) throw error('Event not found', 404);
    if (!['OPEN', 'REOPENED', 'CLOSED', 'AWARDED'].includes(event.status)) {
      throw error('This event is no longer available for vendor awards.', 409);
    }
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(application.status)) throw error('Application cannot be awarded in its current status', 409);
    for (const type of application.vendor_types) {
      const need = (event.event_vendor_needs || []).find((item) => item.vendor_type === type);
      const alreadyAwarded = await EventVendorApplicationModel.countDocuments({
        event_id: event.event_id,
        vendor_types: type,
        status: { $in: ['AWARDED', 'PAYMENT_DUE', 'PAID'] },
      });
      if (!need || alreadyAwarded >= Number(need.quantity || 0)) {
        throw error(`${type} vendor capacity has already been awarded`, 409);
      }
    }
    const existingPayment = await MarketplacePaymentModel.findOne({ application_id: application.application_id, payment_status: { $in: ['PENDING', 'PAID'] } });
    if (existingPayment) return res.data({ eventVendorApplication: application, marketplacePayment: existingPayment }, 'Marketplace Vendor award checkout');
    const subtotal = Number(application.checkout_subtotal || 0);
    const fee = getMarketplaceVendorApplicationCheckoutFeeAmount(subtotal);
    const payment = await MarketplacePaymentModel.create({
      event_id: event.event_id, application_id: application.application_id,
      payer_user_id: application.vendor_user_id, payer_type: 'VENDOR',
      payment_type: 'VENDOR_EVENT_FEE', base_amount: subtotal,
      fee_rate: 3.5, fee_amount: fee, total_amount: Math.round((subtotal + fee) * 100) / 100,
      coordinator_payout_amount: subtotal, payment_status: 'PENDING',
    });
    application.status = 'PAYMENT_DUE'; application.payment_id = payment.payment_id; await application.save();
    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: event.customer_user_id,
      title: 'Marketplace Vendor awarded',
      body: `Your Marketplace Vendor selection for ${event.event_name || 'the event'} has been recorded successfully.`,
      emailSubject: `Marketplace Vendor Awarded — ${event.event_name || event.event_id}`,
      emailBody: `Your Marketplace Vendor selection for ${event.event_name || 'the event'} has been recorded successfully. The vendor must complete the required attendance-fee checkout before participation is confirmed.`,
      channels: ['email'],
      metadata: { eventId: event.event_id, applicationId: application.application_id },
    });
    return res.data({ eventVendorApplication: application, marketplacePayment: payment }, 'Marketplace Vendor awarded; checkout is due');
  } catch (e) { return next(e); }
};

exports.declineApplication = async (req, res, next) => {
  try {
    const application = await EventVendorApplicationModel.findOne({
      application_id: req.params.applicationId,
    });
    if (!application) throw error('Marketplace Vendor application not found', 404);
    const event = await MarketplaceEventModel.findOne({
      event_id: application.event_id,
      customer_user_id: req.user._id,
    }).lean();
    if (!event) throw error('Event not found', 404);
    const transition = getCoordinatorNotSelectTransition('EVENT_VENDOR_APPLICATION', application.status);
    if (transition.idempotent) {
      return res.data({ eventVendorApplication: application }, 'Marketplace Vendor application already not selected');
    }
    if (!['OPEN', 'REOPENED', 'AWARDED'].includes(event.status) || event.vendor_applications_closed_at || (event.event_close_date && new Date(event.event_close_date) <= new Date()) || !transition.eligible) {
      throw error('This application can no longer be marked not selected.', 409);
    }
    application.status = transition.targetStatus;
    await application.save();
    try {
      await MarketplaceCommunications.sendMarketplaceCommunication({
        userId: application.vendor_user_id,
        title: 'Marketplace submission not selected',
        body: `${event.event_name || 'Your event'} did not select your application.`,
        emailSubject: `Application Update — ${event.event_name || 'Event'}`,
        emailBody: `The selection process for ${event.event_name || 'the event'} has ended, and your application was not selected. Thank you for sharing your services with the Round Da’ Corner community.`,
        data: {
          notificationType: 'MARKETPLACE_SUBMISSION_NOT_SELECTED',
          eventId: event.event_id,
          applicationId: application.application_id,
        },
        metadata: { eventId: event.event_id, applicationId: application.application_id },
      });
    } catch (notificationError) {
      console.error('Marketplace Vendor not-selected notification failed', {
        eventId: event.event_id,
        applicationId: application.application_id,
        message: notificationError.message,
      });
    }
    return res.data({ eventVendorApplication: application }, 'Marketplace Vendor application not selected');
  } catch (e) {
    return next(e);
  }
};

const refundPaidEventVendorFeeForRevocation = async ({ payment, actorUserId }) =>
  refundPaidMarketplaceVendorFee({
    payment,
    actorUserId,
    processRefund: CyberSourceRefundHelper.processRefund,
    claimRefund: ({ paymentId, actorUserId: actorId }) => MarketplacePaymentModel.findOneAndUpdate(
      {
        payment_id: paymentId,
        payment_status: 'PAID',
        $or: [
          { refund_status: { $in: ['NOT_REQUESTED', 'FAILED'] } },
          { refund_status: { $exists: false } },
        ],
      },
      {
        $set: {
          refund_status: 'PROCESSING', refund_started_at: new Date(),
          refund_failure_reason: null, refund_processed_by_user_id: actorId,
        },
      },
      { new: true, runValidators: true }
    ),
    completeRefund: ({ paymentId, actorUserId: actorId, refundTransactionId, refundMode }) =>
      MarketplacePaymentModel.findOneAndUpdate(
        { payment_id: paymentId, payment_status: 'PAID', refund_status: 'PROCESSING', refund_processed_by_user_id: actorId },
        {
          $set: {
            payment_status: 'REFUNDED', refund_status: 'REFUNDED',
            refund_transaction_id: refundTransactionId, refund_mode: refundMode,
            refunded_at: new Date(), refund_failure_reason: null,
          },
        },
        { new: true, runValidators: true }
      ),
    failRefund: ({ paymentId, actorUserId: actorId, message }) =>
      MarketplacePaymentModel.findOneAndUpdate(
        { payment_id: paymentId, payment_status: 'PAID', refund_status: 'PROCESSING', refund_processed_by_user_id: actorId },
        { $set: { refund_status: 'FAILED', refund_failure_reason: message } },
        { new: true, runValidators: true }
      ),
  });

const resolveEventVendorFeePaymentForRevocation = async ({ payment, actorUserId }) => {
  if (payment?.payment_status === 'PAID') {
    return (await refundPaidEventVendorFeeForRevocation({ payment, actorUserId })).payment;
  }
  if (payment?.payment_status !== 'PENDING') return payment;
  const cancelledPayment = await MarketplacePaymentModel.findOneAndUpdate(
    { payment_id: payment.payment_id, payment_status: 'PENDING' },
    { $set: { payment_status: 'CANCELLED', superseded_at: new Date() } },
    { new: true }
  );
  if (cancelledPayment) return cancelledPayment;
  const currentPayment = await MarketplacePaymentModel.findOne({ payment_id: payment.payment_id });
  if (currentPayment?.payment_status === 'PAID') {
    return (await refundPaidEventVendorFeeForRevocation({
      payment: currentPayment,
      actorUserId,
    })).payment;
  }
  return currentPayment;
};

exports.revokeApplicationAward = async (req, res, next) => {
  try {
    const application = await EventVendorApplicationModel.findOne({
      application_id: req.params.applicationId,
      status: { $in: ['AWARDED', 'PAYMENT_DUE', 'PAID'] },
    });
    if (!application) throw error('Awarded Marketplace Vendor application not found', 404);
    if (application.status !== 'PAID') {
      throw error(
        'This application is selected and awaiting payment. It is not yet a completed award and cannot be revoked.',
        409
      );
    }
    const event = await MarketplaceEventModel.findOne({
      event_id: application.event_id,
      customer_user_id: req.user._id,
    });
    if (!event) throw error('Event not found', 404);
    const payment = application.payment_id
      ? await MarketplacePaymentModel.findOne({ payment_id: application.payment_id })
      : await MarketplacePaymentModel.findOne({
          application_id: application.application_id,
          payment_type: 'VENDOR_EVENT_FEE',
          payment_status: { $in: ['PENDING', 'PROCESSING', 'PAID'] },
        });
    const initialRevocationDecision = getMarketplaceAwardRevocationDecision({
      event,
      vendorPaymentStatus: payment?.payment_status === 'PROCESSING'
        ? 'PROCESSING'
        : null,
    });
    if (!initialRevocationDecision.canRevoke) {
      throw error(getMarketplaceAwardRevocationError(initialRevocationDecision), 409);
    }
    const resolvedPayment = await resolveEventVendorFeePaymentForRevocation({
      payment,
      actorUserId: req.user._id,
    });
    const revocationDecision = getMarketplaceAwardRevocationDecision({
      event,
      vendorPaymentStatus:
        resolvedPayment?.payment_status ||
        application.payment_status ||
        (application.status === 'PAID' ? 'PAID' : null),
    });
    if (!revocationDecision.canRevoke) {
      throw error(getMarketplaceAwardRevocationError(revocationDecision), 409);
    }

    application.status = 'NOT_SELECTED';
    application.award_revoked_at = new Date();
    await application.save();
    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: application.vendor_user_id,
      title: 'Marketplace award revoked',
      body: `${event.event_name || 'Your event'} award was revoked by the coordinator.${req.body?.reason ? ` Reason: ${req.body.reason}` : ''}`,
      emailSubject: `Award Update — ${event.event_name || 'Event'}`,
      emailBody: `Your award for ${event.event_name || 'the event'} has been revoked by the event coordinator.${req.body?.reason ? `\n\nReason: ${req.body.reason}` : ''}\n\nPlease open the app to review your updated status.`,
      data: {
        notificationType: 'MARKETPLACE_AWARD_REVOKED',
        eventId: event.event_id,
        applicationId: application.application_id,
      },
      channels: ['push', 'email'],
      metadata: { eventId: event.event_id, applicationId: application.application_id },
    });
    return res.data(
      { eventVendorApplication: application },
      'Marketplace Vendor award revoked; the vendor slot is available'
    );
  } catch (e) {
    return next(e);
  }
};

exports.eventApplications = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({ event_id: req.params.eventId, customer_user_id: req.user._id }).lean();
    if (!event) throw error('Event not found', 404);
    const applications = await EventVendorApplicationModel.find({ event_id: event.event_id })
      .populate('vendor_user_id', 'firstName lastName email mobileNumber countryCode')
      .sort({ created_at: -1 }).lean();
    return res.data({
      applicationList: applications.map((application) =>
        sanitizeMarketplaceContactForCoordinator(hideMarketplaceAgreementFromCoordinator({
          ...application,
          vendor_display_id: getEventVendorDisplayId(application.profile_id),
        }), {
          detailsUnlocked: application.status === 'PAID',
        }))
    }, 'Marketplace Vendor applications');
  } catch (e) { return next(e); }
};

exports.createTapToPayActivationCode = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    await assertApprovedProfile(req.user._id);
    const activation = await CyberSourceActivationCodeHelper.createActivationCode();
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    return res.data({ activation_code: activation.token, expires_in_ms: activation.ttl }, 'Tap to Pay activation code generated');
  } catch (e) { return next(e); }
};

exports.registerTapToPayTerminal = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const profile = await assertApprovedProfile(req.user._id);
    const deviceId = String(req.body.device_id || '').trim();
    if (!deviceId) throw error('Tap to Pay terminal serial ID is required');
    const now = new Date();
    const existing = await TapToPayTerminalModel.findOne({ event_vendor_profile_id: profile.profile_id, device_id: deviceId });
    const terminal = await TapToPayTerminalModel.findOneAndUpdate(
      { event_vendor_profile_id: profile.profile_id, device_id: deviceId },
      {
        $set: {
          food_truck_id: null,
          vendor_user_id: req.user._id,
          assigned_user_type: 'VENDOR',
          assigned_user_id: req.user._id,
          device_id_suffix: deviceId.slice(-4),
          device_label: String(req.body.device_label || existing?.device_label || 'iPhone').trim().slice(0, 120),
          environment: ['test', 'sandbox'].includes(String(req.body.environment || '').toLowerCase()) ? 'TEST' : 'PRODUCTION',
          status: 'ACTIVE',
          last_seen_at: now,
          last_activation_status: req.body.activation_status === 'SUCCEEDED' ? 'SUCCEEDED' : (existing?.last_activation_status || 'UNKNOWN'),
          ...(req.body.activation_status === 'SUCCEEDED' ? {
            last_activation_at: now,
            last_activation_error_code: null,
            last_activation_error_message: null,
            reactivation_required: false,
            reactivation_reason: null,
            ...(existing?.reactivation_required ? { reactivation_completed_at: now } : {}),
          } : {}),
        },
        $setOnInsert: { registered_at: now },
        $push: { history: { action: existing ? 'SEEN' : 'REGISTERED', actor_type: 'VENDOR', actor_id: req.user._id, occurred_at: now } },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    profile.tap_to_pay_serial_number = deviceId;
    await profile.save();
    return res.data({
      registered: true,
      terminal_id: terminal._id,
      terminal_serial_suffix: deviceId.slice(-4),
      reactivation_required: terminal.reactivation_required,
    }, 'Tap to Pay terminal registered');
  } catch (e) { return next(e); }
};

exports.getTapToPayTerminalStatus = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const profile = await assertApprovedProfile(req.user._id);
    const deviceId = String(req.query.device_id || '').trim();
    const terminal = await TapToPayTerminalModel.findOne({ event_vendor_profile_id: profile.profile_id, device_id: deviceId });
    if (!terminal) return res.data({ known: false, status: 'UNREGISTERED', reactivation_required: false }, 'Tap to Pay terminal status');
    terminal.last_seen_at = new Date();
    await terminal.save();
    return res.data({
      known: true,
      terminal_id: terminal._id,
      status: terminal.status,
      reactivation_required: terminal.reactivation_required,
      reactivation_reason: terminal.reactivation_reason,
      device_id_suffix: terminal.device_id_suffix,
    }, 'Tap to Pay terminal status');
  } catch (e) { return next(e); }
};

exports.prepareGeneralPurchase = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const profile = await assertApprovedProfile(req.user._id);
    const checkoutKey = String(req.body.checkout_key || '').trim();
    if (!checkoutKey) throw error('Checkout key is required');
    const totals = buildGeneralPurchaseTotals({ items: req.body.items, taxRate: req.body.tax_rate });
    if (totals.total <= 0) throw error('General Purchase total must be greater than zero');
    const phone = sanitizePhone(req.body.customer_phone);
    let purchase = await MarketplaceGeneralPurchaseModel.findOneAndUpdate(
      { vendor_user_id: req.user._id, checkout_key: checkoutKey, status: 'PREPARED' },
      { $set: { ...totals, customer_phone: phone } },
      { new: true }
    );
    if (!purchase) {
      try {
        purchase = await MarketplaceGeneralPurchaseModel.create({
          event_vendor_profile_id: profile.profile_id,
          vendor_user_id: req.user._id,
          checkout_key: checkoutKey,
          ...totals,
          customer_phone: phone,
        });
      } catch (createError) {
        if (createError?.code !== 11000) throw createError;
        purchase = await MarketplaceGeneralPurchaseModel.findOne({ vendor_user_id: req.user._id, checkout_key: checkoutKey });
      }
    }
    if (!purchase || purchase.status !== 'PREPARED') throw error('This checkout has already been submitted.', 409);
    return res.data({ purchase: {
      id: purchase.purchase_id,
      reference: purchase.reference,
      items: purchase.items,
      subtotal: purchase.subtotal,
      tax_rate: purchase.tax_rate,
      tax_amount: purchase.tax_amount,
      total: purchase.total,
      currency: purchase.currency,
      status: purchase.status,
    } }, 'General Purchase prepared');
  } catch (e) { return next(e); }
};

exports.completeGeneralPurchase = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const profile = await assertApprovedProfile(req.user._id);
    const transactionId = String(req.body.transaction_id || '').trim();
    if (!transactionId) throw error('A verified Tap to Pay transaction is required');
    const duplicate = await MarketplaceGeneralPurchaseModel.findOne({ transaction_id: transactionId, status: 'COMPLETED' }).lean();
    if (duplicate) throw error('This Tap to Pay transaction has already been used.', 409);
    const purchase = await MarketplaceGeneralPurchaseModel.findOneAndUpdate(
      { purchase_id: req.params.purchaseId, vendor_user_id: req.user._id, status: 'PREPARED' },
      { $set: { status: 'PROCESSING' } },
      { new: true }
    );
    if (!purchase) throw error('General Purchase is unavailable or already processing.', 409);
    try {
      await CyberSourcePaymentHelper.verifyTransaction({
        transactionId,
        expectedAmount: purchase.total,
        expectedCurrency: purchase.currency,
        expectedReference: purchase.reference,
      });
    } catch (verificationError) {
      purchase.status = 'REVIEW_REQUIRED';
      await purchase.save();
      throw Object.assign(new Error('Tap to Pay could not be verified with the payment processor.'), { code: 502 });
    }
    purchase.status = 'COMPLETED';
    purchase.transaction_id = transactionId;
    purchase.auth_code = req.body.auth_code || null;
    purchase.invoice_number = req.body.invoice_number || null;
    purchase.account_number = req.body.account_number || null;
    purchase.account_type = req.body.account_type || null;
    purchase.completed_at = new Date();
    await purchase.save();
    if (purchase.customer_phone) {
      void SmsHelper.sendSms({
        to: purchase.customer_phone,
        body: generalPurchaseReceiptBody({ purchase, profile }),
        metadata: { purchaseId: purchase.purchase_id, receiptType: 'MARKETPLACE_GENERAL_PURCHASE_SMS' },
      }).catch((smsError) => console.error('General Purchase receipt SMS failed', { purchaseId: purchase.purchase_id, code: smsError?.code || 'SMS_FAILED' }));
    }
    return res.data({ purchase }, 'General Purchase completed');
  } catch (e) { return next(e); }
};

exports.cancelGeneralPurchase = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const purchase = await MarketplaceGeneralPurchaseModel.findOneAndUpdate(
      { purchase_id: req.params.purchaseId, vendor_user_id: req.user._id, status: 'PREPARED' },
      { $set: { status: 'CANCELED', canceled_at: new Date() } },
      { new: true }
    );
    if (!purchase) throw error('General Purchase is unavailable.', 409);
    return res.data({ canceled: true }, 'General Purchase canceled');
  } catch (e) { return next(e); }
};

exports.listGeneralPurchases = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const purchases = await MarketplaceGeneralPurchaseModel.find({ vendor_user_id: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
    return res.data({ purchaseList: purchases }, 'General Purchases');
  } catch (e) { return next(e); }
};

exports.refundGeneralPurchase = async (req, res, next) => {
  try {
    await assertEventVendor(req.user._id);
    const purchase = await MarketplaceGeneralPurchaseModel.findOneAndUpdate(
      { purchase_id: req.params.purchaseId, vendor_user_id: req.user._id, status: { $in: ['COMPLETED', 'REFUND_FAILED'] } },
      { $set: { status: 'REFUND_PROCESSING', refund_failure_reason: null } },
      { new: true }
    );
    if (!purchase) throw error('General Purchase is not available for refund.', 409);
    const refund = await CyberSourceRefundHelper.processRefund(buildGeneralPurchaseRefundRequest(purchase));
    if (!refund?.success) {
      purchase.status = 'REFUND_FAILED';
      purchase.refund_failure_reason = refund?.message || 'Processor refund failed';
      await purchase.save();
      throw Object.assign(new Error(purchase.refund_failure_reason), { code: 502 });
    }
    purchase.status = 'REFUNDED';
    purchase.refund_transaction_id = refund.refundTransactionId || null;
    purchase.refund_mode = refund.mode === 'void' ? 'void' : 'refund';
    purchase.refunded_at = new Date();
    await purchase.save();
    return res.data({ purchase }, 'General Purchase refunded');
  } catch (e) { return next(e); }
};

exports.adminListProfiles = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const status = String(req.query.status || '').toUpperCase();
    const query = buildAdminProfileQuery(status);
    const [profiles, total] = await Promise.all([
      EventVendorProfileModel.find(query)
        .populate('vendor_user_id', 'firstName lastName email countryCode mobileNumber vendorSubtype requestStatus')
        .sort({ submitted_at: -1, updated_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      EventVendorProfileModel.countDocuments(query),
    ]);
    return res.data({ profileList: profiles, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) }, 'Marketplace Vendor profiles');
  } catch (e) { return next(e); }
};

exports.adminGetProfile = async (req, res, next) => {
  try {
    const profile = await EventVendorProfileModel.findOne({ profile_id: req.params.profileId, status: 'ACTIVE' })
      .populate('vendor_user_id', 'firstName lastName email countryCode mobileNumber vendorSubtype requestStatus')
      .lean();
    if (!profile) throw error('Marketplace Vendor profile not found', 404);
    const photos = await EventVendorPhotoModel.find({
      profile_id: profile.profile_id,
      source: 'REPOSITORY',
      status: 'ACTIVE',
    }).sort({ category: 1, created_at: -1 }).lean();
    const terminals = await TapToPayTerminalModel.find({ event_vendor_profile_id: profile.profile_id }).sort({ last_seen_at: -1 }).lean();
    return res.data({ eventVendorProfile: profile, photoList: photos, tapToPayTerminals: terminals }, 'Marketplace Vendor profile review');
  } catch (e) { return next(e); }
};

exports.adminUpdateTapToPayTerminal = async (req, res, next) => {
  try {
    const profile = await EventVendorProfileModel.findOne({ profile_id: req.params.profileId, status: 'ACTIVE' });
    if (!profile) throw error('Marketplace Vendor profile not found', 404);
    const terminal = await TapToPayTerminalModel.findOne({ _id: req.params.terminalId, event_vendor_profile_id: profile.profile_id });
    if (!terminal) throw error('Tap to Pay terminal not found', 404);
    const action = String(req.body.action || '').toUpperCase();
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (action === 'REQUIRE_REACTIVATION') {
      terminal.reactivation_required = true;
      terminal.reactivation_requested_at = new Date();
      terminal.reactivation_requested_by = req.user._id;
      terminal.reactivation_reason = reason || 'Requested by RTC support';
    } else if (action === 'MARK_HISTORICAL') {
      terminal.status = 'HISTORICAL';
    } else if (action === 'RESTORE_ACTIVE') {
      terminal.status = 'ACTIVE';
    } else if (action === 'CLEAR_REACTIVATION') {
      terminal.reactivation_required = false;
      terminal.reactivation_reason = null;
    } else {
      throw error('Select a valid Tap to Pay terminal action');
    }
    terminal.history.push({ action, actor_type: 'SUPER_ADMIN', actor_id: req.user._id, reason: reason || null, occurred_at: new Date() });
    await terminal.save();
    return res.data({ terminal }, 'Tap to Pay terminal updated');
  } catch (e) { return next(e); }
};

exports.adminReviewProfile = async (req, res, next) => {
  try {
    const reviewStatus = String(req.body.review_status || '').toUpperCase();
    const reason = String(req.body.rejection_reason || '').trim();
    const profile = await EventVendorProfileModel.findOne({ profile_id: req.params.profileId, status: 'ACTIVE' });
    if (!profile) throw error('Marketplace Vendor profile not found', 404);
    const decisionValidation = validateReviewDecision({ currentStatus: profile.review_status, nextStatus: reviewStatus, rejectionReason: reason });
    if (decisionValidation === 'NOT_PENDING') throw error('Only submitted profiles may be reviewed', 409);
    if (decisionValidation === 'REASON_REQUIRED') throw error('A rejection reason is required');
    if (decisionValidation !== 'VALID') throw error('Approve or reject the profile');
    const now = new Date();
    profile.review_status = reviewStatus;
    profile.reviewed_at = now;
    profile.reviewed_by = req.user._id;
    profile.rejection_reason = reviewStatus === 'REJECTED' ? reason : null;
    profile.review_history.push({ status: reviewStatus, reason: profile.rejection_reason, changed_at: now, changed_by: req.user._id });
    await profile.save();
    await UserModel.updateOne(
      { _id: profile.vendor_user_id, vendorSubtype: 'EVENT_VENDOR' },
      {
        $set: {
          requestStatus: reviewStatus,
          reasonForRejection: reviewStatus === 'REJECTED' ? reason : null,
          inactive: false,
        },
      }
    );
    return res.data({ eventVendorProfile: profile }, `Marketplace Vendor profile ${reviewStatus.toLowerCase()}`);
  } catch (e) { return next(e); }
};
