const fs = require('fs');
const {
  FoodTruckService,
  MarketplaceApplicationService,
  MarketplaceAttachmentService,
  MarketplaceAgreementAuditService,
  MarketplaceBidService,
  MarketplaceEventImageService,
  MarketplaceEventQuestionService,
  MarketplaceEventService,
  MarketplaceFileAuditService,
  MarketplacePaymentAuditService,
  MarketplacePaymentService,
  MarketplaceVendorAgreementService,
  UserService,
} = require('../services');
const {
  canAccessEventMarketplace,
} = require('../../helper/vendor-plan-helper');
const {
  addObjectFromBufferWithKey,
  addObjectWithKey,
  removeObject,
} = require('../../helper/aws');
const PaymentHelper = require('../../helper/payment-helper');
const DocuSignHelper = require('../../helper/docusign-helper');
const MarketplaceCommunications = require('../../helper/marketplace-communications-helper');
const MailHelper = require('../../helper/mail-helper');
const { docusign } = require('../../config');
const {
  moderateMarketplaceText,
} = require('../../helper/marketplace-content-moderation');

const buildError = (message, code = 400) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const assertMarketplaceTextAllowed = (value, fieldName = 'Text') => {
  const moderation = moderateMarketplaceText(value);
  if (moderation.status === 'BLOCKED') {
    throw buildError(
      `${fieldName} cannot include contact info, social handles, payment handles, or requests to connect outside RTC.`,
      400
    );
  }
};

const assertRequiredMarketplaceFields = (fields = {}) => {
  Object.entries(fields).forEach(([label, value]) => {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && !value.trim())
    ) {
      throw buildError(`${label} is required before submitting.`, 400);
    }
  });
};

const MARKETPLACE_PHONE_NUMBER = '800-410-7053';
const COORDINATOR_AWARD_FEE_RATE = 0.035;
const VENDOR_EVENT_PROCESSING_RATE = 0.02;

const roundMoney = (value) => Number((Number(value || 0)).toFixed(2));
const ACTIVE_EVENT_STATUSES = ['OPEN', 'REOPENED'];
const DRAFT_TTL_DAYS = 7;
const VENDOR_AGREEMENT_VALID_DAYS = 365;
const REQUIREMENT_ATTACHMENT_TYPE = 'REQUIREMENT_DOCUMENT';
const DEFAULT_REQUIREMENT_LABELS = [
  'Insurance',
  'Health Permit',
  'Fire Permit',
  'Liquor License',
  'Certificate of Insurance',
  'Business License',
  'Food Handler Permit',
  'Other',
];

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value.filter((item) => item != null && String(item).trim() !== '');
  }
  if (value == null || value === '') {
    return [];
  }
  return [String(value)];
};

const hasText = (value) => String(value || '').trim().length > 0;

const getVendorDisplayId = (foodTruckId) => {
  const rawId =
    typeof foodTruckId === 'object'
      ? foodTruckId?._id || foodTruckId?.id || ''
      : foodTruckId || '';
  const suffix = String(rawId).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `Vendor RTC - ${suffix || 'MASKED'}`;
};

const QA_ARCHIVED_EVENT_STATUSES = ['AWARDED', 'CLOSED', 'CANCELLED', 'ARCHIVED'];

const isQuestionBoardArchived = (event = {}) =>
  QA_ARCHIVED_EVENT_STATUSES.includes(event.status);

const normalizeTime = (value) => {
  if (!hasText(value)) {
    return null;
  }
  const raw = String(value).trim();
  const amPmMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = amPmMatch[2];
    const meridian = amPmMatch[3].toUpperCase();
    if (hour < 1 || hour > 12) {
      throw buildError('Time must use HH:mm AM/PM format', 400);
    }
    if (meridian === 'PM' && hour !== 12) hour += 12;
    if (meridian === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }
  const militaryMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (militaryMatch) {
    const hour = Number(militaryMatch[1]);
    const minute = Number(militaryMatch[2]);
    if (hour > 23 || minute > 59) {
      throw buildError('Time must use a valid HH:mm value', 400);
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  throw buildError('Time must use HH:mm AM/PM format', 400);
};

const combineDateAndTime = (dateValue, timeValue) => {
  if (!dateValue) {
    return null;
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const normalizedTime = normalizeTime(timeValue) || '23:59';
  const [hours, minutes] = normalizedTime.split(':').map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const normalizeMarketplaceEventLocation = (body) => {
  const latitude =
    body.latitude === '' || body.latitude == null ? null : Number(body.latitude);
  const longitude =
    body.longitude === '' || body.longitude == null ? null : Number(body.longitude);
  const hasCoordinates =
    Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    ...body,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    formatted_address: body.formatted_address || body.event_address,
    geocoded_address: body.geocoded_address || body.formatted_address || null,
    place_id: body.place_id || null,
    geocoding_provider: hasCoordinates
      ? body.geocoding_provider || 'GOOGLE_PLACES'
      : null,
    geocoded_at: hasCoordinates ? body.geocoded_at || new Date() : null,
  };
};

const normalizeMarketplaceVendorCount = (body) => {
  const serviceTypes = asArray(body.service_types?.length ? body.service_types : body.service_type);
  if (body.primary_service_style === 'Food Truck' || serviceTypes.includes('Food Truck')) {
    return Math.max(1, Math.ceil(Number(body.number_of_guests || 0) / 100));
  }

  return null;
};

const normalizeMarketplaceEventPayload = (body = {}, { existingEvent = null } = {}) => {
  const status = body.status || existingEvent?.status || 'OPEN';
  const isDraft = status === 'DRAFT';
  const serviceTypes = asArray(body.service_types?.length ? body.service_types : body.service_type);
  let serviceStyles = asArray(body.service_styles);
  let primaryServiceStyle = body.primary_service_style || existingEvent?.primary_service_style || '';

  if (serviceTypes.includes('Food Truck') && !primaryServiceStyle) {
    primaryServiceStyle = 'Food Truck';
    if (!serviceStyles.includes('Food Truck')) {
      serviceStyles = [...serviceStyles, 'Food Truck'];
    }
  }

  const permitsRequired = asArray(body.permits_required);
  let alcoholRequired = Boolean(body.alcohol_required);
  const alcoholServiceSelected =
    serviceTypes.includes('Beverage and Alcohol') ||
    serviceTypes.includes('Beverage/Alcohol Service') ||
    serviceTypes.includes('Alcohol');
  if (permitsRequired.includes('Alcohol') || alcoholServiceSelected) {
    alcoholRequired = true;
    if (!permitsRequired.includes('Alcohol')) {
      permitsRequired.push('Alcohol');
    }
  }

  let equipmentNeeded = asArray(body.equipment_needed);
  if (equipmentNeeded.includes('None') && equipmentNeeded.length > 1) {
    equipmentNeeded = ['None'];
  }

  const paymentResponsibility = body.payment_responsibility || 'NONE';
  let vendorFee = roundMoney(body.vendor_fee || 0);
  let budgetedAmount = roundMoney(body.budgeted_amount || 0);
  if (paymentResponsibility === 'COORDINATOR') {
    vendorFee = 0;
  } else if (paymentResponsibility === 'VENDOR') {
    budgetedAmount = 0;
  }

  const normalizedEventTime = normalizeTime(body.event_time);
  const normalizedCloseTime = normalizeTime(body.event_close_time);
  const eventCloseDate = combineDateAndTime(body.event_close_date, normalizedCloseTime);
  const rawEventDurationHours = Number(body.event_duration_hours || 0);
  const rawEventDurationMinutes = Number(body.event_duration_minutes || 0);
  const eventDurationHours = Number.isFinite(rawEventDurationHours)
    ? Math.max(0, rawEventDurationHours)
    : 0;
  const eventDurationMinutes = Number.isFinite(rawEventDurationMinutes)
    ? Math.max(0, rawEventDurationMinutes)
    : 0;
  const hasLegacyDurationHours =
    body.event_duration_hours !== undefined &&
    body.event_duration_hours !== null &&
    body.event_duration_hours !== '';
  const totalEventDurationMinutes = hasLegacyDurationHours
    ? eventDurationHours * 60 + eventDurationMinutes
    : eventDurationMinutes;

  const normalized = normalizeMarketplaceEventLocation({
    ...body,
    status,
    service_type: serviceTypes[0] || body.service_type || null,
    service_types: serviceTypes,
    service_styles: serviceStyles,
    primary_service_style: primaryServiceStyle || null,
    alcohol_required: alcoholRequired,
    equipment_needed: equipmentNeeded,
    vendor_fee: vendorFee,
    budgeted_amount: budgetedAmount,
    payment_responsibility: paymentResponsibility,
    event_time: normalizedEventTime,
    event_duration_hours: 0,
    event_duration_minutes: totalEventDurationMinutes,
    event_close_time: normalizedCloseTime,
    event_close_date: eventCloseDate,
    draft_expires_at:
      isDraft && !existingEvent?.draft_expires_at
        ? new Date(Date.now() + DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000)
        : existingEvent?.draft_expires_at || null,
  });

  if (isDraft) {
    const draftRequiredFields = [
      ['event_name', 'Event name is required to save a draft.'],
      ['event_type', 'Event type is required to save a draft.'],
      ['event_visibility', 'Event visibility is required to save a draft.'],
    ];
    draftRequiredFields.forEach(([field, message]) => {
      if (normalized[field] == null || normalized[field] === '') {
        throw buildError(message, 400);
      }
    });
    return normalized;
  }

  const requiredFields = [
    ['event_name', 'Event name is required.'],
    ['event_type', 'Event type is required.'],
    ['primary_service_style', 'Primary service style is required.'],
    ['event_date', 'Event date is required.'],
    ['event_address', 'Event address is required.'],
    ['event_city', 'Event city is required.'],
    ['event_state', 'Event state is required.'],
    ['number_of_guests', 'Number of guests is required.'],
    ['event_close_date', 'Close date and time are required.'],
  ];
  requiredFields.forEach(([field, message]) => {
    if (normalized[field] == null || normalized[field] === '') {
      throw buildError(message, 400);
    }
  });
  if (
    Number(normalized.event_duration_minutes || 0) <= 0
  ) {
    throw buildError('Event duration is required.', 400);
  }

  if (normalized.event_type === 'Other' && !hasText(normalized.event_type_other)) {
    throw buildError('Other event type details are required.', 400);
  }
  if (serviceTypes.includes('Food Truck') && ['Plated', 'Formal'].includes(primaryServiceStyle)) {
    throw buildError('Food Truck cannot use Plated/Formal Service as its primary style.', 400);
  }
  if (alcoholRequired && !permitsRequired.includes('Alcohol')) {
    throw buildError('Alcohol Permit is required when Alcohol Service is selected.', 400);
  }
  if (paymentResponsibility === 'COORDINATOR' && budgetedAmount <= 0) {
    throw buildError('Budget amount is required when the event coordinator pays vendors.', 400);
  }
  if (paymentResponsibility === 'VENDOR' && vendorFee <= 0) {
    throw buildError('Vendor fee is required when vendors pay to attend.', 400);
  }
  if (paymentResponsibility === 'BOTH' && (budgetedAmount <= 0 || vendorFee <= 0)) {
    throw buildError('Budget amount and vendor fee are required when both parties pay.', 400);
  }
  if (['COORDINATOR', 'BOTH'].includes(paymentResponsibility)) {
    const minimumBudget = Number(normalized.number_of_guests || 0) * 25;
    if (budgetedAmount < minimumBudget) {
      throw buildError(`Budget amount must be at least $${minimumBudget.toFixed(2)} for this guest count.`, 400);
    }
  }

  normalized.number_of_guests = Number(normalized.number_of_guests);
  normalized.number_of_vendors_needed = normalizeMarketplaceVendorCount(normalized);
  normalized.draft_expires_at = null;
  normalized.archived_at = null;
  return normalized;
};

const sendEventClosedNotification = async (event) => {
  if (!event?.customer_user_id || event.close_notification_sent_at) {
    return;
  }
  try {
    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: event.customer_user_id,
      title: 'Event submissions closed',
      body: `${event.event_name || 'Your event'} is closed to new submissions.`,
      data: {
        notificationType: 'MARKETPLACE_EVENT_CLOSED',
        eventId: event.event_id,
      },
      metadata: { eventId: event.event_id },
    });
  } catch (error) {
    console.error('Marketplace close notification failed', {
      eventId: event.event_id,
      message: error.message,
    });
  }
};

const closeExpiredMarketplaceEvents = async () => {
  const now = new Date();
  const expiredEvents = await MarketplaceEventService.getByData(
    {
      status: { $in: ACTIVE_EVENT_STATUSES },
      event_close_date: { $lte: now },
    },
    { lean: true }
  );
  if (!expiredEvents.length) {
    return [];
  }
  await MarketplaceEventService.getModel().updateMany(
    { event_id: { $in: expiredEvents.map((event) => event.event_id) } },
    { $set: { status: 'CLOSED', closed_at: now } }
  );
  for (const event of expiredEvents) {
    await sendEventClosedNotification(event);
  }
  await MarketplaceEventService.getModel().updateMany(
    {
      event_id: { $in: expiredEvents.map((event) => event.event_id) },
      close_notification_sent_at: null,
    },
    { $set: { close_notification_sent_at: now } }
  );
  return expiredEvents.map((event) => event.event_id);
};

const archiveExpiredDrafts = async (customerUserId = null) => {
  const query = {
    status: 'DRAFT',
    draft_expires_at: { $lte: new Date() },
    archived_at: null,
  };
  if (customerUserId) {
    query.customer_user_id = customerUserId;
  }
  await MarketplaceEventService.getModel().updateMany(query, {
    $set: { status: 'CANCELLED', archived_at: new Date() },
  });
};

const assertEventOpenForSubmission = async (event) => {
  if (!event || !ACTIVE_EVENT_STATUSES.includes(event.status)) {
    throw buildError('This event is closed to new submissions.', 410);
  }
  if (event.event_close_date && new Date(event.event_close_date) <= new Date()) {
    await closeExpiredMarketplaceEvents();
    throw buildError('This event is closed to new submissions.', 410);
  }
};

const assertVendorCanSubmitRound = async (event, vendorUserId) => {
  const currentRound = event.current_submission_round || 1;
  const [previousBid, previousApplication] = await Promise.all([
    MarketplaceBidService.getByData(
      {
        event_id: event.event_id,
        vendor_user_id: vendorUserId,
        submission_round: currentRound,
        bid_status: { $nin: ['DRAFT', 'PENDING_SIGNATURE', 'WITHDRAWN'] },
      },
      { singleResult: true, lean: true }
    ),
    MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        vendor_user_id: vendorUserId,
        submission_round: currentRound,
        application_status: { $nin: ['DRAFT', 'PENDING_SIGNATURE', 'WITHDRAWN'] },
      },
      { singleResult: true, lean: true }
    ),
  ]);
  if (previousBid || previousApplication) {
    throw buildError('You already submitted for this event and cannot submit again after reopen.', 409);
  }
};

const normalizeOpaquePaymentData = (paymentData) => {
  if (!paymentData || typeof paymentData !== 'object') {
    return {
      opaqueToken: paymentData,
      dataDescriptor: null,
    };
  }

  const tokenSource =
    paymentData.opaqueToken && typeof paymentData.opaqueToken === 'object'
      ? paymentData.opaqueToken
      : paymentData.opaqueData && typeof paymentData.opaqueData === 'object'
      ? paymentData.opaqueData
      : paymentData;

  return {
    opaqueToken:
      tokenSource.dataValue ||
      tokenSource.opaqueToken ||
      tokenSource.rawToken ||
      tokenSource.token ||
      null,
    dataDescriptor: tokenSource.dataDescriptor || paymentData.dataDescriptor || null,
  };
};

const createPaymentAudit = (payment, req, action, note = null) =>
  MarketplacePaymentAuditService.create({
    payment_id: payment.payment_id,
    action,
    actor_user_id: req.user._id,
    actor_user_type: req.user.userType,
    note,
  });

const createAgreementAudit = ({
  event,
  payment = null,
  action,
  source = 'SYSTEM',
  message = null,
}) =>
  MarketplaceAgreementAuditService.create({
    event_id: event.event_id,
    payment_id: payment?.payment_id || event.award_payment_id || null,
    agreement_envelope_id: event.agreement_envelope_id || null,
    action,
    agreement_status: event.agreement_status || null,
    source,
    message,
  });

const BID_ATTACHMENT_TYPES = {
  BID_MENU_PDF: {
    folder: 'marketplace/bids/menu-pdfs',
    allowedMimeTypes: ['application/pdf'],
  },
  BID_IMAGE: {
    folder: 'marketplace/bids/images',
    allowedMimeTypes: ['image/png', 'image/jpg', 'image/jpeg', 'image/heic'],
  },
  APPLICATION_MENU_PDF: {
    folder: 'marketplace/applications/menu-pdfs',
    allowedMimeTypes: ['application/pdf'],
  },
  APPLICATION_IMAGE: {
    folder: 'marketplace/applications/images',
    allowedMimeTypes: ['image/png', 'image/jpg', 'image/jpeg', 'image/heic'],
  },
  PERMIT_LICENSE: {
    folder: 'marketplace/bids/permits-licenses',
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
    ],
  },
  AGREEMENT_DOCUMENT: {
    folder: 'marketplace/bids/agreement-documents',
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
    ],
  },
  REQUIREMENT_DOCUMENT: {
    folder: 'marketplace/requirements',
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpg',
      'image/jpeg',
    ],
  },
};

const isImageMimeType = (mimeType) => /^image\//i.test(mimeType || '');

