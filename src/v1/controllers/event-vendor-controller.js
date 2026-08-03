const fs = require('fs');
const {
  EventVendorProfileModel,
  EventVendorPhotoModel,
  EventVendorApplicationModel,
  MarketplaceEventModel,
  UserModel,
  MarketplacePaymentModel,
  MarketplaceVendorAgreementModel,
} = require('../../models');
const { addObjectWithKey } = require('../../helper/aws');
const { docusign } = require('../../config');

const TYPES = ['MERCHANDISE', 'SERVICE', 'OTHER'];
const error = (message, code = 400) => Object.assign(new Error(message), { code });
const cleanTypes = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).toUpperCase()))]
  .filter((item) => TYPES.includes(item));
const assertEventVendor = async (userId) => {
  const user = await UserModel.findById(userId);
  if (!user || user.userType !== 'VENDOR') throw error('Vendor account required', 403);
  return user;
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
    const socialLinks = (req.body.social_links || []).map((item) => String(item).trim()).filter(Boolean);
    if (socialLinks.length > 2) throw error('Up to 2 website/social links are allowed');
    const profile = await EventVendorProfileModel.findOneAndUpdate(
      { vendor_user_id: user._id },
      { $set: { vendor_types: vendorTypes, business_name: businessName, business_description: description, social_links: socialLinks, status: 'ACTIVE' } },
      { new: true, upsert: true, runValidators: true }
    );
    user.vendorSubtype = 'EVENT_VENDOR';
    await user.save();
    return res.data({ eventVendorProfile: profile }, 'Marketplace Vendor profile saved');
  } catch (e) { return next(e); }
};

exports.uploadPhoto = async (req, res, next) => {
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) throw error('A JPG, PNG, or HEIC photo is required');
    const profile = await EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' });
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    const count = await EventVendorPhotoModel.countDocuments({ vendor_user_id: req.user._id, status: 'ACTIVE' });
    if (count >= 10) throw error('Photo Repository holds up to 10 photos', 409);
    const { url, key } = await addObjectWithKey(req.file, 'marketplace/event-vendors/photos');
    fs.unlink(req.file.path, () => {});
    const photo = await EventVendorPhotoModel.create({
      profile_id: profile.profile_id, vendor_user_id: req.user._id,
      file_url: url, file_key: key, original_name: req.file.originalname, mime_type: req.file.mimetype,
    });
    return res.data({ photo }, 'Marketplace Vendor photo uploaded');
  } catch (e) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(e);
  }
};

exports.uploadLogo = async (req, res, next) => {
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) throw error('A logo image is required');
    const profile = await EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' });
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    const { url, key } = await addObjectWithKey(req.file, 'marketplace/event-vendors/logos');
    fs.unlink(req.file.path, () => {});
    profile.logo_url = url;
    profile.logo_key = key;
    await profile.save();
    return res.data({ eventVendorProfile: profile }, 'Business logo uploaded');
  } catch (e) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(e);
  }
};

exports.listPhotos = async (req, res, next) => {
  try {
    const photos = await EventVendorPhotoModel.find({ vendor_user_id: req.user._id, status: 'ACTIVE' }).sort({ created_at: -1 }).lean();
    return res.data({ photoList: photos }, 'Marketplace Vendor photos');
  } catch (e) { return next(e); }
};

exports.removePhoto = async (req, res, next) => {
  try {
    const photo = await EventVendorPhotoModel.findOneAndUpdate(
      { photo_id: req.params.photoId, vendor_user_id: req.user._id, status: 'ACTIVE' },
      { $set: { status: 'ARCHIVED', archived_at: new Date() } },
      { new: true }
    );
    if (!photo) throw error('Photo not found', 404);
    return res.data({ photo }, 'Photo removed from repository');
  } catch (e) { return next(e); }
};

exports.eligibleEvents = async (req, res, next) => {
  try {
    const profile = await EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' }).lean();
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    const events = await MarketplaceEventModel.find({
      status: { $in: ['OPEN', 'REOPENED'] },
      vendor_applications_closed_at: null,
      event_close_date: { $gt: new Date() },
      event_vendor_needs: { $elemMatch: { vendor_type: { $in: profile.vendor_types }, quantity: { $gt: 0 } } },
    }).sort({ event_date: 1 }).lean();
    return res.data({ marketplaceEventList: events }, 'Eligible Marketplace Vendor events');
  } catch (e) { return next(e); }
};

