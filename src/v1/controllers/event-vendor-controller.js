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
} = require('../../models');
const { addObjectWithKey } = require('../../helper/aws');
const { docusign } = require('../../config');
const MailHelper = require('../../helper/mail-helper');
const MarketplaceCommunications = require('../../helper/marketplace-communications-helper');
const {
  buildEventVendorAwardDetailsHtml,
} = require('../../helper/marketplace-award-email-helper');
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
  ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES,
  isEventVendorApplicationEditable,
  isEventVendorApplicationWithdrawable,
  isEventOpenForOrdinaryWithdrawal,
  resolveSelectedApplicationPhotos,
  getCoordinatorNotSelectTransition,
} = require('../../helper/marketplace-submission-lifecycle');
const { resolveEventVendorParticipationPath } = require('../../helper/event-vendor-participation-helper');
const { normalizeExternalWebLink, normalizeExternalWebLinks } = require('../../helper/external-web-link');

const TYPES = ['MERCHANDISE', 'SERVICE', 'OTHER'];
const EVENT_VENDOR_PUBLIC_EVENT_FIELDS = [
  'event_id', 'event_name', 'event_description', 'event_type', 'status',
  'event_date', 'event_start_date', 'event_end_date', 'event_start_time',
  'event_end_time', 'event_time', 'event_close_time', 'event_timezone',
  'event_address', 'formatted_address', 'event_city', 'event_state',
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
const cleanTypes = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).toUpperCase()))]
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
    const images = await MarketplaceEventImageModel.find({
      event_id: { $in: events.map((event) => event.event_id) },
      status: 'ACTIVE',
    }).select('image_id event_id image_url original_name mime_type').lean();
    const marketplaceEventList = events.map((event) => ({
      ...sanitizeEventVendorEvent(event),
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
    const requestedTypes = cleanTypes(req.body.vendor_types);
    const eligibleNeeds = (event.event_vendor_needs || []).filter((need) => requestedTypes.includes(need.vendor_type) && profile.vendor_types.includes(need.vendor_type));
    if (!requestedTypes.length || eligibleNeeds.length !== requestedTypes.length) throw error('This event is not requesting one or more selected vendor types', 403);
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
    }).sort({ signed_at: -1 }).lean();
    if (!agreement) throw error('Sign the Marketplace NDA and Governance Document before submitting', 409);
    const categoryFee = Math.max(...eligibleNeeds.map((need) => Number(need.fee || 0)));
    const participationPath = resolveEventVendorParticipationPath({
      paymentResponsibility: event.payment_responsibility,
      requestedPath: req.body.participation_path,
      existingApplication,
    });
    if (existingApplication?.participation_path && existingApplication.participation_path !== participationPath) {
      throw error('The selected participation path cannot be changed after submission.', 409);
    }
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
    return res.data({
      applicationList: applications.map((application) => ({
        ...application,
        participation_path: resolveEventVendorParticipationPath({
          paymentResponsibility: eventsById.get(application.event_id)?.payment_responsibility,
          existingApplication: application,
        }),
        unread_message_count: questions.filter((question) => {
          if (question.application_id !== application.application_id) return false;
          const relevantAt = question.initiated_by_role === 'CUSTOMER'
            ? question.created_at
            : question.answered_at;
          return relevantAt && (!question.vendor_read_at || new Date(question.vendor_read_at) < new Date(relevantAt));
        }).length,
        event: eventsById.has(application.event_id) ? {
          ...sanitizeEventVendorEvent(eventsById.get(application.event_id)),
          public_images: images.filter((image) => image.event_id === application.event_id),
        } : null,
      })),
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
    const fee = Math.round(subtotal * 0.035 * 100) / 100;
    const payment = await MarketplacePaymentModel.create({
      event_id: event.event_id, application_id: application.application_id,
      payer_user_id: application.vendor_user_id, payer_type: 'VENDOR',
      payment_type: 'VENDOR_EVENT_FEE', base_amount: subtotal,
      fee_rate: 3.5, fee_amount: fee, total_amount: Math.round((subtotal + fee) * 100) / 100,
      coordinator_payout_amount: subtotal, payment_status: 'PENDING',
    });
    application.status = 'PAYMENT_DUE'; application.payment_id = payment.payment_id; await application.save();
    const [coordinator, vendor] = await Promise.all([
      UserModel.findById(event.customer_user_id).lean(),
      UserModel.findById(application.vendor_user_id).lean(),
    ]);
    if (coordinator?.email) {
      try {
        await MailHelper.sendMail(
          coordinator.email,
          `RTC Marketplace Vendor awarded - ${event.event_name || event.event_id}`,
          `
            <p>Your Marketplace Vendor selection has been recorded.</p>
            <p><strong>Event:</strong> ${event.event_name || event.event_id}</p>
            <p><strong>Event date:</strong> ${event.event_date || 'Not provided'}</p>
            <h3>Award details</h3>
            ${buildEventVendorAwardDetailsHtml({ application, vendor })}
            <p>The vendor must complete the attendance-fee checkout before the award is confirmed.</p>
          `
        );
      } catch (mailError) {
        console.error('Marketplace Vendor coordinator award email failed', {
          eventId: event.event_id,
          applicationId: application.application_id,
          message: mailError.message,
        });
      }
    }
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
    if (!['OPEN', 'REOPENED'].includes(event.status) || !transition.eligible) {
      throw error('This application can no longer be marked not selected.', 409);
    }
    application.status = transition.targetStatus;
    await application.save();
    try {
      await MarketplaceCommunications.sendMarketplaceCommunication({
        userId: application.vendor_user_id,
        title: 'Marketplace submission not selected',
        body: `${event.event_name || 'Your event'} did not select your application.`,
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

exports.eventApplications = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({ event_id: req.params.eventId, customer_user_id: req.user._id }).lean();
    if (!event) throw error('Event not found', 404);
    const applications = await EventVendorApplicationModel.find({ event_id: event.event_id })
      .populate('vendor_user_id', 'firstName lastName email mobileNumber countryCode')
      .sort({ created_at: -1 }).lean();
    const agreementAttachments = await MarketplaceAttachmentModel.find({
      event_id: event.event_id,
      application_id: { $in: applications.map((application) => application.application_id) },
      attachment_type: 'AGREEMENT_DOCUMENT',
      status: 'ACTIVE',
    }).select('attachment_id application_id attachment_type file_url original_name mime_type').lean();
    return res.data({
      applicationList: applications.map((application) =>
        sanitizeMarketplaceContactForCoordinator({
          ...application,
          vendor_display_id: getEventVendorDisplayId(application.profile_id),
          attachments: agreementAttachments.filter(
            (attachment) => attachment.application_id === application.application_id
          ),
        }, {
          detailsUnlocked: application.status === 'PAID',
        }))
    }, 'Marketplace Vendor applications');
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
    return res.data({ eventVendorProfile: profile, photoList: photos }, 'Marketplace Vendor profile review');
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