const validateAttachmentFile = (file, attachmentType) => {
  if (!file) {
    throw buildError('No marketplace file uploaded', 400);
  }

  const config = BID_ATTACHMENT_TYPES[attachmentType];
  if (!config) {
    throw buildError('Unsupported marketplace attachment type', 400);
  }

  if (!config.allowedMimeTypes.includes(file.mimetype)) {
    throw buildError('Uploaded file type is not allowed for this attachment', 400);
  }

  return config;
};

const createFileAudit = (attachment, req, action, reason = null) =>
  MarketplaceFileAuditService.create({
    attachment_id: attachment.attachment_id,
    event_id: attachment.event_id,
    bid_id: attachment.bid_id,
    action,
    actor_user_id: req.user._id,
    actor_user_type: req.user.userType,
    reason,
  });

const toPlainObject = (value) => {
  if (!value) {
    return value;
  }

  if (typeof value.toObject === 'function') {
    return value.toObject();
  }

  return { ...value };
};

const getPaymentScenario = (event = {}) => {
  const coordinatorPays = roundMoney(event.budgeted_amount || 0) > 0;
  const vendorPays = roundMoney(event.vendor_fee || 0) > 0;

  if (coordinatorPays && vendorPays) {
    return 'BOTH';
  }
  if (vendorPays) {
    return 'VENDOR_PAYS';
  }
  if (coordinatorPays) {
    return 'COORDINATOR_PAYS';
  }

  return 'NO_PAYMENT';
};

const isAgreementSatisfied = (event = {}) =>
  !event.agreement_status ||
  ['NOT_REQUIRED', 'ACKNOWLEDGED', 'SIGNED'].includes(event.agreement_status);

const isCoordinatorPaymentSatisfied = (event = {}, bid = null, application = null) => {
  const coordinatorPays = roundMoney(event.budgeted_amount || 0) > 0;
  if (!coordinatorPays) {
    return true;
  }

  const matched =
    bid?.bid_status === 'AWARDED' ||
    ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'].includes(
      application?.application_status
    );

  if (!matched) {
    return false;
  }

  const awardPaymentSatisfied = ['PAID', 'NOT_REQUIRED'].includes(
    event.award_payment_status || 'NOT_REQUIRED'
  );

  return awardPaymentSatisfied && isAgreementSatisfied(event);
};

const isVendorPaymentSatisfied = (event = {}, bid = null, application = null) => {
  const vendorPays = roundMoney(event.vendor_fee || 0) > 0;
  if (!vendorPays) {
    return true;
  }

  if (bid) {
    return bid.payment_status === 'PAID' || bid.bid_status === 'SUBMITTED';
  }

  return (
    application?.payment_status === 'PAID' ||
    application?.application_status === 'PAID' ||
    application?.application_status === 'CONFIRMED' ||
    (application?.transaction_id && application?.payment_status === 'PAID')
  );
};

const getMarketplaceUnlockState = ({ event, bid = null, application = null }) => {
  const scenario = getPaymentScenario(event);
  const coordinatorPaymentSatisfied = isCoordinatorPaymentSatisfied(
    event,
    bid,
    application
  );
  const vendorPaymentSatisfied = isVendorPaymentSatisfied(event, bid, application);
  const matchSatisfied =
    bid?.bid_status === 'AWARDED' ||
    ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'].includes(
      application?.application_status
    );
  const detailsUnlocked =
    scenario === 'NO_PAYMENT'
      ? matchSatisfied
      : coordinatorPaymentSatisfied && vendorPaymentSatisfied;

  return {
    scenario,
    details_unlocked: !!detailsUnlocked,
    obligations: {
      match_satisfied: !!matchSatisfied,
      coordinator_payment_satisfied: !!coordinatorPaymentSatisfied,
      vendor_payment_satisfied: !!vendorPaymentSatisfied,
      agreement_satisfied: isAgreementSatisfied(event),
    },
  };
};

const normalizeRequirementLabel = (label) => {
  const value = String(label || '').trim();
  if (!value) {
    return null;
  }

  const match = DEFAULT_REQUIREMENT_LABELS.find(
    (item) => item.toLowerCase() === value.toLowerCase()
  );
  return match || value;
};

const getRequirementKey = (label) =>
  label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '_') : null;

const getReplacementAttachmentQuery = ({
  eventId,
  bidId = null,
  applicationId = null,
  attachmentType,
  requirementKey = null,
}) => {
  if (!['BID_MENU_PDF', 'APPLICATION_MENU_PDF', 'AGREEMENT_DOCUMENT', REQUIREMENT_ATTACHMENT_TYPE].includes(attachmentType)) {
    return null;
  }

  return {
    event_id: eventId,
    ...(bidId ? { bid_id: bidId } : {}),
    ...(applicationId ? { application_id: applicationId } : {}),
    attachment_type: attachmentType,
    status: 'ACTIVE',
    ...(attachmentType === REQUIREMENT_ATTACHMENT_TYPE
      ? { requirement_key: requirementKey }
      : {}),
  };
};

const archiveReplacementAttachments = async ({
  eventId,
  bidId = null,
  applicationId = null,
  attachmentType,
  requirementKey = null,
  actorUserId,
  reason,
}) => {
  const query = getReplacementAttachmentQuery({
    eventId,
    bidId,
    applicationId,
    attachmentType,
    requirementKey,
  });
  if (!query || (attachmentType === REQUIREMENT_ATTACHMENT_TYPE && !requirementKey)) {
    return [];
  }

  const existingAttachments = await MarketplaceAttachmentService.getByData(query, {
    lean: false,
  });
  for (const attachment of existingAttachments) {
    attachment.status = 'DELETED';
    attachment.status_reason = reason;
    attachment.status_updated_at = new Date();
    attachment.status_updated_by_user_id = actorUserId;
    attachment.deleted_at = new Date();
    attachment.deleted_by_user_id = actorUserId;
    await attachment.save();
    if (attachment.file_key) {
      await removeObject(attachment.file_key);
    }
  }

  return existingAttachments;
};

const getAnnualAgreementExpiry = () =>
  new Date(Date.now() + VENDOR_AGREEMENT_VALID_DAYS * 24 * 60 * 60 * 1000);

const getValidVendorAgreement = async (vendorUserId) =>
  MarketplaceVendorAgreementService.getByData(
    {
      vendor_user_id: vendorUserId,
      status: 'SIGNED',
      expires_at: { $gt: new Date() },
      governance_template_id: docusign.governanceTemplateId,
      nda_template_id: docusign.ndaTemplateId,
      governance_version: docusign.governanceVersion,
      nda_version: docusign.ndaVersion,
    },
    { singleResult: true, sort: { signed_at: -1 } }
  );

const isVendorAgreementSigned = async (vendorUserId) =>
  !!(await getValidVendorAgreement(vendorUserId));

const getVendorSignerInfo = (user) => ({
  signerName:
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'Vendor',
  signerEmail: user?.email,
});

const sendDeveloperAlert = async (subject, error, context = {}) => {
  try {
    await MailHelper.sendMail(
      docusign.developerAlertEmail,
      subject,
      `<p>${subject}</p><pre>${JSON.stringify(
        {
          message: error?.message || error,
          context,
        },
        null,
        2
      )}</pre>`
    );
  } catch (mailError) {
    console.error('Developer alert email failed', mailError?.message || mailError);
  }
};

const requireSignedVendorAgreementForSubmission = async (vendorUserId) => {
  if (await isVendorAgreementSigned(vendorUserId)) {
    return;
  }

  throw buildError('Vendor agreements must be signed before submission can continue.', 409);
};

const getVendorAgreementReturnUrl = (status = 'completed') =>
  `rounddacornervendor://docusign/return?status=${status}`;

const normalizeDocuSignReturnStatus = (status) => {
  const value = String(status || '').toLowerCase();
  if (['completed', 'cancelled', 'declined', 'error'].includes(value)) {
    return value;
  }
  return 'error';
};

const setSubmissionSignatureStatus = async (agreement, status) => {
  const nextStatus =
    status === 'SIGNED'
      ? 'PENDING_SIGNATURE'
      : status === 'ERROR' || status === 'CANCELLED' || status === 'DECLINED'
        ? 'DRAFT'
        : 'PENDING_SIGNATURE';

  if (agreement.bid_id) {
    await MarketplaceBidService.update(
      { bid_id: agreement.bid_id, vendor_user_id: agreement.vendor_user_id },
      {
        bid_status: nextStatus,
        agreement_provider: 'DOCUSIGN',
        agreement_status: status,
      },
      { getNew: false }
    );
  }

  if (agreement.application_id) {
    await MarketplaceApplicationService.update(
      {
        application_id: agreement.application_id,
        vendor_user_id: agreement.vendor_user_id,
      },
      {
        application_status: nextStatus,
        agreement_provider: 'DOCUSIGN',
        agreement_status: status,
      },
      { getNew: false }
    );
  }
};

const persistSignedAgreementAttachment = async (agreement) => {
  if (agreement.status !== 'SIGNED' || !agreement.envelope_id || !agreement.event_id) {
    return null;
  }

  const existingAttachment = await MarketplaceAttachmentService.getByData(
    {
      event_id: agreement.event_id,
      bid_id: agreement.bid_id || null,
      application_id: agreement.application_id || null,
      attachment_type: 'AGREEMENT_DOCUMENT',
      status: 'ACTIVE',
    },
    { singleResult: true, sort: { created_at: -1 } }
  );

  if (existingAttachment) {
    return existingAttachment;
  }

  const signedDocuments = await DocuSignHelper.downloadEnvelopeDocuments(
    agreement.envelope_id
  );
  const fileName = `RTC-Marketplace-Agreement-${
    agreement.bid_id || agreement.application_id || agreement.event_id
  }.pdf`;
  const { url, key } = await addObjectFromBufferWithKey(
    {
      buffer: signedDocuments,
      originalname: fileName,
      mimetype: 'application/pdf',
    },
    BID_ATTACHMENT_TYPES.AGREEMENT_DOCUMENT.folder
  );

  const attachment = await MarketplaceAttachmentService.create({
    event_id: agreement.event_id,
    bid_id: agreement.bid_id || null,
    application_id: agreement.application_id || null,
    attachment_type: 'AGREEMENT_DOCUMENT',
    file_url: url,
    file_key: key,
    original_name: fileName,
    mime_type: 'application/pdf',
    size_bytes: signedDocuments.length,
    uploaded_by_user_id: agreement.vendor_user_id,
  });

  if (agreement.bid_id) {
    await MarketplaceBidService.update(
      { bid_id: agreement.bid_id, vendor_user_id: agreement.vendor_user_id },
      {
        agreement_document_url: url,
        agreement_document_key: key,
      },
      { getNew: false }
    );
  }

  if (agreement.application_id) {
    await MarketplaceApplicationService.update(
      {
        application_id: agreement.application_id,
        vendor_user_id: agreement.vendor_user_id,
      },
      {
        agreement_document_url: url,
        agreement_document_key: key,
      },
      { getNew: false }
    );
  }

  return attachment;
};

const redactLockedMarketplaceEvent = (event, unlockState, { fullAccess = false } = {}) => {
  const plainEvent = toPlainObject(event);
  if (!plainEvent) {
    return plainEvent;
  }

  const marketplace_unlock = unlockState || {
    scenario: getPaymentScenario(plainEvent),
    details_unlocked: false,
    obligations: {
      match_satisfied: false,
      coordinator_payment_satisfied: false,
      vendor_payment_satisfied: false,
      agreement_satisfied: isAgreementSatisfied(plainEvent),
    },
  };

  if (fullAccess || marketplace_unlock.details_unlocked) {
    return {
      ...plainEvent,
      marketplace_unlock,
    };
  }

  const redacted = {
    ...plainEvent,
    marketplace_unlock,
    exact_address_locked: true,
    contracts_locked: true,
    logistics_locked: true,
  };

  [
    'event_address',
    'formatted_address',
    'geocoded_address',
    'latitude',
    'longitude',
    'place_id',
    'geocoding_provider',
    'geocoded_at',
    'agreement_envelope_id',
    'agreement_sent_at',
    'agreement_signed_at',
    'signed_document_url',
    'signer_name',
    'signer_email',
    'agreement_error_message',
    'logistics_packet_url',
    'logistics_packet_key',
    'event_brief_url',
    'event_brief_key',
    'private_documents',
    'coordinator_documents',
  ].forEach((field) => {
    delete redacted[field];
  });

  return redacted;
};

const redactLockedMarketplaceRecord = (
  record,
  unlockState,
  { fullAccess = false } = {}
) => {
  const plainRecord = toPlainObject(record);
  if (!plainRecord || fullAccess || unlockState?.details_unlocked) {
    return plainRecord;
  }

  const redacted = {
    ...plainRecord,
    marketplace_unlock: unlockState,
    private_details_locked: true,
  };

  [
    'phone',
    'email',
    'business_name',
    'contact_name',
    'food_type_cuisine',
    'notes',
    'agreement_document_url',
    'agreement_document_key',
    'signed_document_url',
    'agreement_envelope_id',
    'agreement_sent_at',
    'agreement_signed_at',
    'signer_name',
    'signer_email',
    'agreement_error_message',
    'permit_license_urls',
    'permit_license_keys',
    'private_documents',
    'coordinator_documents',
  ].forEach((field) => {
    delete redacted[field];
  });

  if (redacted.vendor_user_id && typeof redacted.vendor_user_id === 'object') {
    redacted.vendor_user_id = {
      _id: redacted.vendor_user_id._id,
    };
  }

  if (redacted.food_truck_id) {
    redacted.vendor_display_id = getVendorDisplayId(redacted.food_truck_id);
    redacted.food_truck_id = {
      _id:
        typeof redacted.food_truck_id === 'object'
          ? redacted.food_truck_id._id
          : redacted.food_truck_id,
      display_id: redacted.vendor_display_id,
    };
  }

  return redacted;
};

const isSensitiveMarketplaceAttachment = (attachment = {}) =>
  [
    'PERMIT_LICENSE',
    'REQUIREMENT_DOCUMENT',
    'AGREEMENT_DOCUMENT',
    'EVENT_BRIEF',
    'LOGISTICS_PACKET',
    'PRIVATE_DOCUMENT',
    'COMPLIANCE_DOCUMENT',
  ].includes(attachment.attachment_type);

const filterLockedAttachments = (attachments = [], unlockState, { fullAccess = false } = {}) => {
  if (fullAccess || unlockState?.details_unlocked) {
    return attachments;
  }

  return attachments.filter(
    (attachment) => !isSensitiveMarketplaceAttachment(attachment)
  );
};

const assertCustomerAttachmentUnlocked = async (attachment, event) => {
  if (!isSensitiveMarketplaceAttachment(attachment)) {
    return;
  }

  const [bid, application] = await Promise.all([
    attachment.bid_id
      ? MarketplaceBidService.getByData(
          { bid_id: attachment.bid_id },
          { singleResult: true, lean: true }
        )
      : null,
    attachment.application_id
      ? MarketplaceApplicationService.getByData(
          { application_id: attachment.application_id },
          { singleResult: true, lean: true }
        )
      : null,
  ]);
  const unlockState = getMarketplaceUnlockState({ event, bid, application });
  if (!unlockState.details_unlocked) {
    throw buildError(
      'Marketplace file unlock requires the required payment or match condition',
      403
    );
  }
};

const getAccessibleAttachment = async (attachmentId, user) => {
  const attachment = await MarketplaceAttachmentService.getByData(
    { attachment_id: attachmentId },
    { singleResult: true }
  );

  if (!attachment) {
    throw buildError('Marketplace repository file not found', 404);
  }

  if (user.userType === 'SUPER_ADMIN') {
    return attachment;
  }

  if (user.userType === 'CUSTOMER') {
    const event = await getOwnedEvent(attachment.event_id, user._id);
    await assertCustomerAttachmentUnlocked(attachment, event);
    return attachment;
  }

  if (user.userType === 'VENDOR') {
    if (!attachment.bid_id && !attachment.application_id) {
      throw buildError('Marketplace repository file not found', 404);
    }
    const bid = attachment.bid_id
      ? await getOwnedBid(attachment.bid_id, user._id)
      : null;
    const application = attachment.application_id
      ? await getOwnedApplication(attachment.application_id, user._id)
      : null;
    return attachment;
  }

  throw buildError('You do not have access to this marketplace file', 403);
};

const decorateRepositoryFiles = async (attachments = []) => {
  const eventIds = [
    ...new Set(attachments.map((item) => item.event_id).filter(Boolean)),
  ];
  const bidIds = [...new Set(attachments.map((item) => item.bid_id).filter(Boolean))];
  const applicationIds = [
    ...new Set(attachments.map((item) => item.application_id).filter(Boolean)),
  ];

  const [events, bids, applications] = await Promise.all([
    eventIds.length
      ? MarketplaceEventService.getByData(
          { event_id: { $in: eventIds } },
          { lean: true }
        )
      : [],
    bidIds.length
      ? MarketplaceBidService.getByData(
          { bid_id: { $in: bidIds } },
          { lean: true }
        )
      : [],
    applicationIds.length
      ? MarketplaceApplicationService.getByData(
          { application_id: { $in: applicationIds } },
          { lean: true }
        )
      : [],
  ]);

  const eventById = events.reduce((acc, event) => {
    acc[event.event_id] = event;
    return acc;
  }, {});
  const bidById = bids.reduce((acc, bid) => {
    acc[bid.bid_id] = bid;
    return acc;
  }, {});
  const applicationById = applications.reduce((acc, application) => {
    acc[application.application_id] = application;
    return acc;
  }, {});

  return attachments.map((attachment) => {
    const event = eventById[attachment.event_id] || null;
    const bid = attachment.bid_id ? bidById[attachment.bid_id] || null : null;
    const application = attachment.application_id
      ? applicationById[attachment.application_id] || null
      : null;
    return {
      ...attachment,
      marketplaceEvent: event
        ? {
            event_id: event.event_id,
            event_name: event.event_name,
            customer_user_id: event.customer_user_id,
          }
        : null,
      marketplaceBid: bid
        ? {
            bid_id: bid.bid_id,
            vendor_user_id: bid.vendor_user_id,
            food_truck_id: bid.food_truck_id,
            bid_status: bid.bid_status,
          }
        : null,
      marketplaceApplication: application
        ? {
            application_id: application.application_id,
            vendor_user_id: application.vendor_user_id,
            food_truck_id: application.food_truck_id,
            application_status: application.application_status,
          }
        : null,
      vendor_user_id: bid?.vendor_user_id || application?.vendor_user_id || null,
      food_truck_id: bid?.food_truck_id || application?.food_truck_id || null,
    };
  });
};