exports.submitApplication = async (req, res, next) => {
  try {
    const [user, profile, event] = await Promise.all([
      assertEventVendor(req.user._id),
      EventVendorProfileModel.findOne({ vendor_user_id: req.user._id, status: 'ACTIVE' }).lean(),
      MarketplaceEventModel.findOne({ event_id: req.params.eventId, status: { $in: ['OPEN', 'REOPENED'] }, vendor_applications_closed_at: null }).lean(),
    ]);
    if (!profile) throw error('Complete the Marketplace Vendor profile first', 409);
    if (!event || (event.event_close_date && new Date(event.event_close_date) <= new Date())) throw error('Applications are closed', 410);
    const requestedTypes = cleanTypes(req.body.vendor_types);
    const eligibleNeeds = (event.event_vendor_needs || []).filter((need) => requestedTypes.includes(need.vendor_type) && profile.vendor_types.includes(need.vendor_type));
    if (!requestedTypes.length || eligibleNeeds.length !== requestedTypes.length) throw error('This event is not requesting one or more selected vendor types', 403);
    const photoIds = [...new Set(req.body.photo_ids || [])];
    if (photoIds.length > 5) throw error('Up to 5 application photos are allowed');
    const photos = await EventVendorPhotoModel.find({ photo_id: { $in: photoIds }, vendor_user_id: req.user._id, status: 'ACTIVE' }).lean();
    if (photos.length !== photoIds.length) throw error('One or more selected photos are unavailable');
    const bullets = (req.body.offering_bullets || []).map((item) => String(item).trim()).filter(Boolean);
    if (!bullets.length) throw error('Add at least one product or service');
    const electricityRequired = req.body.electricity_required === true;
    if (electricityRequired && req.body.electricity_fee_acknowledged !== true) throw error('Acknowledge the electricity fee');
    const agreement = await MarketplaceVendorAgreementModel.findOne({
      vendor_user_id: req.user._id,
      status: 'SIGNED',
      expires_at: { $gt: new Date() },
      governance_template_id: docusign.governanceTemplateId,
      nda_template_id: docusign.ndaTemplateId,
      governance_version: docusign.governanceVersion,
      nda_version: docusign.ndaVersion,
    }).sort({ signed_at: -1 }).lean();
    if (!agreement) throw error('Sign the Marketplace NDA and Governance Document before submitting', 409);
    const categoryFee = Math.max(...eligibleNeeds.map((need) => Number(need.fee || 0)));
    const electricityFee = electricityRequired ? Number(event.event_vendor_electricity_fee || 0) : 0;
    const application = await EventVendorApplicationModel.create({
      event_id: event.event_id, profile_id: profile.profile_id, vendor_user_id: user._id,
      vendor_types: requestedTypes, business_name: profile.business_name,
      contact_name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      contact_number: `${user.countryCode || ''}${user.mobileNumber || ''}`,
      offering_bullets: bullets, average_price: Number(req.body.average_price),
      additional_notes: String(req.body.additional_notes || '').trim() || null,
      photos: photos.map((photo) => ({ photo_id: photo.photo_id, file_url: photo.file_url, file_key: photo.file_key })),
      electricity_required: electricityRequired, electricity_fee: electricityFee,
      electricity_fee_acknowledged: electricityRequired,
      category_fee: categoryFee, checkout_subtotal: categoryFee + electricityFee,
      nda_version: agreement.nda_version, nda_accepted_at: agreement.signed_at,
      governance_version: agreement.governance_version, governance_accepted_at: agreement.signed_at,
      accepted_ip: req.ip,
    });
    return res.data({ eventVendorApplication: application }, 'Marketplace Vendor application submitted');
  } catch (e) { return next(e); }
};

exports.myApplications = async (req, res, next) => {
  try {
    const applications = await EventVendorApplicationModel.find({ vendor_user_id: req.user._id }).sort({ created_at: -1 }).lean();
    return res.data({ applicationList: applications }, 'Marketplace Vendor applications');
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
    return res.data({ eventVendorApplication: application, marketplacePayment: payment }, 'Marketplace Vendor awarded; checkout is due');
  } catch (e) { return next(e); }
};

exports.eventApplications = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({ event_id: req.params.eventId, customer_user_id: req.user._id }).lean();
    if (!event) throw error('Event not found', 404);
    const applications = await EventVendorApplicationModel.find({ event_id: event.event_id })
      .populate('vendor_user_id', 'firstName lastName email mobileNumber countryCode')
      .sort({ created_at: -1 }).lean();
    return res.data({ applicationList: applications }, 'Marketplace Vendor applications');
  } catch (e) { return next(e); }
};