const getVendorMarketplaceFoodTruck = async (userId) => {
  const vendorUser = await UserService.getById(userId);
  if (!vendorUser || vendorUser.inactive || vendorUser.verified === false) {
    throw buildError('Verification Pending or Action Required.', 403);
  }

  const foodTruck = await FoodTruckService.getByData(
    { userId },
    { singleResult: true, populate: ['addOns', 'planId'] }
  );

  if (!foodTruck) {
    throw buildError('Food truck not found', 404);
  }

  if (foodTruck.inactive || foodTruck.verified === false) {
    throw buildError('Verification Pending or Action Required.', 403);
  }

  if (!canAccessEventMarketplace(foodTruck)) {
    throw buildError(
      'Accept Event Bookings is required to access Event Marketplace.',
      403
    );
  }

  return foodTruck;
};

const assertCustomerEventCoordinator = async (userId) => {
  const customer = await UserService.getById(userId);
  if (
    !customer ||
    !customer.isEventCoordinator ||
    !customer.eventCoordinatorTaxIdEncrypted &&
    !customer.eventCoordinatorEin
  ) {
    throw buildError(
      'Event coordination profile with tax ID is required to access My Events.',
      403
    );
  }

  return customer;
};

const getOwnedEvent = async (eventId, userId) => {
  await assertCustomerEventCoordinator(userId);
  const event = await MarketplaceEventService.getByData(
    { event_id: eventId, customer_user_id: userId },
    { singleResult: true }
  );

  if (!event) {
    throw buildError('Marketplace event not found', 404);
  }

  return event;
};

const getOwnedBid = async (bidId, userId) => {
  const bid = await MarketplaceBidService.getByData(
    { bid_id: bidId, vendor_user_id: userId },
    { singleResult: true }
  );

  if (!bid) {
    throw buildError('Marketplace bid not found', 404);
  }

  return bid;
};

const getOwnedApplication = async (applicationId, userId) => {
  const application = await MarketplaceApplicationService.getByData(
    { application_id: applicationId, vendor_user_id: userId },
    { singleResult: true }
  );

  if (!application) {
    throw buildError('Marketplace application not found', 404);
  }

  return application;
};

const getEventForUser = async (eventId, user) => {
  if (user.userType === 'CUSTOMER') {
    return getOwnedEvent(eventId, user._id);
  }

  if (user.userType === 'VENDOR') {
    await getVendorMarketplaceFoodTruck(user._id);
    const event = await MarketplaceEventService.getByData(
      { event_id: eventId },
      { singleResult: true }
    );

    if (!event) {
      throw buildError('Marketplace event not found', 404);
    }

    if (ACTIVE_EVENT_STATUSES.includes(event.status)) {
      return event;
    }

    const vendorBid = await MarketplaceBidService.getByData(
      {
        event_id: eventId,
        vendor_user_id: user._id,
        bid_status: { $nin: ['WITHDRAWN'] },
      },
      { singleResult: true }
    );

    if (!vendorBid) {
      throw buildError('Marketplace event not found', 404);
    }

    return event;
  }

  if (user.userType === 'SUPER_ADMIN') {
    const event = await MarketplaceEventService.getByData(
      { event_id: eventId },
      { singleResult: true }
    );

    if (!event) {
      throw buildError('Marketplace event not found', 404);
    }

    return event;
  }

  throw buildError('You do not have access to this marketplace event', 403);
};

const getQuestionEventForUser = async (eventId, user) => {
  if (user.userType === 'CUSTOMER') {
    return getOwnedEvent(eventId, user._id);
  }

  return getEventForUser(eventId, user);
};

const getQuestionForEvent = async (eventId, questionId) => {
  const question = await MarketplaceEventQuestionService.getByData(
    { event_id: eventId, question_id: questionId },
    { singleResult: true }
  );

  if (!question) {
    throw buildError('Marketplace event question not found', 404);
  }

  return question;
};

const sanitizeMarketplaceQuestion = (question, { includeBlocked = false } = {}) => {
  const plainQuestion = toPlainObject(question);
  const isBlocked = plainQuestion.status === 'BLOCKED';

  return {
    question_id: plainQuestion.question_id,
    event_id: plainQuestion.event_id,
    vendor_display_id: plainQuestion.vendor_display_id,
    question_text:
      isBlocked && !includeBlocked
        ? null
        : plainQuestion.question_text_public,
    answer_text:
      plainQuestion.answer_moderation_status === 'BLOCKED'
        ? null
        : plainQuestion.answer_text_public,
    status: plainQuestion.status,
    moderation_status: plainQuestion.question_moderation_status,
    moderation_reasons:
      includeBlocked && isBlocked ? plainQuestion.question_moderation_reasons : [],
    created_at: plainQuestion.created_at,
    answered_at: plainQuestion.answered_at,
  };
};

const notifyCoordinatorOfMarketplaceQuestion = async (event) => {
  if (!event?.customer_user_id) {
    return;
  }

  try {
    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: event.customer_user_id,
      title: 'New marketplace question',
      body: `${event.event_name || 'Your event'} has a new vendor question.`,
      data: {
        notificationType: 'MARKETPLACE_EVENT_QUESTION',
        eventId: event.event_id,
      },
      metadata: { eventId: event.event_id },
    });
  } catch (error) {
    console.error('Marketplace question notification failed', {
      eventId: event.event_id,
      message: error.message,
    });
  }
};

const getQuestionAudienceVendorIds = async (eventId, askingVendorUserId) => {
  const [bids, applications] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: eventId, bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      { event_id: eventId, application_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
  ]);

  return [
    ...new Set(
      [askingVendorUserId, ...bids.map((bid) => bid.vendor_user_id), ...applications.map((item) => item.vendor_user_id)]
        .filter(Boolean)
        .map(String)
    ),
  ];
};

const notifyVendorsOfMarketplaceAnswer = async (event, question) => {
  const vendorIds = await getQuestionAudienceVendorIds(
    event.event_id,
    question.vendor_user_id
  );
  if (!vendorIds.length) {
    return;
  }

  try {
    await MarketplaceCommunications.sendMarketplaceCommunications(
      vendorIds.map((userId) => ({
        userId,
        title: 'Marketplace question answered',
        body: `${event.event_name || 'An event'} has a new public answer.`,
        data: {
          notificationType: 'MARKETPLACE_EVENT_ANSWER',
          eventId: event.event_id,
          questionId: question.question_id,
        },
        metadata: { eventId: event.event_id, questionId: question.question_id },
      }))
    );
  } catch (error) {
    console.error('Marketplace answer notification failed', {
      eventId: event.event_id,
      questionId: question.question_id,
      message: error.message,
    });
  }
};

const IMPORTANT_EVENT_CHANGE_FIELDS = {
  event_start_date: 'Date/time',
  event_date: 'Date/time',
  event_time: 'Date/time',
  event_duration_hours: 'Event duration',
  event_duration_minutes: 'Event duration',
  event_close_date: 'Close date/time',
  event_close_time: 'Close date/time',
  address: 'Address/location',
  formatted_address: 'Address/location',
  location: 'Address/location',
  latitude: 'Address/location',
  longitude: 'Address/location',
  guest_count: 'Guest count',
  budgeted_amount: 'Budget/vendor fee setup',
  vendor_fee: 'Budget/vendor fee setup',
  payment_responsibility: 'Budget/vendor fee setup',
  primary_service_style: 'Service type/style',
  service_type: 'Service type/style',
  service_types: 'Service type/style',
  equipment_needs: 'Equipment needs',
  alcohol_requirements: 'Alcohol requirements',
};

const URGENT_EVENT_CHANGE_FIELDS = new Set([
  'event_start_date',
  'event_date',
  'event_time',
  'address',
  'formatted_address',
  'location',
  'latitude',
  'longitude',
]);

const normalizeCompareValue = (value) => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCompareValue(item));
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value ?? null;
};

const getImportantEventChanges = (beforeEvent, afterEvent) => {
  const before = toPlainObject(beforeEvent) || {};
  const after = toPlainObject(afterEvent) || {};

  return Object.keys(IMPORTANT_EVENT_CHANGE_FIELDS)
    .filter((field) => {
      const beforeValue = normalizeCompareValue(before[field]);
      const afterValue = normalizeCompareValue(after[field]);
      return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
    })
    .map((field) => ({
      field,
      label: IMPORTANT_EVENT_CHANGE_FIELDS[field],
      urgent: URGENT_EVENT_CHANGE_FIELDS.has(field),
    }));
};

const getEventParticipantVendorIds = async (eventId) => {
  const [bids, applications] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: eventId, bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      { event_id: eventId, application_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
  ]);

  return [
    ...new Set(
      [...bids, ...applications]
        .map((item) => item.vendor_user_id)
        .filter(Boolean)
        .map(String)
    ),
  ];
};

const notifyMarketplaceSubmission = async ({ event, vendorUserId, submissionType, requiresPayment = false }) => {
  const label = submissionType === 'application' ? 'application' : 'bid';
  const vendorMessages = [
    {
      userId: vendorUserId,
      title: requiresPayment ? 'Action required' : `Marketplace ${label} submitted`,
      body: requiresPayment
        ? `${event.event_name || 'An event'} requires payment before your ${label} is submitted.`
        : `Your marketplace ${label} for ${event.event_name || 'an event'} was submitted successfully.`,
      data: {
        notificationType: requiresPayment
          ? 'MARKETPLACE_ACTION_REQUIRED'
          : 'MARKETPLACE_SUBMISSION_CONFIRMED',
        eventId: event.event_id,
      },
      channels: requiresPayment ? ['push', 'email', 'sms'] : ['push', 'email'],
      smsBody: requiresPayment
        ? `RTC action required: payment is needed before your marketplace ${label} is submitted. Open the app to continue.`
        : null,
      metadata: { eventId: event.event_id, submissionType },
    },
  ];

  const coordinatorMessages = requiresPayment
    ? []
    : [
        {
          userId: event.customer_user_id,
          title: `New marketplace ${label}`,
          body: `${event.event_name || 'Your event'} has a new vendor ${label}.`,
          data: {
            notificationType: 'MARKETPLACE_SUBMISSION_RECEIVED',
            eventId: event.event_id,
          },
          metadata: { eventId: event.event_id, submissionType },
        },
      ];

  await MarketplaceCommunications.sendMarketplaceCommunications([
    ...vendorMessages,
    ...coordinatorMessages,
  ]);
};

const notifyBidAwardOutcomes = async (event, selectedBidIds = []) => {
  const bids = await MarketplaceBidService.getByData(
    { event_id: event.event_id, bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
    { lean: true }
  );
  const selected = new Set(selectedBidIds.map(String));

  await MarketplaceCommunications.sendMarketplaceCommunications(
    bids.map((bid) => {
      const wasSelected = selected.has(String(bid.bid_id));
      return {
        userId: bid.vendor_user_id,
        title: wasSelected ? 'Marketplace bid accepted' : 'Marketplace bid not selected',
        body: wasSelected
          ? `${event.event_name || 'An event'} selected your marketplace bid. Open the app to view the next steps.`
          : `${event.event_name || 'An event'} has closed selection and your bid was not selected.`,
        data: {
          notificationType: wasSelected
            ? 'MARKETPLACE_BID_ACCEPTED'
            : 'MARKETPLACE_BID_NOT_SELECTED',
          eventId: event.event_id,
          bidId: bid.bid_id,
        },
        channels: wasSelected ? ['push', 'email', 'sms'] : ['push', 'email'],
        smsBody: wasSelected
          ? 'RTC alert: your marketplace bid was accepted. Open the app for next steps.'
          : null,
        metadata: { eventId: event.event_id, bidId: bid.bid_id },
      };
    })
  );
};

const notifyCoordinatorOfMatchLocked = async (event) => {
  if (!event?.customer_user_id) {
    return;
  }

  await MarketplaceCommunications.sendMarketplaceCommunication({
    userId: event.customer_user_id,
    title: 'Marketplace match locked',
    body: `${event.event_name || 'Your event'} has completed selection. Vendor details and event files are available in the app.`,
    data: {
      notificationType: 'MARKETPLACE_MATCH_LOCKED',
      eventId: event.event_id,
    },
    metadata: { eventId: event.event_id },
  });
};

const notifyVendorMatchLocked = async ({ event, vendorUserId }) => {
  await MarketplaceCommunications.sendMarketplaceCommunication({
    userId: vendorUserId,
    title: 'Marketplace match locked',
    body: `${event.event_name || 'An event'} is locked. Details, contracts, and logistics are available in the app when released.`,
    data: {
      notificationType: 'MARKETPLACE_MATCH_LOCKED',
      eventId: event.event_id,
    },
    channels: ['push', 'email', 'sms'],
    smsBody: 'RTC alert: your marketplace match is locked. Open the app for details and next steps.',
    metadata: { eventId: event.event_id },
  });
};

const getUserName = (user, fallback = 'there') =>
  [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
  user?.name ||
  user?.email ||
  fallback;

const formatEventSummaryHtml = (event) => `
  <p><strong>Event:</strong> ${event?.event_name || event?.event_id || 'Marketplace event'}</p>
  <p><strong>Date:</strong> ${event?.event_date || 'Not set'}</p>
  <p><strong>Time:</strong> ${event?.event_time || 'Not set'}</p>
  <p><strong>Location:</strong> ${
    event?.formatted_address || event?.event_address || 'Not provided'
  }</p>
  <p><strong>Guest count:</strong> ${event?.number_of_guests || 'Not provided'}</p>
`;

const attachmentToEmailFile = async (attachment) => {
  if (!attachment?.file_url) {
    return null;
  }

  const response = await fetch(attachment.file_url);
  if (!response.ok) {
    throw new Error(
      `Unable to fetch marketplace attachment ${attachment.attachment_id}`
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    content: buffer.toString('base64'),
    filename:
      attachment.original_name ||
      `${attachment.requirement_label || attachment.attachment_type || 'document'}.pdf`,
    type: attachment.mime_type || 'application/octet-stream',
    disposition: 'attachment',
  };
};

const collectVendorEmailAttachments = async ({ bid = null, application = null }) => {
  const attachmentQuery = {
    status: 'ACTIVE',
    ...(bid ? { bid_id: bid.bid_id } : {}),
    ...(application ? { application_id: application.application_id } : {}),
  };
  const collectedAttachments = await MarketplaceAttachmentService.getByData(
    attachmentQuery,
    { sort: { created_at: 1 }, lean: true }
  );
  const emailAttachments = [];

  for (const attachment of collectedAttachments) {
    try {
      const emailAttachment = await attachmentToEmailFile(attachment);
      if (emailAttachment) {
        emailAttachments.push(emailAttachment);
      }
    } catch (error) {
      await sendDeveloperAlert('Marketplace attachment email fetch error', error, {
        attachment_id: attachment.attachment_id,
        bid_id: bid?.bid_id || null,
        application_id: application?.application_id || null,
      });
    }
  }

  const agreement = await MarketplaceVendorAgreementService.getByData(
    {
      vendor_user_id: bid?.vendor_user_id || application?.vendor_user_id,
      status: 'SIGNED',
      envelope_id: { $ne: null },
    },
    { singleResult: true, sort: { signed_at: -1 } }
  );

  if (agreement?.envelope_id) {
    try {
      const signedDocuments = await DocuSignHelper.downloadEnvelopeDocuments(
        agreement.envelope_id
      );
      emailAttachments.push({
        content: signedDocuments.toString('base64'),
        filename: 'RTC Vendor Agreements.pdf',
        type: 'application/pdf',
        disposition: 'attachment',
      });
    } catch (error) {
      await sendDeveloperAlert('DocuSign signed document email fetch error', error, {
        agreement_id: agreement.agreement_id,
        envelope_id: agreement.envelope_id,
      });
    }
  }

  return emailAttachments;
};

const sendMarketplaceInformationEmailsIfUnlocked = async ({
  event,
  bid = null,
  application = null,
}) => {
  const unlockState = getMarketplaceUnlockState({ event, bid, application });
  if (!unlockState.details_unlocked) {
    return;
  }

  const [coordinator, vendor] = await Promise.all([
    UserService.getById(event.customer_user_id),
    UserService.getById(bid?.vendor_user_id || application?.vendor_user_id),
  ]);

  const emailAttachments = await collectVendorEmailAttachments({ bid, application });
  const vendorName = getUserName(vendor, 'Vendor');
  const coordinatorName = getUserName(coordinator, 'Event Coordinator');
  const submissionLabel = bid?.bid_id || application?.application_id || 'submission';

  if (coordinator?.email) {
    await MailHelper.sendMail(
      coordinator.email,
      `RTC Marketplace vendor information - ${event.event_name || event.event_id}`,
      `
        <p>${coordinatorName},</p>
        <p>The marketplace payment requirements are complete. Vendor information and collected documents are attached.</p>
        ${formatEventSummaryHtml(event)}
        <p><strong>Vendor:</strong> ${vendorName}</p>
        <p><strong>Submission:</strong> ${submissionLabel}</p>
      `,
      { attachments: emailAttachments }
    );
  }

  if (vendor?.email) {
    await MailHelper.sendMail(
      vendor.email,
      `RTC Marketplace coordinator information - ${event.event_name || event.event_id}`,
      `
        <p>${vendorName},</p>
        <p>The marketplace payment requirements are complete. Coordinator information is below.</p>
        ${formatEventSummaryHtml(event)}
        <p><strong>Coordinator:</strong> ${coordinatorName}</p>
        <p><strong>Email:</strong> ${coordinator?.email || 'Not provided'}</p>
        <p><strong>Phone:</strong> ${coordinator?.phone || coordinator?.phoneNumber || 'Not provided'}</p>
      `
    );
  }
};

const notifyVendorsOfEventChanges = async (event, changes = []) => {
  if (!changes.length) {
    return;
  }

  const vendorIds = await getEventParticipantVendorIds(event.event_id);
  if (!vendorIds.length) {
    return;
  }

  const labels = [...new Set(changes.map((change) => change.label))].join(', ');
  const isUrgent = changes.some((change) => change.urgent);

  await MarketplaceCommunications.sendMarketplaceCommunications(
    vendorIds.map((userId) => ({
      userId,
      title: 'Marketplace event updated',
      body: `${event.event_name || 'An event'} has updated event details: ${labels}.`,
      data: {
        notificationType: 'MARKETPLACE_EVENT_UPDATED',
        eventId: event.event_id,
      },
      channels: isUrgent ? ['push', 'email', 'sms'] : ['push', 'email'],
      smsBody: isUrgent
        ? 'RTC alert: important marketplace event details changed. Open the app to review.'
        : null,
      metadata: { eventId: event.event_id, changedFields: changes.map((item) => item.field) },
    }))
  );
};

const notifyVendorsOfEventCancellation = async (event) => {
  const vendorIds = await getEventParticipantVendorIds(event.event_id);
  if (!vendorIds.length) {
    return;
  }

  await MarketplaceCommunications.sendMarketplaceCommunications(
    vendorIds.map((userId) => ({
      userId,
      title: 'Marketplace event canceled',
      body: `${event.event_name || 'An event'} has been canceled.`,
      data: {
        notificationType: 'MARKETPLACE_EVENT_CANCELLED',
        eventId: event.event_id,
      },
      channels: ['push', 'email', 'sms'],
      smsBody: 'RTC alert: a marketplace event you engaged with was canceled. Open the app for details.',
      metadata: { eventId: event.event_id },
    }))
  );
};

const notifyClosedWithoutAward = async (event) => {
  const [bids, applications, awardedBids, awardedApplications] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: event.event_id, bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      { event_id: event.event_id, application_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
    MarketplaceBidService.getByData(
      { event_id: event.event_id, bid_status: 'AWARDED' },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
      },
      { lean: true }
    ),
  ]);

  if (!bids.length && !applications.length) {
    return;
  }
  if (awardedBids.length || awardedApplications.length) {
    return;
  }

  const vendorIds = [
    ...new Set(
      [...bids, ...applications]
        .map((item) => item.vendor_user_id)
        .filter(Boolean)
        .map(String)
    ),
  ];

  await MarketplaceCommunications.sendMarketplaceCommunications([
    {
      userId: event.customer_user_id,
      title: 'Marketplace event closed with no award',
      body: `${event.event_name || 'Your event'} was closed after receiving submissions, but no vendor was awarded.`,
      data: {
        notificationType: 'MARKETPLACE_EVENT_CLOSED_NO_AWARD',
        eventId: event.event_id,
      },
      metadata: { eventId: event.event_id },
    },
    ...vendorIds.map((userId) => ({
      userId,
      title: 'Marketplace event closed',
      body: `${event.event_name || 'An event'} was closed and no vendor was awarded.`,
      data: {
        notificationType: 'MARKETPLACE_EVENT_CLOSED_NO_AWARD',
        eventId: event.event_id,
      },
      channels: ['push', 'email'],
      metadata: { eventId: event.event_id },
    })),
  ]);
};

const attachEventsToBids = async (bids = [], options = {}) => {
  const eventIds = [...new Set(bids.map((bid) => bid.event_id).filter(Boolean))];
  if (!eventIds.length) {
    return bids;
  }

  const events = await MarketplaceEventService.getByData(
    { event_id: { $in: eventIds } },
    { lean: true }
  );
  const eventById = events.reduce((acc, event) => {
    acc[event.event_id] = event;
    return acc;
  }, {});

  return bids.map((bid) => {
    const event = eventById[bid.event_id] || null;
    const unlockState = event
      ? getMarketplaceUnlockState({ event, bid })
      : null;
    const visibleBid =
      options.redactRecord === false
        ? toPlainObject(bid)
        : redactLockedMarketplaceRecord(bid, unlockState, options);
    return {
      ...visibleBid,
      marketplace_unlock: unlockState,
      marketplaceEvent: event
        ? redactLockedMarketplaceEvent(event, unlockState, options)
        : null,
    };
  });
};

const attachEventsToApplications = async (applications = [], options = {}) => {
  const eventIds = [
    ...new Set(applications.map((item) => item.event_id).filter(Boolean)),
  ];
  if (!eventIds.length) {
    return applications;
  }

  const events = await MarketplaceEventService.getByData(
    { event_id: { $in: eventIds } },
    { lean: true }
  );
  const eventById = events.reduce((acc, event) => {
    acc[event.event_id] = event;
    return acc;
  }, {});

  return applications.map((application) => {
    const event = eventById[application.event_id] || null;
    const unlockState = event
      ? getMarketplaceUnlockState({ event, application })
      : null;
    const visibleApplication =
      options.redactRecord === false
        ? toPlainObject(application)
        : redactLockedMarketplaceRecord(application, unlockState, options);
    return {
      ...visibleApplication,
      marketplace_unlock: unlockState,
      marketplaceEvent: event
        ? redactLockedMarketplaceEvent(event, unlockState, options)
        : null,
    };
  });
};

const attachFilesToBids = async (bids = [], options = {}) => {
  const bidIds = [...new Set(bids.map((bid) => bid.bid_id).filter(Boolean))];
  if (!bidIds.length) {
    return bids;
  }

  const attachments = await MarketplaceAttachmentService.getByData(
    { bid_id: { $in: bidIds }, status: 'ACTIVE' },
    { sort: { created_at: 1 }, lean: true }
  );
  const attachmentsByBidId = attachments.reduce((acc, attachment) => {
    acc[attachment.bid_id] = acc[attachment.bid_id] || [];
    acc[attachment.bid_id].push(attachment);
    return acc;
  }, {});

  return bids.map((bid) => ({
    ...bid,
    attachments: filterLockedAttachments(
      attachmentsByBidId[bid.bid_id] || [],
      bid.marketplace_unlock,
      options
    ),
  }));
};

const attachFilesToApplications = async (applications = [], options = {}) => {
  const applicationIds = [
    ...new Set(applications.map((item) => item.application_id).filter(Boolean)),
  ];
  if (!applicationIds.length) {
    return applications;
  }

  const attachments = await MarketplaceAttachmentService.getByData(
    { application_id: { $in: applicationIds }, status: 'ACTIVE' },
    { sort: { created_at: 1 }, lean: true }
  );
  const attachmentsByApplicationId = attachments.reduce((acc, attachment) => {
    acc[attachment.application_id] = acc[attachment.application_id] || [];
    acc[attachment.application_id].push(attachment);
    return acc;
  }, {});

  return applications.map((application) => ({
    ...application,
    attachments: filterLockedAttachments(
      attachmentsByApplicationId[application.application_id] || [],
      application.marketplace_unlock,
      options
    ),
  }));
};

const findActiveMarketplacePayment = async (query) =>
  MarketplacePaymentService.getByData(
    {
      ...query,
      payment_status: { $in: ['PENDING', 'PAID'] },
    },
    { singleResult: true }
  );

const finalizePaidVendorPayment = async (payment) => {
  if (payment.payment_type !== 'VENDOR_EVENT_FEE') {
    return null;
  }

  if (payment.application_id) {
    const existingApplication = await MarketplaceApplicationService.getByData(
      { application_id: payment.application_id },
      { singleResult: true }
    );
    const application = await MarketplaceApplicationService.update(
      { application_id: payment.application_id },
      {
        application_status: 'PAID',
        payment_id: payment.payment_id,
        payment_status: 'PAID',
        paid_at: new Date(),
        transaction_id: payment.processor_transaction_id || null,
      },
      { getNew: true }
    );

    if (existingApplication?.payment_status !== 'PAID') {
      const event = await MarketplaceEventService.getByData(
        { event_id: payment.event_id },
        { singleResult: true }
      );
      if (event) {
        await notifyCoordinatorOfMatchLocked(event);
        await notifyVendorMatchLocked({
          event,
          vendorUserId: application.vendor_user_id,
        });
        await sendMarketplaceInformationEmailsIfUnlocked({
          event,
          application,
        });
      }
    }

    return { marketplaceApplication: application };
  }

  if (!payment.bid_id) {
    return null;
  }

  const existingBid = await MarketplaceBidService.getByData(
    { bid_id: payment.bid_id },
    { singleResult: true }
  );
  const bid = await MarketplaceBidService.update(
    { bid_id: payment.bid_id },
    {
      bid_status: 'SUBMITTED',
      submitted_at: new Date(),
      payment_id: payment.payment_id,
      payment_status: 'PAID',
    },
    { getNew: true }
  );

  if (existingBid?.payment_status !== 'PAID') {
    const event = await MarketplaceEventService.getByData(
      { event_id: payment.event_id },
      { singleResult: true }
    );
    if (event) {
      await notifyMarketplaceSubmission({
        event,
        vendorUserId: bid.vendor_user_id,
        submissionType: 'bid',
        requiresPayment: false,
      });
    }
  }

  return { marketplaceBid: bid };
};

const completeSignedAward = async (payment) => {
  if (payment.payment_type !== 'COORDINATOR_AWARD_FEE') {
    return null;
  }

  const selectedBidIds = payment.selected_bid_ids || [];
  if (!selectedBidIds.length) {
    return null;
  }

  const existingEvent = await MarketplaceEventService.getByData(
    { event_id: payment.event_id },
    { singleResult: true }
  );
  const alreadyAwarded = existingEvent?.status === 'AWARDED';

  await MarketplaceBidService.getModel().updateMany(
    { event_id: payment.event_id, bid_id: { $in: selectedBidIds } },
    { $set: { bid_status: 'AWARDED' } }
  );

  await MarketplaceBidService.getModel().updateMany(
    { event_id: payment.event_id, bid_id: { $nin: selectedBidIds } },
    { $set: { bid_status: 'NOT_AWARDED' } }
  );

  const marketplaceEvent = await MarketplaceEventService.update(
    { event_id: payment.event_id },
    {
      status: 'AWARDED',
      award_payment_id: payment.payment_id,
      award_payment_status: 'PAID',
    },
    { getNew: true }
  );
  await MarketplaceEventQuestionService.updateMany(
    {
      event_id: payment.event_id,
      status: { $in: ['PENDING', 'PUBLISHED'] },
    },
      { status: 'ARCHIVED', archived_at: new Date() }
  );

  if (!alreadyAwarded) {
    await notifyCoordinatorOfMatchLocked(marketplaceEvent);
    await notifyBidAwardOutcomes(marketplaceEvent, selectedBidIds);
  }

  const awardedBids = await MarketplaceBidService.getByData(
    { event_id: payment.event_id, bid_id: { $in: selectedBidIds } },
    { lean: true }
  );
  for (const bid of awardedBids) {
    await sendMarketplaceInformationEmailsIfUnlocked({
      event: marketplaceEvent,
      bid,
    });
  }

  return { awarded_bid_ids: selectedBidIds, marketplaceEvent };
};

const ensureAwardAgreementEnvelope = async (payment) => {
  const event = await MarketplaceEventService.getByData(
    { event_id: payment.event_id },
    { singleResult: true }
  );

  if (!event) {
    throw buildError('Marketplace event not found', 404);
  }

  if (event.agreement_status === 'SIGNED') {
    return { marketplaceEvent: event, agreementAlreadySigned: true };
  }

  if (event.agreement_envelope_id) {
    return { marketplaceEvent: event, agreementAlreadySent: true };
  }

  const signer = await UserService.getById(event.customer_user_id);
  const signerName =
    [signer?.firstName, signer?.lastName].filter(Boolean).join(' ') ||
    signer?.email ||
    'Event Coordinator';
  const signerEmail = signer?.email;

  if (!signerEmail) {
    event.agreement_provider = 'DOCUSIGN';
    event.agreement_status = 'ERROR';
    event.agreement_error_message = 'Event coordinator email is required for DocuSign';
    await event.save();
    throw buildError('Event coordinator email is required for DocuSign', 400);
  }

  try {
    const envelope = await DocuSignHelper.createMarketplaceAgreementEnvelope({
      event,
      signerName,
      signerEmail,
    });

    event.agreement_provider = 'DOCUSIGN';
    event.agreement_envelope_id = envelope.envelopeId;
    event.agreement_status = 'SENT';
    event.agreement_sent_at = new Date();
    event.signer_name = signerName;
    event.signer_email = signerEmail;
    event.agreement_error_message = null;
    await event.save();
    await createAgreementAudit({
      event,
      payment,
      action: 'ENVELOPE_CREATED',
      message: envelope.envelopeId,
    });

    return { marketplaceEvent: event, envelope };
  } catch (error) {
    event.agreement_provider = 'DOCUSIGN';
    event.agreement_status = 'ERROR';
    event.agreement_error_message = error.message;
    await event.save();
    await createAgreementAudit({
      event,
      payment,
      action: 'ERROR',
      message: error.message,
    });
    throw error;
  }
};

const refreshAwardAgreementStatus = async (event, source = 'USER_REFRESH') => {
  if (
    event.agreement_provider !== 'DOCUSIGN' ||
    !event.agreement_envelope_id ||
    event.agreement_status === 'SIGNED'
  ) {
    return event;
  }

  const envelope = await DocuSignHelper.getEnvelopeStatus(event.agreement_envelope_id);
  const agreementStatus = DocuSignHelper.mapEnvelopeStatus(envelope.status);

  event.agreement_status = agreementStatus;
  if (agreementStatus === 'SIGNED') {
    event.agreement_signed_at = envelope.completedDateTime
      ? new Date(envelope.completedDateTime)
      : new Date();
  }
  await event.save();
  await createAgreementAudit({
    event,
    action: 'STATUS_REFRESHED',
    source,
    message: envelope.status,
  });

  return event;
};

const finalizePaidAwardPayment = async (payment) => {
  const { marketplaceEvent } = await ensureAwardAgreementEnvelope(payment);
  const refreshedEvent = await refreshAwardAgreementStatus(marketplaceEvent);

  if (refreshedEvent.agreement_status !== 'SIGNED') {
    return {
      marketplaceEvent: refreshedEvent,
      agreement_required: true,
      agreement_status: refreshedEvent.agreement_status,
    };
  }

  return completeSignedAward(payment);
};

const finalizePaidMarketplacePayment = async (payment) => {
  if (payment.payment_type === 'VENDOR_EVENT_FEE') {
    return finalizePaidVendorPayment(payment);
  }

  if (payment.payment_type === 'COORDINATOR_AWARD_FEE') {
    return finalizePaidAwardPayment(payment);
  }

  return null;
};

const getPaymentForUser = async (paymentId, user) => {
  const payment = await MarketplacePaymentService.getByData(
    { payment_id: paymentId },
    { singleResult: true }
  );

  if (!payment) {
    throw buildError('Marketplace payment not found', 404);
  }

  if (user.userType === 'SUPER_ADMIN') {
    return payment;
  }

  if (String(payment.payer_user_id) !== String(user._id)) {
    throw buildError('Marketplace payment not found', 404);
  }

  if (payment.payer_type !== user.userType) {
    throw buildError('Marketplace payment not found', 404);
  }

  return payment;
};

exports.createEvent = async (req, res, next) => {
  try {
    if (req.user.userType !== 'CUSTOMER') {
      throw buildError('Only customers can create marketplace events', 403);
    }
    await assertCustomerEventCoordinator(req.user._id);

    const normalizedEvent = normalizeMarketplaceEventPayload(req.body);
    const marketplaceEvent = await MarketplaceEventService.create({
      ...normalizedEvent,
      customer_user_id: req.user._id,
    });

    return res.data({ marketplaceEvent }, 'Marketplace event created');
  } catch (e) {
    return next(e);
  }
};

exports.updateEvent = async (req, res, next) => {
  try {
    if (req.user.userType !== 'CUSTOMER') {
      throw buildError('Only customers can update marketplace events', 403);
    }
    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    if (['AWARDED', 'CANCELLED'].includes(event.status)) {
      throw buildError('Awarded or cancelled events cannot be edited.', 400);
    }
    const normalizedEvent = normalizeMarketplaceEventPayload(
      {
        ...toPlainObject(event),
        ...req.body,
        status: req.body.status || event.status,
      },
      { existingEvent: event }
    );
    const marketplaceEvent = await MarketplaceEventService.update(
      { event_id: req.params.eventId, customer_user_id: req.user._id },
      normalizedEvent,
      { getNew: true }
    );
    if (event.status !== 'CANCELLED' && marketplaceEvent.status === 'CANCELLED') {
      await notifyVendorsOfEventCancellation(marketplaceEvent);
    } else {
      await notifyVendorsOfEventChanges(
        marketplaceEvent,
        getImportantEventChanges(event, marketplaceEvent)
      );
    }

    return res.data({ marketplaceEvent }, 'Marketplace event updated');
  } catch (e) {
    return next(e);
  }
};

exports.deleteDraftEvent = async (req, res, next) => {
  try {
    if (req.user.userType !== 'CUSTOMER') {
      throw buildError('Only customers can delete marketplace drafts', 403);
    }

    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    if (event.status !== 'DRAFT') {
      throw buildError('Only draft events can be deleted.', 400);
    }

    await MarketplaceEventService.destroy({
      event_id: req.params.eventId,
      customer_user_id: req.user._id,
      status: 'DRAFT',
    });

    return res.data({ event_id: req.params.eventId }, 'Marketplace draft deleted');
  } catch (e) {
    return next(e);
  }
};

exports.reopenEvent = async (req, res, next) => {
  try {
    if (req.user.userType !== 'CUSTOMER') {
      throw buildError('Only customers can reopen marketplace events', 403);
    }
    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    if ((event.reopen_count || 0) >= 2) {
      throw buildError('This event has already been reopened two times.', 400);
    }
    if (event.status === 'AWARDED') {
      throw buildError('Awarded events cannot be reopened.', 400);
    }
    const normalizedEvent = normalizeMarketplaceEventPayload(
      {
        ...toPlainObject(event),
        ...req.body,
        status: 'REOPENED',
      },
      { existingEvent: event }
    );
    const marketplaceEvent = await MarketplaceEventService.update(
      { event_id: req.params.eventId, customer_user_id: req.user._id },
      {
        $set: {
          ...normalizedEvent,
          status: 'REOPENED',
          closed_at: null,
          close_notification_sent_at: null,
          current_submission_round: (event.current_submission_round || 1) + 1,
        },
        $inc: { reopen_count: 1 },
      },
      { getNew: true, directApply: true }
    );

    return res.data({ marketplaceEvent }, 'Marketplace event reopened');
  } catch (e) {
    return next(e);
  }
};

exports.closeEvent = async (req, res, next) => {
  try {
    if (req.user.userType !== 'CUSTOMER') {
      throw buildError('Only customers can close marketplace events', 403);
    }

    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    if (event.status === 'AWARDED') {
      throw buildError('Awarded events cannot be closed.', 400);
    }
    if (!ACTIVE_EVENT_STATUSES.includes(event.status)) {
      throw buildError('Only open events can be closed.', 400);
    }

    const now = new Date();
    const marketplaceEvent = await MarketplaceEventService.update(
      { event_id: req.params.eventId, customer_user_id: req.user._id },
      {
        status: 'CLOSED',
        closed_at: now,
        archived_at: now,
        close_comment: req.body.close_comment,
        closed_by_user_id: req.user._id,
      },
      { getNew: true }
    );

    await MarketplaceEventQuestionService.updateMany(
      {
        event_id: req.params.eventId,
        status: { $in: ['PENDING', 'PUBLISHED'] },
      },
      { status: 'ARCHIVED', archived_at: now }
    );

    await notifyClosedWithoutAward(marketplaceEvent);

    return res.data({ marketplaceEvent }, 'Marketplace event closed');
  } catch (e) {
    return next(e);
  }
};

exports.myEvents = async (req, res, next) => {
  try {
    if (req.user.userType !== 'CUSTOMER') {
      throw buildError('Only customers can view their marketplace events', 403);
    }
    await assertCustomerEventCoordinator(req.user._id);
    await Promise.all([
      closeExpiredMarketplaceEvents(),
      archiveExpiredDrafts(req.user._id),
    ]);

    const marketplaceEventList = await MarketplaceEventService.getMyEvents(
      req.user._id
    );

    return res.data({ marketplaceEventList }, 'Marketplace events');
  } catch (e) {
    return next(e);
  }
};

exports.getEvent = async (req, res, next) => {
  try {
    await closeExpiredMarketplaceEvents();
    const event = await getEventForUser(req.params.eventId, req.user);
    if (
      event.agreement_provider === 'DOCUSIGN' &&
      event.agreement_envelope_id &&
      event.agreement_status !== 'SIGNED'
    ) {
      const refreshedEvent = await refreshAwardAgreementStatus(event);
      if (
        refreshedEvent.agreement_status === 'SIGNED' &&
        refreshedEvent.award_payment_id
      ) {
        const payment = await MarketplacePaymentService.getByData(
          { payment_id: refreshedEvent.award_payment_id, payment_status: 'PAID' },
          { singleResult: true }
        );
        if (payment) {
          await completeSignedAward(payment);
        }
      }
    }
    const marketplaceEvent = await MarketplaceEventService.getWithImages(
      event.event_id
    );
    let unlockState = null;
    let marketplaceBid = null;
    let marketplaceApplication = null;

    if (req.user.userType === 'VENDOR') {
      marketplaceBid = await MarketplaceBidService.getByData(
        {
          event_id: event.event_id,
          vendor_user_id: req.user._id,
          bid_status: { $nin: ['WITHDRAWN'] },
        },
        { singleResult: true, lean: true }
      );
      marketplaceApplication = await MarketplaceApplicationService.getByData(
        {
          event_id: event.event_id,
          vendor_user_id: req.user._id,
          application_status: { $nin: ['WITHDRAWN'] },
        },
        { singleResult: true, lean: true }
      );
      unlockState = getMarketplaceUnlockState({
        event: marketplaceEvent,
        bid: marketplaceBid,
        application: marketplaceApplication,
      });
    }

    const fullAccess = ['CUSTOMER', 'SUPER_ADMIN'].includes(req.user.userType);

    return res.data(
      {
        marketplaceEvent: redactLockedMarketplaceEvent(marketplaceEvent, unlockState, {
          fullAccess,
        }),
      },
      'Marketplace event'
    );
  } catch (e) {
    return next(e);
  }
};

exports.getOpenEvents = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can view open marketplace events', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);
    await closeExpiredMarketplaceEvents();

    const openEvents = await MarketplaceEventService.getByData(
      {
        status: { $in: ACTIVE_EVENT_STATUSES },
        event_close_date: { $gt: new Date() },
      },
      {
        paging: {
          limit: Number(req.query.limit || 20),
          page: Number(req.query.page || 1),
        },
        sort: { event_close_date: 1, created_at: -1 },
        lean: true,
      }
    );
    const marketplaceEventList = await MarketplaceEventService.attachImages(
      openEvents
    );
    const visibleMarketplaceEventList = marketplaceEventList.map((event) =>
      redactLockedMarketplaceEvent(
        event,
        getMarketplaceUnlockState({ event }),
        { fullAccess: false }
      )
    );

    const total = await MarketplaceEventService.getCount({
      status: { $in: ACTIVE_EVENT_STATUSES },
      event_close_date: { $gt: new Date() },
    });

    return res.data(
      {
        marketplaceEventList: visibleMarketplaceEventList,
        total,
        page: Number(req.query.page || 1),
        totalPages:
          total < Number(req.query.limit || 20)
            ? 1
            : Math.ceil(total / Number(req.query.limit || 20)),
      },
      'Open marketplace events'
    );
  } catch (e) {
    return next(e);
  }
};

exports.getPublicOpenEvent = async (req, res, next) => {
  try {
    const event = await MarketplaceEventService.update(
      {
        event_id: req.params.eventId,
        status: 'OPEN',
        event_visibility: 'PUBLIC',
      },
      { $inc: { event_impression_count: 1 } },
      { directApply: true, getNew: true, lean: true }
    );

    if (!event) {
      throw buildError('Open marketplace event not found', 404);
    }

    const marketplaceEvent = await MarketplaceEventService.getWithImages(
      event.event_id
    );

    return res.data({ marketplaceEvent }, 'Open marketplace event');
  } catch (e) {
    return next(e);
  }
};

exports.trackPublicEventTicketClick = async (req, res, next) => {
  try {
    const marketplaceEvent = await MarketplaceEventService.update(
      {
        event_id: req.params.eventId,
        status: 'OPEN',
        ticket_sales_enabled: true,
        ticket_url: { $nin: [null, ''] },
      },
      { $inc: { ticket_click_count: 1 } },
      { directApply: true, getNew: true, lean: true }
    );

    if (!marketplaceEvent) {
      throw buildError('Open ticketed marketplace event not found', 404);
    }

    return res.data({ marketplaceEvent }, 'Marketplace ticket click tracked');
  } catch (e) {
    return next(e);
  }
};

exports.getEventQuestions = async (req, res, next) => {
  try {
    const event = await getQuestionEventForUser(req.params.eventId, req.user);
    const qaArchived = isQuestionBoardArchived(event);
    let query = {
      event_id: req.params.eventId,
      status: { $in: ['PENDING', 'PUBLISHED'] },
    };

    if (req.user.userType === 'VENDOR') {
      query = { event_id: req.params.eventId, status: 'PUBLISHED' };
    } else if (req.user.userType === 'SUPER_ADMIN') {
      query = {
        event_id: req.params.eventId,
        status: { $in: ['PENDING', 'PUBLISHED', 'BLOCKED', 'ARCHIVED'] },
      };
    }

    const questions = await MarketplaceEventQuestionService.getByData(query, {
      sort: { created_at: 1 },
      lean: true,
    });

    return res.data(
      {
        marketplaceQuestionList: questions.map((question) =>
          sanitizeMarketplaceQuestion(question, {
            includeBlocked: req.user.userType === 'SUPER_ADMIN',
          })
        ),
        qa_archived: qaArchived,
      },
      'Marketplace event questions'
    );
  } catch (e) {
    return next(e);
  }
};

exports.askEventQuestion = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can ask marketplace event questions', 403);
    }

    const foodTruck = await getVendorMarketplaceFoodTruck(req.user._id);
    const event = await getEventForUser(req.params.eventId, req.user);

    if (isQuestionBoardArchived(event) || !ACTIVE_EVENT_STATUSES.includes(event.status)) {
      throw buildError('This event message board is archived.', 410);
    }

    const questionText = String(req.body.question_text || '').trim();
    const moderation = moderateMarketplaceText(questionText);
    const isBlocked = moderation.status === 'BLOCKED';
    const marketplaceQuestion = await MarketplaceEventQuestionService.create({
      event_id: event.event_id,
      vendor_user_id: req.user._id,
      food_truck_id: foodTruck._id,
      vendor_display_id: getVendorDisplayId(foodTruck._id),
      question_text_raw: questionText,
      question_text_public: isBlocked ? null : questionText,
      status: isBlocked ? 'BLOCKED' : 'PENDING',
      question_moderation_status: moderation.status,
      question_moderation_reasons: moderation.reasons,
    });

    if (!isBlocked) {
      await notifyCoordinatorOfMarketplaceQuestion(event);
    }

    return res.data(
      {
        marketplaceQuestion: sanitizeMarketplaceQuestion(marketplaceQuestion),
        blocked: isBlocked,
      },
      isBlocked
        ? 'Question blocked by marketplace moderation'
        : 'Marketplace question submitted'
    );
  } catch (e) {
    return next(e);
  }
};

exports.answerEventQuestion = async (req, res, next) => {
  try {
    const event = await getQuestionEventForUser(req.params.eventId, req.user);

    if (req.user.userType === 'VENDOR') {
      throw buildError('Only coordinators can answer event questions', 403);
    }

    if (isQuestionBoardArchived(event) && req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('This event message board is archived.', 410);
    }

    const question = await getQuestionForEvent(
      req.params.eventId,
      req.params.questionId
    );
    if (['BLOCKED', 'ARCHIVED'].includes(question.status)) {
      throw buildError('This question cannot be answered.', 400);
    }

    const answerText = String(req.body.answer_text || '').trim();
    const moderation = moderateMarketplaceText(answerText);
    const isBlocked = moderation.status === 'BLOCKED';

    question.answer_text_raw = answerText;
    question.answer_text_public = isBlocked ? null : answerText;
    question.answer_moderation_status = moderation.status;
    question.answer_moderation_reasons = moderation.reasons;
    question.answered_by_user_id = req.user._id;
    question.answered_by_role = req.user.userType;
    question.answered_at = new Date();
    question.acted_by_admin_user_id =
      req.user.userType === 'SUPER_ADMIN' ? req.user._id : null;
    question.acted_on_behalf_of_user_id =
      req.user.userType === 'SUPER_ADMIN' ? event.customer_user_id : null;
    question.proxy_action_reason = req.body.proxy_action_reason || null;
    question.status = isBlocked ? 'PENDING' : 'PUBLISHED';
    await question.save();

    if (!isBlocked) {
      await notifyVendorsOfMarketplaceAnswer(event, question);
    }

    return res.data(
      {
        marketplaceQuestion: sanitizeMarketplaceQuestion(question, {
          includeBlocked: req.user.userType === 'SUPER_ADMIN',
        }),
        blocked: isBlocked,
      },
      isBlocked
        ? 'Answer blocked by marketplace moderation'
        : 'Marketplace answer published'
    );
  } catch (e) {
    return next(e);
  }
};

exports.updateEventQuestionStatus = async (req, res, next) => {
  try {
    const event = await getQuestionEventForUser(req.params.eventId, req.user);
    if (req.user.userType === 'VENDOR') {
      throw buildError('Only coordinators can update event questions', 403);
    }

    const question = await getQuestionForEvent(
      req.params.eventId,
      req.params.questionId
    );
    question.status = req.body.status;
    question.acted_by_admin_user_id =
      req.user.userType === 'SUPER_ADMIN' ? req.user._id : null;
    question.acted_on_behalf_of_user_id =
      req.user.userType === 'SUPER_ADMIN' ? event.customer_user_id : null;
    question.proxy_action_reason = req.body.proxy_action_reason || null;
    if (req.body.status === 'ARCHIVED') {
      question.archived_at = new Date();
    }
    await question.save();

    return res.data(
      {
        marketplaceQuestion: sanitizeMarketplaceQuestion(question, {
          includeBlocked: req.user.userType === 'SUPER_ADMIN',
        }),
      },
      'Marketplace question status updated'
    );
  } catch (e) {
    return next(e);
  }
};

exports.getEventBids = async (req, res, next) => {
  try {
    const event = await getOwnedEvent(req.params.eventId, req.user._id);

    const [bids, applications] = await Promise.all([
      MarketplaceBidService.getByData(
        { event_id: req.params.eventId, bid_status: { $ne: 'DRAFT' } },
        {
          sort: { submitted_at: -1, created_at: -1 },
          populate: [
            { path: 'vendor_user_id', select: 'firstName lastName email' },
            { path: 'food_truck_id', select: 'name logo cuisine' },
          ],
          lean: true,
        }
      ),
      MarketplaceApplicationService.getByData(
        { event_id: req.params.eventId, application_status: { $ne: 'DRAFT' } },
        {
          sort: { submitted_at: -1, created_at: -1 },
          populate: [
            { path: 'vendor_user_id', select: 'firstName lastName email' },
            { path: 'food_truck_id', select: 'name logo cuisine' },
          ],
          lean: true,
        }
      ),
    ]);
    const bidsWithUnlock = bids.map((bid) => {
      const unlockState = getMarketplaceUnlockState({ event, bid });
      return {
        ...redactLockedMarketplaceRecord(bid, unlockState, {
          fullAccess: false,
        }),
        marketplace_unlock: unlockState,
      };
    });
    const marketplaceBidList = await attachFilesToBids(bidsWithUnlock, {
      fullAccess: false,
    });
    const marketplaceApplicationList = await attachFilesToApplications(
      applications.map((application) => {
        const unlockState = getMarketplaceUnlockState({ event, application });
        return {
          ...redactLockedMarketplaceRecord(application, unlockState, {
            fullAccess: false,
          }),
          marketplace_unlock: unlockState,
        };
      }),
      { fullAccess: false }
    );

    return res.data(
      {
        marketplaceBidList,
        marketplaceApplicationList,
        final_submission_count: marketplaceBidList.length + marketplaceApplicationList.length,
      },
      'Marketplace event submissions'
    );
  } catch (e) {
    return next(e);
  }
};

exports.submitBid = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can submit marketplace bids', 403);
    }

    const foodTruck = await getVendorMarketplaceFoodTruck(req.user._id);
    await closeExpiredMarketplaceEvents();
    const event = await MarketplaceEventService.getByData(
      { event_id: req.params.eventId, status: { $in: ACTIVE_EVENT_STATUSES } },
      { singleResult: true }
    );

    if (!event) {
      throw buildError('This event is closed to new submissions.', 410);
    }
    await assertEventOpenForSubmission(event);
    const requestedStatus = req.body.bid_status || 'SUBMITTED';
    const currentRound = event.current_submission_round || 1;
    if (requestedStatus !== 'DRAFT') {
      await assertVendorCanSubmitRound(event, req.user._id);
    }

    const existingBid = await MarketplaceBidService.getByData(
      {
        event_id: req.params.eventId,
        vendor_user_id: req.user._id,
        submission_round: currentRound,
        bid_status: { $nin: ['WITHDRAWN'] },
      },
      { singleResult: true }
    );

    if (
      existingBid &&
      !['DRAFT', 'PENDING_SIGNATURE'].includes(existingBid.bid_status)
    ) {
      throw buildError('A bid has already been submitted for this event', 409);
    }

    if (requestedStatus !== 'DRAFT') {
      assertRequiredMarketplaceFields({
        'Full bid amount': req.body.full_bid_amount,
      });
    }
    if (
      requestedStatus !== 'DRAFT' &&
      event.alcohol_required &&
      !req.body.liquor_license_confirmed
    ) {
      throw buildError(
        'Liquor license confirmation is required for this event',
        400
      );
    }
    assertMarketplaceTextAllowed(req.body.notes, 'Notes');
    if (requestedStatus === 'SUBMITTED') {
      await requireSignedVendorAgreementForSubmission(req.user._id);
    }

    const vendorFee = roundMoney(event.vendor_fee || 0);
    const requiresPayment = vendorFee > 0;
    const bidPayload = {
      ...req.body,
      event_id: req.params.eventId,
      vendor_user_id: req.user._id,
      food_truck_id: foodTruck._id,
      submission_round: currentRound,
      nda_required: true,
      nda_acknowledged: requestedStatus === 'SUBMITTED',
      nda_acknowledged_at: requestedStatus === 'SUBMITTED' ? new Date() : null,
      agreement_provider: 'DOCUSIGN',
      agreement_status:
        requestedStatus === 'SUBMITTED' ? 'SIGNED' : 'PENDING_SIGNATURE',
      bid_status:
        requestedStatus === 'SUBMITTED' && requiresPayment
          ? 'DRAFT'
          : requestedStatus,
      payment_status: requiresPayment ? 'PENDING' : 'NOT_REQUIRED',
      submitted_at:
        requestedStatus === 'SUBMITTED' && !requiresPayment ? new Date() : null,
    };
    const marketplaceBid = existingBid
      ? await MarketplaceBidService.update(
          { bid_id: existingBid.bid_id },
          bidPayload,
          { getNew: true }
        )
      : await MarketplaceBidService.create(bidPayload);

    let marketplacePayment = null;
    if (requiresPayment && requestedStatus === 'SUBMITTED') {
      marketplacePayment = await MarketplacePaymentService.create({
        event_id: event.event_id,
        bid_id: marketplaceBid.bid_id,
        payer_user_id: req.user._id,
        payer_type: 'VENDOR',
        food_truck_id: foodTruck._id,
        payment_type: 'VENDOR_EVENT_FEE',
        base_amount: vendorFee,
        fee_rate: null,
        fee_amount: vendorFee,
        total_amount: vendorFee,
        payment_status: 'PENDING',
      });
      marketplaceBid.payment_id = marketplacePayment.payment_id;
      await marketplaceBid.save();
      await createPaymentAudit(marketplacePayment, req, 'CREATE');
    }

    if (requestedStatus === 'SUBMITTED' && !requiresPayment) {
      await notifyMarketplaceSubmission({
        event,
        vendorUserId: req.user._id,
        submissionType: 'bid',
        requiresPayment,
      });
    }

    return res.data(
      {
        marketplaceBid,
        marketplacePayment,
        requires_payment: requiresPayment,
        rtc_phone_number: MARKETPLACE_PHONE_NUMBER,
      },
      requestedStatus !== 'SUBMITTED'
        ? 'Marketplace bid saved'
        : requiresPayment
          ? 'Marketplace bid saved. Event registration payment is required.'
          : 'Marketplace bid submitted'
    );
  } catch (e) {
    return next(e);
  }
};

exports.myBids = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can view marketplace bids', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);

    const bids = await MarketplaceBidService.getByData(
      { vendor_user_id: req.user._id },
      { sort: { submitted_at: -1, created_at: -1 }, lean: true }
    );
    const marketplaceBidList = await attachFilesToBids(
      await attachEventsToBids(bids, {
        fullAccess: false,
        redactRecord: false,
      }),
      { fullAccess: true, redactRecord: false }
    );

    return res.data({ marketplaceBidList }, 'Marketplace bids');
  } catch (e) {
    return next(e);
  }
};

exports.submitApplication = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can submit marketplace applications', 403);
    }

    const foodTruck = await getVendorMarketplaceFoodTruck(req.user._id);
    await closeExpiredMarketplaceEvents();
    const event = await MarketplaceEventService.getByData(
      { event_id: req.params.eventId, status: { $in: ACTIVE_EVENT_STATUSES } },
      { singleResult: true }
    );

    if (!event) {
      throw buildError('This event is closed to new submissions.', 410);
    }
    await assertEventOpenForSubmission(event);
    const requestedStatus = req.body.application_status || 'SUBMITTED';
    const currentRound = event.current_submission_round || 1;
    if (requestedStatus !== 'DRAFT') {
      await assertVendorCanSubmitRound(event, req.user._id);
    }

    if (roundMoney(event.vendor_fee || 0) <= 0) {
      throw buildError('This event uses the bid flow, not applications', 400);
    }

    const existingApplication = await MarketplaceApplicationService.getByData(
      {
        event_id: req.params.eventId,
        vendor_user_id: req.user._id,
        submission_round: currentRound,
        application_status: { $nin: ['WITHDRAWN'] },
      },
      { singleResult: true }
    );

    if (
      existingApplication &&
      !['DRAFT', 'PENDING_SIGNATURE'].includes(
        existingApplication.application_status
      )
    ) {
      throw buildError('An application has already been submitted for this event', 409);
    }

    if (requestedStatus !== 'DRAFT') {
      assertRequiredMarketplaceFields({
        'Business name': req.body.business_name,
        'Contact name': req.body.contact_name,
        Phone: req.body.phone,
        Email: req.body.email,
        'Food type / cuisine': req.body.food_type_cuisine,
      });
    }
    if (
      requestedStatus !== 'DRAFT' &&
      event.alcohol_required &&
      !req.body.liquor_license_confirmed
    ) {
      throw buildError(
        'Liquor license confirmation is required for this event',
        400
      );
    }
    assertMarketplaceTextAllowed(req.body.notes, 'Notes');
    if (requestedStatus === 'SUBMITTED') {
      await requireSignedVendorAgreementForSubmission(req.user._id);
    }

    const applicationPayload = {
      ...req.body,
      event_id: req.params.eventId,
      vendor_user_id: req.user._id,
      food_truck_id: foodTruck._id,
      submission_round: currentRound,
      nda_required: true,
      nda_acknowledged: requestedStatus === 'SUBMITTED',
      nda_acknowledged_at: requestedStatus === 'SUBMITTED' ? new Date() : null,
      agreement_provider: 'DOCUSIGN',
      agreement_status:
        requestedStatus === 'SUBMITTED' ? 'SIGNED' : 'PENDING_SIGNATURE',
      application_status: requestedStatus,
      payment_status: 'NOT_REQUIRED',
      submitted_at:
        requestedStatus === 'SUBMITTED'
          ? new Date()
          : null,
    };
    const marketplaceApplication = existingApplication
      ? await MarketplaceApplicationService.update(
          { application_id: existingApplication.application_id },
          applicationPayload,
          { getNew: true }
        )
      : await MarketplaceApplicationService.create(applicationPayload);

    if (requestedStatus === 'SUBMITTED') {
      await notifyMarketplaceSubmission({
        event,
        vendorUserId: req.user._id,
        submissionType: 'application',
        requiresPayment: false,
      });
    }

    return res.data(
      { marketplaceApplication },
      requestedStatus === 'SUBMITTED'
        ? 'Marketplace application submitted'
        : 'Marketplace application saved'
    );
  } catch (e) {
    return next(e);
  }
};

exports.myApplications = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can view marketplace applications', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);

    const applications = await MarketplaceApplicationService.getByData(
      { vendor_user_id: req.user._id },
      { sort: { submitted_at: -1, created_at: -1 }, lean: true }
    );
    const marketplaceApplicationList = await attachFilesToApplications(
      await attachEventsToApplications(applications, {
        fullAccess: false,
        redactRecord: false,
      }),
      { fullAccess: true, redactRecord: false }
    );

    return res.data(
      { marketplaceApplicationList },
      'Marketplace applications'
    );
  } catch (e) {
    return next(e);
  }
};

exports.startVendorAgreementSigning = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can sign marketplace agreements', 403);
    }

    const foodTruck = await getVendorMarketplaceFoodTruck(req.user._id);
    const event = await MarketplaceEventService.getByData(
      { event_id: req.body.event_id },
      { singleResult: true }
    );

    if (!event) {
      throw buildError('Marketplace event not found', 404);
    }

    const bid = req.body.bid_id
      ? await getOwnedBid(req.body.bid_id, req.user._id)
      : null;
    const application = req.body.application_id
      ? await getOwnedApplication(req.body.application_id, req.user._id)
      : null;

    const validAgreement = await getValidVendorAgreement(req.user._id);
    if (validAgreement) {
      await persistSignedAgreementAttachment({
        status: 'SIGNED',
        envelope_id: validAgreement.envelope_id,
        event_id: event.event_id,
        bid_id: bid?.bid_id || null,
        application_id: application?.application_id || null,
        vendor_user_id: req.user._id,
      });

      return res.data(
        {
          marketplaceVendorAgreement: validAgreement,
          already_signed: true,
        },
        'Vendor agreements are already signed'
      );
    }

    const existingAgreement = await MarketplaceVendorAgreementService.getByData(
      {
        vendor_user_id: req.user._id,
        event_id: event.event_id,
        ...(bid ? { bid_id: bid.bid_id } : {}),
        ...(application ? { application_id: application.application_id } : {}),
        status: { $in: ['PENDING_SIGNATURE', 'SENT', 'VIEWED'] },
      },
      { singleResult: true, sort: { created_at: -1 } }
    );

    const signer = getVendorSignerInfo(req.user);
    if (!signer.signerEmail) {
      throw buildError('Vendor email is required for DocuSign signing', 400);
    }

    let agreement = existingAgreement;
    let envelopeId = agreement?.envelope_id;

    try {
      if (!agreement || !envelopeId) {
        const envelope = await DocuSignHelper.createVendorMarketplaceSigningEnvelope({
          vendorName: signer.signerName,
          vendorEmail: signer.signerEmail,
          vendorUserId: req.user._id,
          event,
          bid,
          application,
        });
        envelopeId = envelope.envelopeId;
        agreement = await MarketplaceVendorAgreementService.create({
          vendor_user_id: req.user._id,
          food_truck_id: foodTruck._id,
          event_id: event.event_id,
          bid_id: bid?.bid_id || null,
          application_id: application?.application_id || null,
          envelope_id: envelopeId,
          governance_template_id: docusign.governanceTemplateId,
          nda_template_id: docusign.ndaTemplateId,
          governance_version: docusign.governanceVersion,
          nda_version: docusign.ndaVersion,
          signer_role: docusign.signerRole,
          signer_name: signer.signerName,
          signer_email: signer.signerEmail,
          status: 'SENT',
        });
      }

      await setSubmissionSignatureStatus(agreement, 'PENDING_SIGNATURE');

      const recipientView = await DocuSignHelper.createRecipientView({
        envelopeId,
        signerName: signer.signerName,
        signerEmail: signer.signerEmail,
        vendorUserId: req.user._id,
        returnUrl: req.body.return_url || docusign.returnUrl || getVendorAgreementReturnUrl(),
      });

      return res.data(
        {
          marketplaceVendorAgreement: agreement,
          signing_url: recipientView.url,
          already_signed: false,
        },
        'Vendor agreement signing started'
      );
    } catch (error) {
      await sendDeveloperAlert('DocuSign vendor signing error', error, {
        vendor_user_id: req.user._id,
        event_id: event.event_id,
        bid_id: bid?.bid_id || null,
        application_id: application?.application_id || null,
      });
      if (agreement) {
        agreement.status = 'ERROR';
        agreement.error_message = error.message;
        await agreement.save();
      }
      throw error;
    }
  } catch (e) {
    return next(e);
  }
};

exports.vendorAgreementReturn = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can update marketplace agreements', 403);
    }

    const agreement = await MarketplaceVendorAgreementService.getByData(
      {
        agreement_id: req.params.agreementId,
        vendor_user_id: req.user._id,
      },
      { singleResult: true }
    );

    if (!agreement) {
      throw buildError('Marketplace vendor agreement not found', 404);
    }

    const returnStatus = normalizeDocuSignReturnStatus(req.body.status);
    agreement.return_status = returnStatus;

    try {
      if (returnStatus === 'completed') {
        let envelopeStatus = 'SIGNED';
        if (agreement.envelope_id) {
          const envelope = await DocuSignHelper.getEnvelopeStatus(agreement.envelope_id);
          envelopeStatus = DocuSignHelper.mapEnvelopeStatus(envelope.status);
          agreement.signed_at = envelope.completedDateTime
            ? new Date(envelope.completedDateTime)
            : new Date();
        } else {
          agreement.signed_at = new Date();
        }
        agreement.status = envelopeStatus === 'SIGNED' ? 'SIGNED' : envelopeStatus;
        if (agreement.status === 'SIGNED') {
          agreement.expires_at = getAnnualAgreementExpiry();
        }
      } else if (returnStatus === 'cancelled') {
        agreement.status = 'CANCELLED';
      } else if (returnStatus === 'declined') {
        agreement.status = 'DECLINED';
      } else {
        agreement.status = 'ERROR';
        agreement.error_message = 'Vendor returned from DocuSign with an error status.';
      }

      await agreement.save();
      await setSubmissionSignatureStatus(agreement, agreement.status);
      if (agreement.status === 'SIGNED') {
        await persistSignedAgreementAttachment(agreement);
      }

      if (agreement.status === 'ERROR') {
        await sendDeveloperAlert('DocuSign vendor return error', agreement.error_message, {
          agreement_id: agreement.agreement_id,
          vendor_user_id: req.user._id,
        });
      }

      return res.data(
        { marketplaceVendorAgreement: agreement },
        'Vendor agreement return recorded'
      );
    } catch (error) {
      agreement.status = 'ERROR';
      agreement.error_message = error.message;
      await agreement.save();
      await setSubmissionSignatureStatus(agreement, 'ERROR');
      await sendDeveloperAlert('DocuSign vendor return error', error, {
        agreement_id: agreement.agreement_id,
        vendor_user_id: req.user._id,
      });
      throw error;
    }
  } catch (e) {
    return next(e);
  }
};

exports.awardedBids = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can view awarded marketplace bids', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);

    const bids = await MarketplaceBidService.getByData(
      { vendor_user_id: req.user._id, bid_status: 'AWARDED' },
      { sort: { updated_at: -1 }, lean: true }
    );
    const marketplaceBidList = await attachFilesToBids(
      await attachEventsToBids(bids, {
        fullAccess: false,
        redactRecord: false,
      }),
      { fullAccess: false, redactRecord: false }
    );

    return res.data({ marketplaceBidList }, 'Awarded marketplace bids');
  } catch (e) {
    return next(e);
  }
};

exports.awardBids = async (req, res, next) => {
  try {
    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    const selectedBidIds = req.body.bid_ids || [];

    if (!selectedBidIds.length) {
      throw buildError('At least one bid is required to award vendors', 400);
    }

    if (selectedBidIds.length > event.number_of_vendors_needed) {
      throw buildError(
        `You can only award up to ${event.number_of_vendors_needed} vendor(s) for this event.`,
        400
      );
    }

    const selectedBids = await MarketplaceBidService.getByData({
      event_id: req.params.eventId,
      bid_id: { $in: selectedBidIds },
      bid_status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
    });

    if (selectedBids.length !== selectedBidIds.length) {
      throw buildError('One or more selected bids are invalid', 400);
    }

    const baseAmount = roundMoney(
      selectedBids.reduce(
        (total, bid) => total + Number(bid.full_bid_amount || 0),
        0
      ) || event.budgeted_amount
    );
    const feeAmount = roundMoney(baseAmount * COORDINATOR_AWARD_FEE_RATE);

    if (feeAmount > 0) {
      let marketplacePayment = await findActiveMarketplacePayment({
        event_id: event.event_id,
        payer_user_id: req.user._id,
        payment_type: 'COORDINATOR_AWARD_FEE',
      });

      if (!marketplacePayment) {
        marketplacePayment = await MarketplacePaymentService.create({
          event_id: event.event_id,
          selected_bid_ids: selectedBidIds,
          payer_user_id: req.user._id,
          payer_type: 'CUSTOMER',
          payment_type: 'COORDINATOR_AWARD_FEE',
          base_amount: baseAmount,
          fee_rate: COORDINATOR_AWARD_FEE_RATE,
          fee_amount: feeAmount,
          total_amount: feeAmount,
          payment_status: 'PENDING',
        });
        await createPaymentAudit(marketplacePayment, req, 'CREATE');
      } else if (marketplacePayment.payment_status === 'PENDING') {
        marketplacePayment.selected_bid_ids = selectedBidIds;
        marketplacePayment.base_amount = baseAmount;
        marketplacePayment.fee_amount = feeAmount;
        marketplacePayment.total_amount = feeAmount;
        await marketplacePayment.save();
      }

      event.award_payment_id = marketplacePayment.payment_id;
      event.award_payment_status = marketplacePayment.payment_status;
      await event.save();

      if (marketplacePayment.payment_status !== 'PAID') {
        return res.data(
          {
            awarded_bid_ids: selectedBidIds,
            marketplaceEvent: event,
            marketplacePayment,
            requires_payment: true,
            rtc_phone_number: MARKETPLACE_PHONE_NUMBER,
          },
          'Marketplace award payment is required before vendors are awarded'
        );
      }

      const finalized = await finalizePaidAwardPayment(marketplacePayment);
      return res.data(
        { ...finalized, marketplacePayment, requires_payment: false },
        'Marketplace bids awarded'
      );
    }

    await MarketplaceBidService.getModel().updateMany(
      { event_id: req.params.eventId, bid_id: { $in: selectedBidIds } },
      { $set: { bid_status: 'AWARDED' } }
    );

    await MarketplaceBidService.getModel().updateMany(
      { event_id: req.params.eventId, bid_id: { $nin: selectedBidIds } },
      { $set: { bid_status: 'NOT_AWARDED' } }
    );

    event.status = 'AWARDED';
    await event.save();
    await MarketplaceEventQuestionService.updateMany(
      {
        event_id: event.event_id,
        status: { $in: ['PENDING', 'PUBLISHED'] },
      },
      { status: 'ARCHIVED', archived_at: new Date() }
    );
    await notifyCoordinatorOfMatchLocked(event);
    await notifyBidAwardOutcomes(event, selectedBidIds);
    for (const bid of selectedBids) {
      await sendMarketplaceInformationEmailsIfUnlocked({
        event,
        bid,
      });
    }

    return res.data(
      { awarded_bid_ids: selectedBidIds, marketplaceEvent: event },
      'Marketplace bids awarded'
    );
  } catch (e) {
    return next(e);
  }
};

exports.updateEventStatus = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can update marketplace event status', 403);
    }

    const existingEvent = await MarketplaceEventService.getByData(
      { event_id: req.params.eventId },
      { singleResult: true }
    );
    const marketplaceEvent = await MarketplaceEventService.update(
      { event_id: req.params.eventId },
      { status: req.body.status },
      { getNew: true }
    );

    if (!marketplaceEvent) {
      throw buildError('Marketplace event not found', 404);
    }

    if (isQuestionBoardArchived(marketplaceEvent)) {
      await MarketplaceEventQuestionService.updateMany(
        {
          event_id: marketplaceEvent.event_id,
          status: { $in: ['PENDING', 'PUBLISHED'] },
        },
        { status: 'ARCHIVED', archived_at: new Date() }
      );
    }

    if (existingEvent?.status !== 'CANCELLED' && marketplaceEvent.status === 'CANCELLED') {
      await notifyVendorsOfEventCancellation(marketplaceEvent);
    }

    return res.data({ marketplaceEvent }, 'Marketplace event status updated');
  } catch (e) {
    return next(e);
  }
};

// TODO Phase 12 payment: add reopen bidding $25 checkout before REOPENED is
// exposed as an active app flow.

exports.getPayment = async (req, res, next) => {
  try {
    const marketplacePayment = await getPaymentForUser(
      req.params.paymentId,
      req.user
    );
    const routingResult =
      marketplacePayment.payment_status === 'PAID'
        ? await finalizePaidMarketplacePayment(marketplacePayment)
        : null;

    return res.data(
      { marketplacePayment, routingResult, rtc_phone_number: MARKETPLACE_PHONE_NUMBER },
      'Marketplace payment'
    );
  } catch (e) {
    return next(e);
  }
};

exports.initiateCallPayment = async (req, res, next) => {
  try {
    const marketplacePayment = await getPaymentForUser(
      req.params.paymentId,
      req.user
    );

    if (!['PENDING', 'FAILED'].includes(marketplacePayment.payment_status)) {
      throw buildError('Only pending marketplace payments can use call payment', 400);
    }

    await createPaymentAudit(
      marketplacePayment,
      req,
      'CALL_INITIATED',
      'User selected Call RTC to Complete Payment'
    );

    return res.data(
      {
        marketplacePayment,
        rtc_phone_number: MARKETPLACE_PHONE_NUMBER,
        dial_url: 'tel:8004107053',
      },
      'Awaiting Payment Confirmation'
    );
  } catch (e) {
    return next(e);
  }
};

exports.checkoutPayment = async (req, res, next) => {
  try {
    const marketplacePayment = await getPaymentForUser(
      req.params.paymentId,
      req.user
    );

    if (!['PENDING', 'FAILED'].includes(marketplacePayment.payment_status)) {
      throw buildError('Only pending marketplace payments can be paid', 400);
    }

    const paymentMethod = req.body.payment_method;
    if (!['APPLE_PAY', 'GOOGLE_PAY'].includes(paymentMethod)) {
      throw buildError('Marketplace checkout only supports Apple Pay or Google Pay', 400);
    }

    const opaquePaymentData = normalizeOpaquePaymentData(req.body.payment_data);
    const opaqueToken =
      paymentMethod === 'APPLE_PAY'
        ? Buffer.from(JSON.stringify(req.body.payment_data)).toString('base64')
        : Buffer.from(req.body.payment_data).toString('base64');

    if (!opaqueToken) {
      throw buildError('Payment token missing', 400);
    }

    const chargeResp = await PaymentHelper.chargePaymentUnified({
      opaqueToken,
      amount: marketplacePayment.total_amount,
      paymentMethod,
      dataDescriptor: opaquePaymentData.dataDescriptor,
      firstName: req.user.firstName || 'Marketplace',
      lastName: req.user.lastName || 'Payer',
      email: req.user.email,
      subTotal: marketplacePayment.total_amount,
      taxAmount: 0,
      userId: req.user._id,
    });

    if (!chargeResp.success) {
      marketplacePayment.payment_method = paymentMethod;
      marketplacePayment.payment_status = 'FAILED';
      await marketplacePayment.save();
      await createPaymentAudit(
        marketplacePayment,
        req,
        'CHECKOUT_FAILED',
        chargeResp.message || 'Wallet payment failed'
      );
      throw buildError(chargeResp.message || 'Payment failed', 400);
    }

    marketplacePayment.payment_method = paymentMethod;
    marketplacePayment.payment_status = 'PAID';
    marketplacePayment.processor_transaction_id =
      chargeResp.transactionId || chargeResp?.fullResponse?.transId || null;
    marketplacePayment.paid_at = new Date();
    await marketplacePayment.save();
    await createPaymentAudit(marketplacePayment, req, 'CHECKOUT_PAID');

    const routingResult = await finalizePaidMarketplacePayment(marketplacePayment);

    return res.data(
      { marketplacePayment, routingResult },
      'Marketplace payment confirmed'
    );
  } catch (e) {
    return next(e);
  }
};

exports.adminMarketplacePayments = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can view marketplace payments', 403);
    }

    const limit = Number(req.query.limit || 20);
    const page = Number(req.query.page || 1);
    const query = {};

    if (req.query.payment_status) {
      query.payment_status = req.query.payment_status;
    }
    if (req.query.payment_type) {
      query.payment_type = req.query.payment_type;
    }

    const payments = await MarketplacePaymentService.getByData(query, {
      paging: { limit, page },
      sort: { created_at: -1 },
      lean: true,
    });
    const total = await MarketplacePaymentService.getCount(query);
    const eventIds = [...new Set(payments.map((item) => item.event_id).filter(Boolean))];
    const bidIds = [...new Set(payments.map((item) => item.bid_id).filter(Boolean))];
    const [events, bids] = await Promise.all([
      eventIds.length
        ? MarketplaceEventService.getByData(
            { event_id: { $in: eventIds } },
            { lean: true }
          )
        : [],
      bidIds.length
        ? MarketplaceBidService.getByData(
            { bid_id: { $in: bidIds } },
            { lean: true }
          )
        : [],
    ]);
    const eventById = events.reduce((acc, event) => {
      acc[event.event_id] = event;
      return acc;
    }, {});
    const bidById = bids.reduce((acc, bid) => {
      acc[bid.bid_id] = bid;
      return acc;
    }, {});
    const marketplacePaymentList = payments.map((payment) => ({
      ...payment,
      marketplaceEvent: eventById[payment.event_id] || null,
      marketplaceBid: payment.bid_id ? bidById[payment.bid_id] || null : null,
    }));

    return res.data(
      {
        marketplacePaymentList,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      'Marketplace payments'
    );
  } catch (e) {
    return next(e);
  }
};

exports.adminMarkPaymentPaid = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can mark marketplace payments paid', 403);
    }

    const marketplacePayment = await MarketplacePaymentService.getByData(
      { payment_id: req.params.paymentId },
      { singleResult: true }
    );

    if (!marketplacePayment) {
      throw buildError('Marketplace payment not found', 404);
    }

    if (marketplacePayment.payment_status === 'PAID') {
      throw buildError('Marketplace payment is already paid', 409);
    }

    if (['CANCELLED', 'REFUNDED'].includes(marketplacePayment.payment_status)) {
      throw buildError('Cancelled or refunded payments cannot be manually paid', 400);
    }

    marketplacePayment.payment_method = 'ADMIN_MANUAL';
    marketplacePayment.payment_status = 'PAID';
    marketplacePayment.manually_marked_paid = true;
    marketplacePayment.marked_paid_by_admin_user_id = req.user._id;
    marketplacePayment.marked_paid_at = new Date();
    marketplacePayment.paid_at = new Date();
    marketplacePayment.manual_payment_reference =
      req.body.manual_payment_reference || null;
    marketplacePayment.manual_payment_note = req.body.manual_payment_note || null;
    await marketplacePayment.save();

    await createPaymentAudit(
      marketplacePayment,
      req,
      'ADMIN_MARK_PAID',
      req.body.manual_payment_note || 'Admin manual paid override'
    );

    const routingResult = await finalizePaidMarketplacePayment(marketplacePayment);

    return res.data(
      { marketplacePayment, routingResult },
      'Marketplace payment marked paid'
    );
  } catch (e) {
    return next(e);
  }
};

exports.docusignWebhook = async (req, res, next) => {
  try {
    const envelopeId =
      req.body?.data?.envelopeId ||
      req.body?.envelopeId ||
      req.body?.EnvelopeStatus?.EnvelopeID;
    const rawStatus =
      req.body?.data?.envelopeSummary?.status ||
      req.body?.status ||
      req.body?.EnvelopeStatus?.Status;

    if (!envelopeId) {
      return res.data({ received: true }, 'DocuSign webhook received');
    }

    const event = await MarketplaceEventService.getByData(
      { agreement_envelope_id: envelopeId },
      { singleResult: true }
    );

    if (!event) {
      return res.data({ received: true }, 'DocuSign webhook received');
    }

    const agreementStatus = DocuSignHelper.mapEnvelopeStatus(rawStatus);
    event.agreement_status = agreementStatus;
    if (agreementStatus === 'SIGNED') {
      event.agreement_signed_at = new Date();
    }
    await event.save();
    await createAgreementAudit({
      event,
      action: 'WEBHOOK_RECEIVED',
      source: 'DOCUSIGN_WEBHOOK',
      message: rawStatus || null,
    });

    if (agreementStatus === 'SIGNED' && event.award_payment_id) {
      const payment = await MarketplacePaymentService.getByData(
        { payment_id: event.award_payment_id, payment_status: 'PAID' },
        { singleResult: true }
      );
      if (payment) {
        await completeSignedAward(payment);
      }
    }

    return res.data({ received: true }, 'DocuSign webhook received');
  } catch (e) {
    return next(e);
  }
};

exports.addEventImage = async (req, res, next) => {
  try {
    let event = null;
    if (req.user.userType === 'CUSTOMER') {
      event = await getOwnedEvent(req.params.eventId, req.user._id);
    } else if (req.user.userType === 'SUPER_ADMIN') {
      event = await MarketplaceEventService.getByData(
        { event_id: req.params.eventId },
        { singleResult: true }
      );

      if (!event) {
        throw buildError('Marketplace event not found', 404);
      }
    } else {
      throw buildError('Only event owners can upload marketplace event images', 403);
    }

    if (!req.file) {
      throw buildError('No image uploaded', 400);
    }

    if (!isImageMimeType(req.file.mimetype)) {
      throw buildError('Only image files are allowed for event images', 400);
    }

    const { url, key } = await addObjectWithKey(
      req.file,
      'marketplace/events/images'
    );
    fs.unlink(req.file.path, () => {});

    const marketplaceEventImage = await MarketplaceEventImageService.create({
      event_id: req.params.eventId,
      image_url: url,
      image_key: key,
      uploaded_by_user_id: req.user._id,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
    });

    await MarketplaceAttachmentService.create({
      event_id: req.params.eventId,
      attachment_type: 'EVENT_IMAGE',
      file_url: url,
      file_key: key,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      uploaded_by_user_id: req.user._id,
    });

    return res.data(
      { marketplaceEventImage },
      'Marketplace event image uploaded'
    );
  } catch (e) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return next(e);
  }
};

exports.deleteEventImage = async (req, res, next) => {
  try {
    let event = null;
    if (req.user.userType === 'CUSTOMER') {
      event = await getOwnedEvent(req.params.eventId, req.user._id);
    } else if (req.user.userType === 'SUPER_ADMIN') {
      event = await MarketplaceEventService.getByData(
        { event_id: req.params.eventId },
        { singleResult: true }
      );
    }

    if (!event) {
      throw buildError('Marketplace event not found', 404);
    }

    const image = await MarketplaceEventImageService.getByData(
      {
        event_id: req.params.eventId,
        image_id: req.params.imageId,
        status: 'ACTIVE',
      },
      { singleResult: true }
    );

    if (!image) {
      throw buildError('Marketplace event image not found', 404);
    }

    image.status = 'DELETED';
    image.deleted_at = new Date();
    image.deleted_by_user_id = req.user._id;
    await image.save();

    if (image.image_key) {
      await removeObject(image.image_key);
    }

    if (image.image_key) {
      const attachments = await MarketplaceAttachmentService.getByData(
        { event_id: req.params.eventId, file_key: image.image_key },
        { lean: false }
      );

      for (const attachment of attachments) {
        attachment.status = 'DELETED';
        attachment.status_reason = 'Deleted from event image controls';
        attachment.status_updated_at = new Date();
        attachment.status_updated_by_user_id = req.user._id;
        attachment.deleted_at = new Date();
        attachment.deleted_by_user_id = req.user._id;
        await attachment.save();
        await createFileAudit(
          attachment,
          req,
          'DELETE',
          'Deleted from event image controls'
        );
      }

      await MarketplaceAttachmentService.getModel().updateMany(
        { event_id: req.params.eventId, file_key: image.image_key },
        {
          $set: {
            status: 'DELETED',
            deleted_at: new Date(),
            deleted_by_user_id: req.user._id,
          },
        }
      );
    }

    return res.data({ image_id: req.params.imageId }, 'Marketplace image deleted');
  } catch (e) {
    return next(e);
  }
};

exports.addBidAttachment = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can upload bid attachments', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);
    const bid = await getOwnedBid(req.params.bidId, req.user._id);
    const attachmentType = req.body.attachment_type;
    const config = validateAttachmentFile(req.file, attachmentType);
    const requirementLabel = normalizeRequirementLabel(req.body.requirement_label);
    const requirementKey = getRequirementKey(requirementLabel);

    const replacedAttachments = await archiveReplacementAttachments({
      eventId: bid.event_id,
      bidId: bid.bid_id,
      attachmentType,
      requirementKey,
      actorUserId: req.user._id,
      reason: 'Replaced by vendor upload',
    });
    replacedAttachments.forEach((attachment) => {
      if (attachment.attachment_type === 'BID_MENU_PDF') {
        bid.menu_pdf_url = null;
        bid.menu_pdf_key = null;
      }
      if (attachment.attachment_type === REQUIREMENT_ATTACHMENT_TYPE) {
        bid.permit_license_urls = (bid.permit_license_urls || []).filter(
          (url) => url !== attachment.file_url
        );
        bid.permit_license_keys = (bid.permit_license_keys || []).filter(
          (key) => key !== attachment.file_key
        );
      }
      if (attachment.attachment_type === 'AGREEMENT_DOCUMENT') {
        bid.agreement_document_url = null;
        bid.agreement_document_key = null;
      }
    });

    const { url, key } = await addObjectWithKey(req.file, config.folder);
    fs.unlink(req.file.path, () => {});

    const marketplaceAttachment = await MarketplaceAttachmentService.create({
      event_id: bid.event_id,
      bid_id: bid.bid_id,
      attachment_type: attachmentType,
      file_url: url,
      file_key: key,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      requirement_label: requirementLabel,
      requirement_key: requirementKey,
      uploaded_by_user_id: req.user._id,
    });

    if (attachmentType === 'BID_MENU_PDF') {
      bid.menu_pdf_url = url;
      bid.menu_pdf_key = key;
    }

    if (attachmentType === 'BID_IMAGE') {
      bid.image_urls = [...(bid.image_urls || []), url];
      bid.image_keys = [...(bid.image_keys || []), key];
    }

    if (attachmentType === 'PERMIT_LICENSE' || attachmentType === REQUIREMENT_ATTACHMENT_TYPE) {
      bid.permit_license_urls = [...(bid.permit_license_urls || []), url];
      bid.permit_license_keys = [...(bid.permit_license_keys || []), key];
    }

    if (attachmentType === 'AGREEMENT_DOCUMENT') {
      bid.agreement_document_url = url;
      bid.agreement_document_key = key;
    }

    await bid.save();

    return res.data(
      { marketplaceAttachment, marketplaceBid: bid },
      'Marketplace bid attachment uploaded'
    );
  } catch (e) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return next(e);
  }
};

exports.addApplicationAttachment = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can upload application attachments', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);
    const application = await getOwnedApplication(
      req.params.applicationId,
      req.user._id
    );
    const attachmentType = req.body.attachment_type;
    const config = validateAttachmentFile(req.file, attachmentType);
    const requirementLabel = normalizeRequirementLabel(req.body.requirement_label);
    const requirementKey = getRequirementKey(requirementLabel);

    const replacedAttachments = await archiveReplacementAttachments({
      eventId: application.event_id,
      applicationId: application.application_id,
      attachmentType,
      requirementKey,
      actorUserId: req.user._id,
      reason: 'Replaced by vendor upload',
    });
    replacedAttachments.forEach((attachment) => {
      if (attachment.attachment_type === 'APPLICATION_MENU_PDF') {
        application.menu_pdf_url = null;
        application.menu_pdf_key = null;
      }
      if (attachment.attachment_type === REQUIREMENT_ATTACHMENT_TYPE) {
        application.permit_license_urls = (
          application.permit_license_urls || []
        ).filter((url) => url !== attachment.file_url);
        application.permit_license_keys = (
          application.permit_license_keys || []
        ).filter((key) => key !== attachment.file_key);
      }
      if (attachment.attachment_type === 'AGREEMENT_DOCUMENT') {
        application.agreement_document_url = null;
        application.agreement_document_key = null;
      }
    });

    const { url, key } = await addObjectWithKey(req.file, config.folder);
    fs.unlink(req.file.path, () => {});

    const marketplaceAttachment = await MarketplaceAttachmentService.create({
      event_id: application.event_id,
      application_id: application.application_id,
      attachment_type: attachmentType,
      file_url: url,
      file_key: key,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      requirement_label: requirementLabel,
      requirement_key: requirementKey,
      uploaded_by_user_id: req.user._id,
    });

    if (attachmentType === 'APPLICATION_MENU_PDF') {
      application.menu_pdf_url = url;
      application.menu_pdf_key = key;
    }

    if (attachmentType === 'APPLICATION_IMAGE') {
      application.image_urls = [...(application.image_urls || []), url];
      application.image_keys = [...(application.image_keys || []), key];
    }

    if (attachmentType === 'PERMIT_LICENSE' || attachmentType === REQUIREMENT_ATTACHMENT_TYPE) {
      application.permit_license_urls = [
        ...(application.permit_license_urls || []),
        url,
      ];
      application.permit_license_keys = [
        ...(application.permit_license_keys || []),
        key,
      ];
    }

    if (attachmentType === 'AGREEMENT_DOCUMENT') {
      application.agreement_document_url = url;
      application.agreement_document_key = key;
    }

    await application.save();

    return res.data(
      { marketplaceAttachment, marketplaceApplication: application },
      'Marketplace application attachment uploaded'
    );
  } catch (e) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return next(e);
  }
};

exports.createApplicationVendorFeePayment = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can create application payments', 403);
    }

    const foodTruck = await getVendorMarketplaceFoodTruck(req.user._id);
    const application = await getOwnedApplication(
      req.params.applicationId,
      req.user._id
    );
    const event = await MarketplaceEventService.getByData(
      { event_id: application.event_id },
      { singleResult: true, lean: true }
    );

    if (!event || roundMoney(event.vendor_fee || 0) <= 0) {
      throw buildError('Vendor fee payment is not available for this event', 400);
    }

    if (!['ACCEPTED', 'PAYMENT_DUE'].includes(application.application_status)) {
      throw buildError(
        'Payment is only available after your application is accepted by the event coordinator.',
        403
      );
    }

    if (
      application.payment_status === 'PAID' ||
      (application.transaction_id && application.payment_status === 'PAID')
    ) {
      throw buildError('This vendor fee has already been paid', 409);
    }

    const existingPayment = await findActiveMarketplacePayment({
      application_id: application.application_id,
      payment_type: 'VENDOR_EVENT_FEE',
      payer_user_id: req.user._id,
    });

    if (existingPayment) {
      return res.data(
        { marketplacePayment: existingPayment, marketplaceApplication: application },
        'Marketplace vendor fee payment'
      );
    }

    const vendorFee = roundMoney(event.vendor_fee || 0);
    const rtcEventProcessingFee = roundMoney(
      vendorFee * VENDOR_EVENT_PROCESSING_RATE
    );
    const totalDue = roundMoney(vendorFee + rtcEventProcessingFee);

    const marketplacePayment = await MarketplacePaymentService.create({
      event_id: event.event_id,
      application_id: application.application_id,
      payer_user_id: req.user._id,
      payer_type: 'VENDOR',
      food_truck_id: foodTruck._id,
      payment_type: 'VENDOR_EVENT_FEE',
      base_amount: vendorFee,
      fee_rate: VENDOR_EVENT_PROCESSING_RATE,
      fee_amount: rtcEventProcessingFee,
      total_amount: totalDue,
      coordinator_payout_amount: vendorFee,
      payment_status: 'PENDING',
    });

    application.payment_id = marketplacePayment.payment_id;
    application.payment_status = 'PENDING';
    if (application.application_status === 'ACCEPTED') {
      application.application_status = 'PAYMENT_DUE';
    }
    await application.save();

    await createPaymentAudit(marketplacePayment, req, 'CREATE');

    return res.data(
      { marketplacePayment, marketplaceApplication: application },
      'Marketplace vendor fee payment created'
    );
  } catch (e) {
    return next(e);
  }
};

exports.deleteBidAttachment = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can delete bid attachments', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);
    const bid = await getOwnedBid(req.params.bidId, req.user._id);
    const attachment = await MarketplaceAttachmentService.getByData(
      {
        bid_id: bid.bid_id,
        attachment_id: req.params.attachmentId,
        status: 'ACTIVE',
      },
      { singleResult: true }
    );

    if (!attachment) {
      throw buildError('Marketplace bid attachment not found', 404);
    }

    attachment.status = 'DELETED';
    attachment.deleted_at = new Date();
    attachment.deleted_by_user_id = req.user._id;
    await attachment.save();
    await createFileAudit(
      attachment,
      req,
      'DELETE',
      'Deleted from bid attachment controls'
    );

    if (attachment.file_key) {
      await removeObject(attachment.file_key);
    }

    if (
      attachment.attachment_type === 'BID_MENU_PDF' &&
      bid.menu_pdf_key === attachment.file_key
    ) {
      bid.menu_pdf_url = null;
      bid.menu_pdf_key = null;
    }

    if (attachment.attachment_type === 'BID_IMAGE') {
      bid.image_urls = (bid.image_urls || []).filter(
        (url) => url !== attachment.file_url
      );
      bid.image_keys = (bid.image_keys || []).filter(
        (key) => key !== attachment.file_key
      );
    }

    if (
      attachment.attachment_type === 'PERMIT_LICENSE' ||
      attachment.attachment_type === REQUIREMENT_ATTACHMENT_TYPE
    ) {
      bid.permit_license_urls = (bid.permit_license_urls || []).filter(
        (url) => url !== attachment.file_url
      );
      bid.permit_license_keys = (bid.permit_license_keys || []).filter(
        (key) => key !== attachment.file_key
      );
    }

    if (
      attachment.attachment_type === 'AGREEMENT_DOCUMENT' &&
      bid.agreement_document_key === attachment.file_key
    ) {
      bid.agreement_document_url = null;
      bid.agreement_document_key = null;
    }

    await bid.save();

    return res.data(
      { attachment_id: req.params.attachmentId, marketplaceBid: bid },
      'Marketplace bid attachment deleted'
    );
  } catch (e) {
    return next(e);
  }
};

exports.deleteApplicationAttachment = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can delete application attachments', 403);
    }

    await getVendorMarketplaceFoodTruck(req.user._id);
    const application = await getOwnedApplication(
      req.params.applicationId,
      req.user._id
    );
    const attachment = await MarketplaceAttachmentService.getByData(
      {
        application_id: application.application_id,
        attachment_id: req.params.attachmentId,
        status: 'ACTIVE',
      },
      { singleResult: true }
    );

    if (!attachment) {
      throw buildError('Marketplace application attachment not found', 404);
    }

    attachment.status = 'DELETED';
    attachment.deleted_at = new Date();
    attachment.deleted_by_user_id = req.user._id;
    await attachment.save();
    await createFileAudit(
      attachment,
      req,
      'DELETE',
      'Deleted from application attachment controls'
    );

    if (attachment.file_key) {
      await removeObject(attachment.file_key);
    }

    if (
      attachment.attachment_type === 'APPLICATION_MENU_PDF' &&
      application.menu_pdf_key === attachment.file_key
    ) {
      application.menu_pdf_url = null;
      application.menu_pdf_key = null;
    }

    if (attachment.attachment_type === 'APPLICATION_IMAGE') {
      application.image_urls = (application.image_urls || []).filter(
        (url) => url !== attachment.file_url
      );
      application.image_keys = (application.image_keys || []).filter(
        (key) => key !== attachment.file_key
      );
    }

    if (
      attachment.attachment_type === 'PERMIT_LICENSE' ||
      attachment.attachment_type === REQUIREMENT_ATTACHMENT_TYPE
    ) {
      application.permit_license_urls = (
        application.permit_license_urls || []
      ).filter((url) => url !== attachment.file_url);
      application.permit_license_keys = (
        application.permit_license_keys || []
      ).filter((key) => key !== attachment.file_key);
    }

    if (
      attachment.attachment_type === 'AGREEMENT_DOCUMENT' &&
      application.agreement_document_key === attachment.file_key
    ) {
      application.agreement_document_url = null;
      application.agreement_document_key = null;
    }

    await application.save();

    return res.data(
      { attachment_id: req.params.attachmentId, marketplaceApplication: application },
      'Marketplace application attachment deleted'
    );
  } catch (e) {
    return next(e);
  }
};

exports.repositoryFiles = async (req, res, next) => {
  try {
    if (req.user.userType === 'EMPLOYEE') {
      throw buildError('Employees cannot access marketplace repository files', 403);
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    const query = {};
    const andFilters = [];

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.attachment_type) {
      query.attachment_type = req.query.attachment_type;
    }

    if (req.query.event_id) {
      query.event_id = req.query.event_id;
    }

    if (req.query.bid_id) {
      query.bid_id = req.query.bid_id;
    }

    if (req.query.search?.trim()) {
      andFilters.push({
        $or: [
          { original_name: { $regex: req.query.search.trim(), $options: 'i' } },
          { event_id: { $regex: req.query.search.trim(), $options: 'i' } },
          { bid_id: { $regex: req.query.search.trim(), $options: 'i' } },
          {
            application_id: {
              $regex: req.query.search.trim(),
              $options: 'i',
            },
          },
          { file_key: { $regex: req.query.search.trim(), $options: 'i' } },
        ],
      });
    }

    if (req.user.userType === 'CUSTOMER') {
      const events = await MarketplaceEventService.getByData(
        { customer_user_id: req.user._id },
        { lean: true }
      );
      const eventIds = events.map((event) => event.event_id);
      if (!eventIds.length) {
        return res.data(
          { marketplaceRepositoryFileList: [], total: 0, page, totalPages: 1 },
          'Marketplace repository files'
        );
      }
      query.event_id = query.event_id
        ? { $in: eventIds.filter((eventId) => eventId === query.event_id) }
        : { $in: eventIds };
    }

    if (req.user.userType === 'VENDOR') {
      await getVendorMarketplaceFoodTruck(req.user._id);
      const [bids, applications] = await Promise.all([
        MarketplaceBidService.getByData(
          { vendor_user_id: req.user._id },
          { lean: true }
        ),
        MarketplaceApplicationService.getByData(
          { vendor_user_id: req.user._id },
          { lean: true }
        ),
      ]);
      const bidIds = bids.map((bid) => bid.bid_id);
      const applicationIds = applications.map((application) => application.application_id);
      if (!bidIds.length && !applicationIds.length) {
        return res.data(
          { marketplaceRepositoryFileList: [], total: 0, page, totalPages: 1 },
          'Marketplace repository files'
        );
      }
      if (query.bid_id) {
        query.bid_id = { $in: bidIds.filter((bidId) => bidId === query.bid_id) };
      } else {
        andFilters.push({
          $or: [
            { bid_id: { $in: bidIds } },
            { application_id: { $in: applicationIds } },
          ],
        });
      }
    }

    if (andFilters.length) {
      query.$and = andFilters;
    }

    const [attachments, total] = await Promise.all([
      MarketplaceAttachmentService.getByData(query, {
        paging: { page, limit },
        sort: { created_at: -1 },
        lean: true,
      }),
      MarketplaceAttachmentService.getCount(query),
    ]);
    let visibleAttachments = attachments;
    if (req.user.userType === 'CUSTOMER') {
      const eventIds = [
        ...new Set(attachments.map((item) => item.event_id).filter(Boolean)),
      ];
      const bidIds = [
        ...new Set(attachments.map((item) => item.bid_id).filter(Boolean)),
      ];
      const applicationIds = [
        ...new Set(
          attachments.map((item) => item.application_id).filter(Boolean)
        ),
      ];
      const [events, bids, applications] = await Promise.all([
        eventIds.length
          ? MarketplaceEventService.getByData(
              { event_id: { $in: eventIds } },
              { lean: true }
            )
          : [],
        bidIds.length
          ? MarketplaceBidService.getByData(
              { bid_id: { $in: bidIds } },
              { lean: true }
            )
          : [],
        applicationIds.length
          ? MarketplaceApplicationService.getByData(
              { application_id: { $in: applicationIds } },
              { lean: true }
            )
          : [],
      ]);
      const eventById = events.reduce((acc, event) => {
        acc[event.event_id] = event;
        return acc;
      }, {});
      const bidById = bids.reduce((acc, bid) => {
        acc[bid.bid_id] = bid;
        return acc;
      }, {});
      const applicationById = applications.reduce((acc, application) => {
        acc[application.application_id] = application;
        return acc;
      }, {});
      visibleAttachments = attachments.filter((attachment) => {
        if (!isSensitiveMarketplaceAttachment(attachment)) {
          return true;
        }
        const unlockState = getMarketplaceUnlockState({
          event: eventById[attachment.event_id],
          bid: bidById[attachment.bid_id],
          application: applicationById[attachment.application_id],
        });
        return unlockState.details_unlocked;
      });
    }
    const marketplaceRepositoryFileList =
      await decorateRepositoryFiles(visibleAttachments);

    return res.data(
      {
        marketplaceRepositoryFileList,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      'Marketplace repository files'
    );
  } catch (e) {
    return next(e);
  }
};

exports.repositoryFileAccess = async (req, res, next) => {
  try {
    const attachment = await getAccessibleAttachment(
      req.params.attachmentId,
      req.user
    );
    if (attachment.status === 'DELETED') {
      throw buildError('Marketplace repository file has been deleted', 410);
    }
    const action = req.query.download === 'true' ? 'DOWNLOAD' : 'VIEW';
    await createFileAudit(attachment, req, action);

    return res.data(
      { file_url: attachment.file_url, file_key: attachment.file_key, action },
      'Marketplace repository file access'
    );
  } catch (e) {
    return next(e);
  }
};

exports.updateRepositoryFileStatus = async (req, res, next) => {
  try {
    const attachment = await getAccessibleAttachment(
      req.params.attachmentId,
      req.user
    );
    const nextStatus = req.body.status;
    const reason = req.body.reason;

    if (attachment.status === 'DELETED') {
      throw buildError('Deleted marketplace files cannot be updated', 400);
    }

    attachment.status = nextStatus;
    attachment.status_reason = reason;
    attachment.status_updated_at = new Date();
    attachment.status_updated_by_user_id = req.user._id;

    if (nextStatus === 'DELETED') {
      attachment.deleted_at = new Date();
      attachment.deleted_by_user_id = req.user._id;
      if (attachment.file_key) {
        await removeObject(attachment.file_key);
      }
    }

    await attachment.save();

    if (attachment.attachment_type === 'EVENT_IMAGE') {
      await MarketplaceEventImageService.getModel().updateMany(
        {
          event_id: attachment.event_id,
          image_key: attachment.file_key,
        },
        {
          $set: {
            status: nextStatus,
            status_reason: reason,
            status_updated_at: new Date(),
            status_updated_by_user_id: req.user._id,
            ...(nextStatus === 'DELETED'
              ? {
                  deleted_at: new Date(),
                  deleted_by_user_id: req.user._id,
                }
              : {}),
          },
        }
      );
    }

    if (attachment.bid_id && nextStatus === 'DELETED') {
      const bid = await MarketplaceBidService.getByData(
        { bid_id: attachment.bid_id },
        { singleResult: true }
      );

      if (bid) {
        if (
          attachment.attachment_type === 'BID_MENU_PDF' &&
          bid.menu_pdf_key === attachment.file_key
        ) {
          bid.menu_pdf_url = null;
          bid.menu_pdf_key = null;
        }

        if (attachment.attachment_type === 'BID_IMAGE') {
          bid.image_urls = (bid.image_urls || []).filter(
            (url) => url !== attachment.file_url
          );
          bid.image_keys = (bid.image_keys || []).filter(
            (key) => key !== attachment.file_key
          );
        }

        if (
          attachment.attachment_type === 'PERMIT_LICENSE' ||
          attachment.attachment_type === REQUIREMENT_ATTACHMENT_TYPE
        ) {
          bid.permit_license_urls = (bid.permit_license_urls || []).filter(
            (url) => url !== attachment.file_url
          );
          bid.permit_license_keys = (bid.permit_license_keys || []).filter(
            (key) => key !== attachment.file_key
          );
        }

        if (
          attachment.attachment_type === 'AGREEMENT_DOCUMENT' &&
          bid.agreement_document_key === attachment.file_key
        ) {
          bid.agreement_document_url = null;
          bid.agreement_document_key = null;
        }

        await bid.save();
      }
    }

    const auditActionByStatus = {
      ARCHIVED: 'ARCHIVE',
      DELETED: 'DELETE',
      FLAGGED: 'FLAG',
    };
    await createFileAudit(
      attachment,
      req,
      auditActionByStatus[nextStatus],
      reason
    );

    return res.data(
      { marketplaceRepositoryFile: attachment },
      'Marketplace repository file updated'
    );
  } catch (e) {
    return next(e);
  }
};
