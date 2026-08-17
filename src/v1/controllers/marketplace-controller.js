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
  VendorComplianceDocumentService,
} = require('../services');
const {
  canAccessEventMarketplace,
  canUseCashPOS,
  canUseTapToPay,
} = require('../../helper/vendor-plan-helper');
const VendorComplianceService = require('../services/vendor-compliance-service');
const OperationalComplianceFormService = require('../services/operational-compliance-form-service');
const {
  addObjectFromBufferWithKey,
  addObjectWithKey,
  removeObject,
} = require('../../helper/aws');
const PaymentHelper = require('../../helper/payment-helper');
const CyberSourcePaymentHelper = require('../../helper/cybersource-payment-helper');
const DocuSignHelper = require('../../helper/docusign-helper');
const {
  buildAgreementEmailAttachments,
  excludeAgreementDocuments,
} = require('../../helper/marketplace-agreement-email-attachments');
const {
  reconcileVendorAgreementEnvelope,
} = require('../../helper/marketplace-vendor-agreement-reconciliation');
const {
  verifyMarketplaceAgreementDocuments,
} = require('../../helper/marketplace-agreement-document-verification');
const {
  buildSignedAgreementAttachmentContext,
  buildActiveAgreementIdentityKey,
  reserveActiveMarketplaceAgreement,
  resolveMarketplaceAgreementVendorContext,
} = require('../../helper/marketplace-agreement-vendor-context');
const MarketplaceCommunications = require('../../helper/marketplace-communications-helper');
const MailHelper = require('../../helper/mail-helper');
const {
  buildFoodVendorAwardDetailsHtml,
  buildEventVendorAwardDetailsHtml,
} = require('../../helper/marketplace-award-email-helper');
const {
  deliverCoordinatorDetailsEmail,
} = require('../../helper/marketplace-coordinator-details-email');
const {
  deriveMarketplaceVendorContact,
  sanitizeMarketplaceContactForCoordinator,
} = require('../../helper/marketplace-vendor-contact-helper');
const {
  getUnlockedMarketplaceCoordinatorContact,
} = require('../../helper/marketplace-coordinator-contact');
const {
  applyMarketplaceEventLocationPrivacy,
} = require('../../helper/marketplace-event-location-privacy');
const {
  isMarketplaceDetailsUnlocked,
  isMarketplaceLocationUnlocked,
} = require('../../helper/marketplace-vendor-access-policy');
const {
  buildVendorEventCloseState,
  getMarketplaceEventTiming,
} = require('../../helper/marketplace-event-close-helper');
const {
  getCoordinatorPaymentCompletion,
} = require('../../helper/marketplace-event-completion-helper');
const {
  getMarketplaceAwardRevocationDecision,
  getMarketplaceAwardRevocationError,
} = require('../../helper/marketplace-award-revocation');
const {
  refundPaidMarketplaceVendorFee,
} = require('../../helper/marketplace-vendor-fee-refund');
const {
  getCoordinatorAwardFeeAmount,
  getFinalEventPaymentAmounts,
  getMarketplaceVendorApplicationCheckoutFeeAmount,
} = require('../../helper/marketplace-regression-test-fees');
const {
  getPublicMarketplaceEventQuery,
  isPublicMarketplaceEventEligible,
  sanitizePublicMarketplaceEvent,
} = require('../../helper/public-marketplace-event-helper');
const { resolveMarketplaceTaxExemptionUpdate } = require('../../helper/marketplace-tax-exemption-helper');
const {
  isMarketplacePaymentMethodAllowed,
} = require('../../helper/marketplace-payment-policy-helper');
const { docusign } = require('../../config');
const {
  EventVendorApplicationModel,
  EventVendorProfileModel,
  OperationalNotificationModel,
} = require('../../models');
const {
  buildEventVendorRequirementSummary,
  getCoordinatorNotSelectTransition,
} = require('../../helper/marketplace-submission-lifecycle');
const {
  FOOD_APPLICATION_FILLED_STATUSES,
  hasFoodVendorAwardCapacity,
  isFoodVendorMarketplaceEvent,
  getAllowedMarketplaceVendorCount,
} = require('../../helper/marketplace-event-visibility-helper');
const {
  getFoodVendorAwardCapacity,
} = require('../../helper/marketplace-award-batch');
const {
  moderateMarketplaceText,
} = require('../../helper/marketplace-content-moderation');
const {
  buildMarketplaceMessageScope,
  assertMarketplaceMessageParticipantContext,
  resolveMarketplaceSubmissionParticipant,
} = require('../../helper/marketplace-message-context-helper');
const {
  getMarketplaceMessageUnreadState,
  buildMarketplaceMessageNotification,
} = require('../../helper/marketplace-message-thread-helper');
const {
  assertMarketplaceEventImageHasNoContactInfo,
} = require('../../helper/marketplace-image-contact-moderation');
const {
  buildTaxIdUpdate,
} = require('../../helper/event-coordinator-profile');
const {
  getAllowedBidCoverages,
  getAllowedAwardCoverages,
  getMarketplaceBudgetGuestCount,
  getMarketplaceVendorCapacity,
  getMarketplaceServiceRequirements,
  getMarketplaceFilledSlotSummary,
  isMarketplaceVendorReductionBlocked,
} = require('../../helper/marketplace-participation-helper');

const buildError = (message, code = 400) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeMarketplaceVendorIdentifier = (value) => {
  if (!value) return '';
  if (typeof value === 'object') {
    const nestedValue =
      value._id ||
        value.id ||
        value.vendor_user_id ||
        value.vendor_display_id ||
        value.display_id;
    return String(nestedValue || value.toString?.() || '').trim();
  }
  return String(value).trim();
};

const vendorIdentifierMatchesSubmission = (submission, rawIdentifier) => {
  const identifier = normalizeMarketplaceVendorIdentifier(rawIdentifier);
  if (!submission || !identifier) return false;

  const candidateIds = [
    submission.vendor_user_id,
    submission.vendor_display_id,
    submission.food_truck_id,
    submission.food_truck_id?._id,
    submission.food_truck_id?.display_id,
  ]
    .map(normalizeMarketplaceVendorIdentifier)
    .filter(Boolean);

  return candidateIds.some(
    (candidate) =>
      candidate === identifier ||
      (identifier.length === 6 && candidate.slice(-6) === identifier) ||
      (candidate.length === 6 && identifier.slice(-6) === candidate)
  );
};

const findMarketplaceSubmissionForVendorIdentifier = async (eventId, rawIdentifier) => {
  const [bids, applications] = await Promise.all([
    MarketplaceBidService.getByData({
      event_id: eventId,
      bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
    }),
    MarketplaceApplicationService.getByData({
      event_id: eventId,
      application_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
    }),
  ]);

  const matches = [...(bids || []), ...(applications || [])].filter(
    (submission) => vendorIdentifierMatchesSubmission(submission, rawIdentifier)
  );

  if (matches.length > 1) {
    throw buildError(
      'Multiple vendor submissions match that vendor identifier. Open the exact bid/application and try again.',
      409
    );
  }

  return matches[0] || null;
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
const COORDINATOR_AWARD_FEE_RATE = 0.015;
const VENDOR_EVENT_PROCESSING_RATE = 0.02;
const roundMoney = (value) => Number((Number(value || 0)).toFixed(2));
const ACTIVE_EVENT_STATUSES = ['OPEN', 'REOPENED'];
const REJECTION_EVENT_STATUSES = [...ACTIVE_EVENT_STATUSES, 'AWARDED'];
const assertEventOpenForSubmissionDecision = (event) => {
  if (
    !ACTIVE_EVENT_STATUSES.includes(String(event?.status || '').toUpperCase()) ||
    event?.vendor_applications_closed_at ||
    (event?.event_close_date && new Date(event.event_close_date) <= new Date())
  ) {
    throw buildError('This event is no longer open for vendor submission decisions.', 409);
  }
};
const assertEventOpenForRejectionDecision = (event) => {
  if (
    !REJECTION_EVENT_STATUSES.includes(String(event?.status || '').toUpperCase()) ||
    event?.vendor_applications_closed_at ||
    (event?.event_close_date && new Date(event.event_close_date) <= new Date())
  ) {
    throw buildError('This event is no longer open for vendor submission decisions.', 409);
  }
};
const DRAFT_TTL_DAYS = 7;
const REQUIREMENT_ATTACHMENT_TYPE = 'REQUIREMENT_DOCUMENT';
const MARKETPLACE_ATTACHMENT_REQUIREMENT_LABELS = {
  HEALTH_PERMIT: 'Sanitation Grade',
  BUSINESS_LICENSE: 'Business License/Permit',
  COI: 'Insurance',
  LIQUOR_LICENSE: 'Liquor License',
  EIN: 'EIN',
  W9: 'W-9',
};
const normalizeMarketplaceAttachmentRequest = (attachmentType, requirementLabel) => {
  if (MARKETPLACE_ATTACHMENT_REQUIREMENT_LABELS[attachmentType]) {
    return {
      attachmentType: REQUIREMENT_ATTACHMENT_TYPE,
      requirementLabel: normalizeRequirementLabel(
        requirementLabel || MARKETPLACE_ATTACHMENT_REQUIREMENT_LABELS[attachmentType]
      ),
    };
  }

  const normalizedAttachmentLabel = normalizeRequirementLabel(attachmentType);
  if (
    normalizedAttachmentLabel &&
    DEFAULT_REQUIREMENT_LABELS.some(
      (label) => label.toLowerCase() === normalizedAttachmentLabel.toLowerCase()
    )
  ) {
    return {
      attachmentType: REQUIREMENT_ATTACHMENT_TYPE,
      requirementLabel: normalizeRequirementLabel(
        requirementLabel || normalizedAttachmentLabel
      ),
    };
  }

  return {
    attachmentType,
    requirementLabel: normalizeRequirementLabel(requirementLabel),
  };
};
const DEFAULT_REQUIREMENT_LABELS = [
  'Insurance',
  'Sanitation Grade',
  'Fire Permit',
  'Liquor License',
  'Certificate of Insurance',
  'Business License/Permit',
  'Food Handler Permit',
  'Other',
];

const COMPLIANCE_DOCUMENT_LABELS = {
  HEALTH_PERMIT: 'Sanitation Grade',
  BUSINESS_LICENSE: 'Business License/Permit',
  COI: 'Insurance',
  LIQUOR_LICENSE: 'Liquor License',
};
const EXCLUDED_MARKETPLACE_REQUIREMENT_KEYS = new Set([
  'ein',
  'w9',
  'w_9',
  'w-9',
  'form w9',
  'form w-9',
  'tax_id',
  'tax id',
]);

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

const isMarketplaceEventClosedForSubmissionEdits = (event = {}) => {
  if (!event) return true;
  if (['CLOSED', 'AWARDED', 'CANCELLED'].includes(event.status)) return true;
  if (event.event_close_date && new Date(event.event_close_date) <= new Date()) return true;
  return false;
};

const assertMarketplaceSubmissionEditable = async (eventId) => {
  const event = await MarketplaceEventService.getByData(
    { event_id: eventId },
    { singleResult: true, lean: true }
  );
  if (!event) {
    throw buildError('Marketplace event not found', 404);
  }
  if (isMarketplaceEventClosedForSubmissionEdits(event)) {
    await closeExpiredMarketplaceEvents();
    throw buildError('Submitted marketplace records cannot be changed after the event is closed.', 410);
  }
  return event;
};

const preserveSavedMarketplaceLocationFields = (payload = {}, existingEvent = {}) => {
  if (!existingEvent || existingEvent.status === 'DRAFT') {
    return payload;
  }
  const savedLocationFields = [
    'event_address',
    'event_city',
    'event_state',
    'event_zip',
    'latitude',
    'longitude',
    'formatted_address',
    'geocoded_address',
    'place_id',
    'geocoding_provider',
    'geocoded_at',
  ];
  const nextPayload = { ...payload };
  savedLocationFields.forEach((field) => {
    nextPayload[field] = existingEvent[field];
  });
  return nextPayload;
};

const getVendorDisplayId = (foodTruckId) => {
  const rawId =
    typeof foodTruckId === 'object'
      ? foodTruckId?._id || foodTruckId?.id || ''
      : foodTruckId || '';
  const suffix = String(rawId).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `Vendor RTC - ${suffix || 'MASKED'}`;
};

const QA_ARCHIVED_EVENT_STATUSES = ['AWARDED', 'CANCELLED', 'ARCHIVED'];

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
  return getAllowedMarketplaceVendorCount(body);
};

const normalizeMarketplaceEventPayload = (body = {}, { existingEvent = null } = {}) => {
  const status = body.status || existingEvent?.status || 'OPEN';
  const isDraft = status === 'DRAFT';
  const eventVendorNeeds = asArray(body.event_vendor_needs).map((need) => ({
    ...need,
    type_description: ['SERVICE', 'OTHER'].includes(need?.vendor_type)
      ? String(need?.type_description || '').trim()
      : null,
  }));
  if (!isDraft) {
    const missingDescription = eventVendorNeeds.find(
      (need) =>
        ['SERVICE', 'OTHER'].includes(need.vendor_type) &&
        !need.type_description
    );
    if (missingDescription) {
      throw buildError(
        `Specify the ${missingDescription.vendor_type.toLowerCase()} vendor type.`,
        400
      );
    }
  }
  body = { ...body, event_vendor_needs: eventVendorNeeds };
  const serviceTypes = asArray(body.service_types?.length ? body.service_types : body.service_type);
  let serviceStyles = asArray(body.service_styles);
  let primaryServiceStyle = body.primary_service_style || existingEvent?.primary_service_style || '';

  if (serviceTypes.includes('Food Truck')) {
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

  const vipSectionEnabled = Boolean(body.vip_section_enabled);
  const fullyCateredEvent = Boolean(body.fully_catered_event);
  const cateredVipSectionEnabled =
    vipSectionEnabled && !fullyCateredEvent && Boolean(body.catered_vip_section_enabled);
  const gaFoodSalesAllowed =
    cateredVipSectionEnabled && Boolean(body.ga_food_sales_allowed);
  const waiveVendorFeeForCombinedAward =
    gaFoodSalesAllowed && Boolean(body.waive_vendor_fee_for_combined_award);
  const separateVipVendorRequired =
    cateredVipSectionEnabled && Boolean(body.separate_vip_vendor_required);
  const paymentResponsibility = fullyCateredEvent
    ? 'COORDINATOR'
    : cateredVipSectionEnabled
      ? gaFoodSalesAllowed ? 'BOTH' : 'COORDINATOR'
      : 'VENDOR';
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
  const freeFoodOffered =
    body.free_food_offered === true || body.free_food_offered === false
      ? body.free_food_offered
      : null;
  const freeFoodProvider = freeFoodOffered
    ? String(body.free_food_provider || '').trim()
    : null;
  const vendorsRequiredToGiveawayFood =
    freeFoodOffered === true
      ? body.vendors_required_to_giveaway_food === true ||
        body.vendors_required_to_giveaway_food === false
        ? body.vendors_required_to_giveaway_food
        : null
      : null;
  const vipGuestCount = vipSectionEnabled
    ? Math.max(0, Number(body.vip_guest_count || 0))
    : 0;
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
  const taxExemptionUpdate = resolveMarketplaceTaxExemptionUpdate(body, existingEvent);

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
    free_food_offered: freeFoodOffered,
    free_food_provider: freeFoodProvider,
	    vendors_required_to_giveaway_food: vendorsRequiredToGiveawayFood,
    catered_vip_section_enabled: cateredVipSectionEnabled,
    vip_section_enabled: vipSectionEnabled,
    vip_section_details: vipSectionEnabled
      ? String(body.vip_section_details || '').trim() || null
      : null,
    fully_catered_event: fullyCateredEvent,
    ga_food_sales_allowed: gaFoodSalesAllowed,
    waive_vendor_fee_for_combined_award: waiveVendorFeeForCombinedAward,
    vendor_fee_payment_deadline: body.vendor_fee_payment_deadline || null,
    separate_vip_vendor_required: separateVipVendorRequired,
    vip_guest_count: vipGuestCount,
    ...taxExemptionUpdate,
		    draft_expires_at:
	      isDraft && !existingEvent?.draft_expires_at
        ? new Date(Date.now() + DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000)
        : existingEvent?.draft_expires_at || null,
  });

  normalized.number_of_guests = Math.max(0, Number(normalized.number_of_guests || 0));
  if (!vipSectionEnabled) {
    normalized.vip_ticket_quantity = 0;
    normalized.vip_ticket_price = 0;
  }

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
  if (
    Number(normalized.number_of_guests || 0) +
      Number(normalized.vip_guest_count || 0) <
    1
  ) {
    throw buildError('At least one regular or VIP guest is required.', 400);
  }

  if (normalized.event_type === 'Other' && !hasText(normalized.event_type_other)) {
    throw buildError('Other event type details are required.', 400);
  }
  if (
    normalized.free_food_offered !== true &&
    normalized.free_food_offered !== false
  ) {
    throw buildError('Please answer whether free food will be offered.', 400);
  }
  if (normalized.free_food_offered === true) {
    if (!hasText(normalized.free_food_provider)) {
      throw buildError('Please enter which company/vendor will offer free food.', 400);
    }
    if (
      normalized.vendors_required_to_giveaway_food !== true &&
      normalized.vendors_required_to_giveaway_food !== false
    ) {
      throw buildError(
        'Please answer whether vendors are required to give away food.',
        400
      );
    }
  }
  if (
    cateredVipSectionEnabled &&
    body.ga_food_sales_allowed !== true &&
    body.ga_food_sales_allowed !== false
  ) {
    throw buildError(
      'Please answer whether vendors may sell food to GA guests.',
      400
    );
  }
  if (
    gaFoodSalesAllowed &&
    body.waive_vendor_fee_for_combined_award !== true &&
    body.waive_vendor_fee_for_combined_award !== false
  ) {
    throw buildError(
      'Please answer whether the vendor fee is waived for a combined award.',
      400
    );
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
  if (
    ['VENDOR', 'BOTH'].includes(paymentResponsibility) &&
    !normalized.vendor_fee_payment_deadline
  ) {
    throw buildError('Last Date to Accept Payments is required when vendors pay a fee.', 400);
  }
  if (
    normalized.vendor_fee_payment_deadline &&
    normalized.event_date &&
    new Date(normalized.vendor_fee_payment_deadline) >= new Date(normalized.event_date)
  ) {
    throw buildError('Last Date to Accept Payments must be before the event date.', 400);
  }
  if (
    normalized.vendor_fee_payment_deadline &&
    normalized.event_close_date &&
    new Date(normalized.vendor_fee_payment_deadline) <= new Date(normalized.event_close_date)
  ) {
    throw buildError(
      'Last Date to Accept Payments must be after the application/bid deadline.',
      400
    );
  }
  if (
    paymentResponsibility === 'BOTH' &&
    cateredVipSectionEnabled &&
    Number(normalized.vip_guest_count || 0) < 1
  ) {
    throw buildError('VIP guest count is required for the catered VIP section.', 400);
  }
  if (['COORDINATOR', 'BOTH'].includes(paymentResponsibility)) {
    const budgetGuestCount = getMarketplaceBudgetGuestCount(normalized);
    const minimumBudget = budgetGuestCount * 25;
    if (budgetedAmount < minimumBudget) {
      throw buildError(`Budget amount must be at least $${minimumBudget.toFixed(2)} for the paid guest count.`, 400);
    }
  }
  normalized.number_of_guests = Number(normalized.number_of_guests);
  if (normalized.ticket_sales_enabled) {
    const gaQuantity = Number(normalized.ga_ticket_quantity || 0);
    const vipQuantity = Number(normalized.vip_ticket_quantity || 0);
    if (gaQuantity + vipQuantity < 1) {
      throw buildError('At least one GA or VIP ticket is required.', 400);
    }
  }
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

const notifyMissedVendorFeePayments = async () => {
  const overdueApplications = await MarketplaceApplicationService.getByData({
    application_status: 'PAYMENT_DUE',
    payment_status: { $ne: 'PAID' },
    payment_due_at: { $lte: new Date() },
    payment_missed_notified_at: null,
  });
  for (const application of overdueApplications) {
    const event = await MarketplaceEventService.getByData(
      { event_id: application.event_id },
      { singleResult: true, lean: true }
    );
    if (!event) continue;
    await MarketplaceCommunications.sendMarketplaceCommunications([
      {
        userId: event.customer_user_id,
        title: 'Vendor failed to submit payment',
        body: `Please reopen event or revoke the award and award another vendor. Contact support with any questions or help: ${MARKETPLACE_PHONE_NUMBER}`,
        data: {
          notificationType: 'MARKETPLACE_VENDOR_PAYMENT_MISSED',
          eventId: event.event_id,
          applicationId: application.application_id,
        },
        channels: ['push', 'email'],
        metadata: { eventId: event.event_id, applicationId: application.application_id },
      },
      {
        userId: application.vendor_user_id,
        title: 'Vendor event payment deadline missed',
        body: `Your payment deadline for ${event.event_name || 'the event'} has passed. Contact the coordinator in the app or RTC support at ${MARKETPLACE_PHONE_NUMBER}.`,
        data: {
          notificationType: 'MARKETPLACE_VENDOR_PAYMENT_MISSED',
          eventId: event.event_id,
          applicationId: application.application_id,
        },
        channels: ['push', 'email'],
        metadata: { eventId: event.event_id, applicationId: application.application_id },
      },
    ]);
    application.payment_missed_notified_at = new Date();
    await application.save();
  }
};

const closeExpiredMarketplaceEvents = async () => {
  await notifyMissedVendorFeePayments();
  const now = new Date();
  const expiredEvents = await MarketplaceEventService.getByData(
    {
      status: { $in: ACTIVE_EVENT_STATUSES },
      event_close_date: { $lte: now },
      vendor_applications_closed_at: null,
    },
    { lean: true }
  );
  if (!expiredEvents.length) {
    return [];
  }
  await MarketplaceEventService.getModel().updateMany(
    { event_id: { $in: expiredEvents.map((event) => event.event_id) } },
    { $set: { vendor_applications_closed_at: now } }
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
  if (event.vendor_applications_closed_at || (event.event_close_date && new Date(event.event_close_date) <= new Date())) {
    await closeExpiredMarketplaceEvents();
    throw buildError('This event is closed to new submissions.', 410);
  }
};

const assertFoodVendorEventHasCapacity = async (event) => {
  const [awardedBids, awardedApplications] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: event.event_id, bid_status: 'AWARDED', archived_at: null },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        application_status: { $in: FOOD_APPLICATION_FILLED_STATUSES },
        archived_at: null,
      },
      { lean: true }
    ),
  ]);
  if (!hasFoodVendorAwardCapacity({ event, bids: awardedBids, applications: awardedApplications })) {
    throw buildError('All food vendor award capacity has already been filled.', 409);
  }
};

const assertVendorCanSubmitRound = async (event, vendorUserId) => {
  const [previousBid, previousApplication] = await Promise.all([
    MarketplaceBidService.getByData(
      {
        event_id: event.event_id,
        vendor_user_id: vendorUserId,
        bid_status: { $nin: ['DRAFT', 'PENDING_SIGNATURE', 'WITHDRAWN'] },
      },
      { singleResult: true, lean: true }
    ),
    MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        vendor_user_id: vendorUserId,
        application_status: { $nin: ['DRAFT', 'PENDING_SIGNATURE', 'WITHDRAWN'] },
      },
      { singleResult: true, lean: true }
    ),
  ]);
  if (previousBid || previousApplication) {
    throw buildError('You already submitted for this event and cannot submit again after reopen.', 409);
  }
};

const hasMarketplaceAwards = async (eventId) => {
  const [awardedBid, awardedApplication] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: eventId, bid_status: 'AWARDED' },
      { singleResult: true, lean: true }
    ),
    MarketplaceApplicationService.getByData(
      {
        event_id: eventId,
        application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
      },
      { singleResult: true, lean: true }
    ),
  ]);
  return !!(awardedBid || awardedApplication);
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
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
      'image/heif',
    ],
  },
  BID_IMAGE: {
    folder: 'marketplace/bids/images',
    allowedMimeTypes: [
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
      'image/heif',
    ],
  },
  APPLICATION_MENU_PDF: {
    folder: 'marketplace/applications/menu-pdfs',
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
      'image/heif',
    ],
  },
  APPLICATION_IMAGE: {
    folder: 'marketplace/applications/images',
    allowedMimeTypes: [
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
      'image/heif',
    ],
  },
  PERMIT_LICENSE: {
    folder: 'marketplace/bids/permits-licenses',
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
      'image/heif',
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
      'image/heif',
    ],
  },
  REQUIREMENT_DOCUMENT: {
    folder: 'marketplace/requirements',
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/heic',
      'image/heif',
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
    if (bid.bid_status === 'SUBMITTED') return true;
    if ((bid.awarded_coverage || bid.guest_coverage) !== 'BOTH') return true;
    return bid.combined_vendor_fee_waived === true || bid.payment_status === 'PAID';
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
  const detailsUnlocked = isMarketplaceDetailsUnlocked({
    matchSatisfied,
    scenario,
    coordinatorPaymentSatisfied,
    vendorPaymentSatisfied,
  });
  const locationUnlocked = isMarketplaceLocationUnlocked({
    bid,
    application,
    vendorPaymentSatisfied,
  });

  return {
    scenario,
    details_unlocked: !!detailsUnlocked,
    location_unlocked: !!locationUnlocked,
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

const isExcludedMarketplaceRequirementLabel = (label) => {
  const normalizedLabel = normalizeRequirementLabel(label);
  const normalizedKey = String(normalizedLabel || '').trim().toLowerCase();
  return EXCLUDED_MARKETPLACE_REQUIREMENT_KEYS.has(normalizedKey);
};

const assertMarketplaceRequirementAllowed = (label) => {
  if (isExcludedMarketplaceRequirementLabel(label)) {
    throw buildError('EIN and W-9 documents are not part of event submissions.', 400);
  }
};

const REQUIREMENT_LABEL_COMPLIANCE_TYPES = {
  Insurance: 'COI',
  'Certificate of Insurance': 'COI',
  'Sanitation Grade': 'HEALTH_PERMIT',
  'Business License/Permit': 'BUSINESS_LICENSE',
  'Liquor License': 'LIQUOR_LICENSE',
};

const hasVerifiedProfileRequirementDocument = async (foodTruckId, label) => {
  const requirementLabel = normalizeRequirementLabel(label);
  const documentType = REQUIREMENT_LABEL_COMPLIANCE_TYPES[requirementLabel];
  if (!foodTruckId || !documentType) return false;

  const documents = await VendorComplianceDocumentService.getByData(
    {
      food_truck_id: foodTruckId,
      document_type: documentType,
      review_status: 'verified',
      archived_at: null,
    },
    { lean: true, sort: { created_at: -1 } }
  );

  const now = new Date();
  return (documents || []).some((document) => {
    if (!document?.expiration_date) return true;
    const expirationDate = new Date(document.expiration_date);
    return (
      !Number.isNaN(expirationDate.getTime()) &&
      expirationDate.getTime() >= now.getTime()
    );
  });
};

const hasSatisfiedLiquorLicenseRequirement = async ({
  event,
  foodTruckId,
  liquorLicenseConfirmed,
}) => {
  if (!event?.alcohol_required) return true;
  if (liquorLicenseConfirmed) return true;
  return hasVerifiedProfileRequirementDocument(foodTruckId, 'Liquor License');
};

const normalizeVendorDocumentName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const getVendorDocumentTypeForAttachment = (attachmentType, requirementLabel) => {
  const label = String(requirementLabel || '').toLowerCase();
  if (attachmentType === 'AGREEMENT_DOCUMENT') {
    return 'OTHER';
  }
  if (label.includes('insurance')) {
    return 'INSURANCE';
  }
  if (label.includes('license')) {
    return 'LICENSE';
  }
  if (label.includes('permit')) {
    return 'PERMIT';
  }
  return 'OTHER';
};

const getVendorDocumentTitleForAttachment = (attachment = {}) => {
  if (attachment.attachment_type === 'AGREEMENT_DOCUMENT') {
    return 'Signed Marketplace Agreement';
  }
  if (attachment.requirement_label) {
    return attachment.requirement_label;
  }
  if (
    attachment.attachment_type === 'BID_MENU_PDF' ||
    attachment.attachment_type === 'APPLICATION_MENU_PDF'
  ) {
    return 'Marketplace Sample Menu';
  }
  return attachment.original_name || 'Marketplace Document';
};

const syncMarketplaceAttachmentToVendorDocuments = async ({
  foodTruckId,
  attachment,
  uploadedByUserId,
}) => {
  if (!foodTruckId || !attachment?.file_url) {
    return null;
  }

  if (
    ![
      REQUIREMENT_ATTACHMENT_TYPE,
      'PERMIT_LICENSE',
      'AGREEMENT_DOCUMENT',
    ].includes(attachment.attachment_type)
  ) {
    return null;
  }

  const foodTruck = await FoodTruckService.getByData(
    { _id: foodTruckId },
    { singleResult: true }
  );
  if (!foodTruck) {
    return null;
  }

  const title = getVendorDocumentTitleForAttachment(attachment);
  const normalizedTitle = normalizeVendorDocumentName(title);
  const activeMatchingDocuments = (foodTruck.documents || []).filter((document) => {
    const existingTitle = normalizeVendorDocumentName(
      document.title || document.original_name
    );
    return (
      existingTitle === normalizedTitle &&
      document.document_status !== 'ARCHIVED'
    );
  });

  const alreadyCurrent = activeMatchingDocuments.some(
    (document) =>
      (attachment.file_key && document.file_key === attachment.file_key) ||
      (attachment.file_url && document.file_url === attachment.file_url)
  );
  if (alreadyCurrent) {
    return foodTruck;
  }

  const archiveDate = new Date();
  activeMatchingDocuments.forEach((document) => {
    document.document_status = 'ARCHIVED';
    document.archived_at = archiveDate;
    document.archived_reason = 'Replaced by newer marketplace document';
    document.archived_by_user_id = uploadedByUserId || attachment.uploaded_by_user_id;
    document.replaced_by_file_key = attachment.file_key || null;
  });

  foodTruck.documents.push({
    title,
    document_type: getVendorDocumentTypeForAttachment(
      attachment.attachment_type,
      attachment.requirement_label
    ),
    file_url: attachment.file_url,
    file_key: attachment.file_key,
    original_name: attachment.original_name,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
    uploaded_by_user_id: uploadedByUserId || attachment.uploaded_by_user_id,
    uploaded_at: new Date(),
    document_status: 'ACTIVE',
  });

  await foodTruck.save();
  return foodTruck;
};

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
    attachment.status = 'ARCHIVED';
    attachment.status_reason = reason;
    attachment.status_updated_at = new Date();
    attachment.status_updated_by_user_id = actorUserId;
    await attachment.save();
  }

  return existingAttachments;
};

const getAnnualAgreementExpiry = (signedAt = new Date()) => {
  const expiry = new Date(signedAt);
  if (Number.isNaN(expiry.getTime())) {
    throw buildError('A valid agreement signature date is required.', 400);
  }
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry;
};

const getValidVendorAgreement = async (vendorUserId, eventVendorProfileId = null) =>
  MarketplaceVendorAgreementService.getByData(
    {
      vendor_user_id: vendorUserId,
      ...(eventVendorProfileId
        ? { event_vendor_profile_id: eventVendorProfileId }
        : {}),
      status: 'SIGNED',
      expires_at: { $gt: new Date() },
      governance_template_id: docusign.governanceTemplateId,
      nda_template_id: docusign.ndaTemplateId,
      governance_version: docusign.governanceVersion,
      nda_version: docusign.ndaVersion,
      required_document_count: { $gte: 2 },
      required_signature_document_count: { $gte: 2 },
      required_templates_verified_at: { $ne: null },
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

const writeVendorAgreementAudit = async (agreement, action, options = {}) => {
  try {
    await MarketplaceAgreementAuditService.create({
      event_id: agreement.event_id,
      agreement_id: agreement.agreement_id || null,
      agreement_envelope_id: agreement.envelope_id || null,
      vendor_user_id: agreement.vendor_user_id || null,
      event_vendor_profile_id: agreement.event_vendor_profile_id || null,
      application_id: agreement.application_id || null,
      action,
      agreement_status: options.status || agreement.status || null,
      source: options.source || 'SYSTEM',
      message: options.message || null,
    });
  } catch (auditError) {
    console.error('Marketplace agreement audit failed', auditError?.message || auditError);
  }
};

const verifyVendorAgreementEnvelopeDocuments = async (agreement) =>
  verifyMarketplaceAgreementDocuments({
    agreement,
    getEnvelopeDocuments: DocuSignHelper.getEnvelopeDocuments,
    getEnvelopeRecipients: DocuSignHelper.getEnvelopeRecipients,
    wait: (attempt) => new Promise((resolve) => setTimeout(resolve, attempt * 250)),
    recordAudit: (action, status, message) =>
      writeVendorAgreementAudit(agreement, action, { status, message }),
  });

const createPendingVendorAgreementRecipientView = async ({ agreement, returnUrl }) => {
  const recipients = await DocuSignHelper.getEnvelopeRecipients(agreement.envelope_id);
  const signer = DocuSignHelper.getPendingEmbeddedVendorSigner(
    recipients,
    agreement.vendor_user_id
  );
  if (!signer) return null;
  return DocuSignHelper.createRecipientView({
    envelopeId: agreement.envelope_id,
    signerName: signer.name || agreement.signer_name,
    signerEmail: signer.email || agreement.signer_email,
    vendorUserId: agreement.vendor_user_id,
    clientUserId: signer.clientUserId || agreement.vendor_user_id,
    recipientId: signer.recipientId,
    // Every embedded vendor signing step must return to the vendor app. A
    // server-level website URL must not replace the mobile deep link on a
    // continued Governance/NDA signing step.
    returnUrl: returnUrl || getVendorAgreementReturnUrl(),
  });
};

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
    const sameEnvelope =
      existingAttachment.docusign_envelope_id &&
      existingAttachment.docusign_envelope_id === agreement.envelope_id;
    if (!sameEnvelope && !agreement.reuse_existing_signed_document) {
      await archiveReplacementAttachments({
        eventId: agreement.event_id,
        bidId: agreement.bid_id || null,
        applicationId: agreement.application_id || null,
        attachmentType: 'AGREEMENT_DOCUMENT',
        actorUserId: agreement.vendor_user_id,
        reason: 'Replaced by newly signed marketplace agreement',
      });
    } else {
      const [bid, application] = await Promise.all([
        agreement.bid_id
          ? MarketplaceBidService.getByData(
              { bid_id: agreement.bid_id },
              { singleResult: true, lean: true }
            )
          : null,
        agreement.application_id
          ? MarketplaceApplicationService.getByData(
              { application_id: agreement.application_id },
              { singleResult: true, lean: true }
            )
          : null,
      ]);
      await syncMarketplaceAttachmentToVendorDocuments({
        foodTruckId: agreement.food_truck_id || bid?.food_truck_id || application?.food_truck_id,
        attachment: existingAttachment,
        uploadedByUserId: agreement.vendor_user_id,
      });
      return existingAttachment;
    }
  }

  const currentAttachment = await MarketplaceAttachmentService.getByData(
    {
      event_id: agreement.event_id,
      bid_id: agreement.bid_id || null,
      application_id: agreement.application_id || null,
      attachment_type: 'AGREEMENT_DOCUMENT',
      status: 'ACTIVE',
    },
    { singleResult: true, sort: { created_at: -1 } }
  );

  if (currentAttachment) {
    const [bid, application] = await Promise.all([
      agreement.bid_id
        ? MarketplaceBidService.getByData(
            { bid_id: agreement.bid_id },
            { singleResult: true, lean: true }
          )
        : null,
      agreement.application_id
        ? MarketplaceApplicationService.getByData(
            { application_id: agreement.application_id },
            { singleResult: true, lean: true }
          )
        : null,
    ]);
    await syncMarketplaceAttachmentToVendorDocuments({
      foodTruckId: agreement.food_truck_id || bid?.food_truck_id || application?.food_truck_id,
      attachment: currentAttachment,
      uploadedByUserId: agreement.vendor_user_id,
    });
    return currentAttachment;
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
    docusign_envelope_id: agreement.envelope_id,
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

  const [bid, application] = await Promise.all([
    agreement.bid_id
      ? MarketplaceBidService.getByData(
          { bid_id: agreement.bid_id },
          { singleResult: true, lean: true }
        )
      : null,
    agreement.application_id
      ? MarketplaceApplicationService.getByData(
          { application_id: agreement.application_id },
          { singleResult: true, lean: true }
        )
      : null,
  ]);
  await syncMarketplaceAttachmentToVendorDocuments({
    foodTruckId: agreement.food_truck_id || bid?.food_truck_id || application?.food_truck_id,
    attachment,
    uploadedByUserId: agreement.vendor_user_id,
  });

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
    location_unlocked: false,
    obligations: {
      match_satisfied: false,
      coordinator_payment_satisfied: false,
      vendor_payment_satisfied: false,
      agreement_satisfied: isAgreementSatisfied(plainEvent),
    },
  };

  const locationSafeEvent = applyMarketplaceEventLocationPrivacy(plainEvent, {
    locationUnlocked: fullAccess || marketplace_unlock.location_unlocked,
  });

  if (fullAccess || marketplace_unlock.details_unlocked) {
    return {
      ...locationSafeEvent,
      marketplace_unlock,
    };
  }

  let redacted = {
    ...locationSafeEvent,
    marketplace_unlock,
    contracts_locked: true,
    logistics_locked: true,
  };

  [
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
	    'coordinator_tax_identifier_type',
	    'coordinator_tax_identifier',
	    'coordinator_payment_preference',
	    'coordinator_payment_handle',
	    'coordinator_payment_qr_code_url',
	    'coordinator_payment_qr_code_key',
	    'coordinator_direct_deposit_routing_number',
	    'coordinator_direct_deposit_account_number',
	    'coordinator_contact',
	    'coordinatorContact',
	    'coordinator_contact_name',
	    'coordinatorContactName',
	    'coordinator_phone',
	    'coordinatorPhone',
	    'coordinator_email',
	    'coordinatorEmail',
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

  let redacted = {
    ...sanitizeMarketplaceContactForCoordinator(plainRecord),
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
    'coordinator_contact',
    'coordinatorContact',
    'coordinator_contact_name',
    'coordinatorContactName',
    'coordinator_phone',
    'coordinatorPhone',
    'coordinator_email',
    'coordinatorEmail',
  ].forEach((field) => {
    delete redacted[field];
  });

  redacted = applyMarketplaceEventLocationPrivacy(redacted, {
    locationUnlocked: unlockState?.location_unlocked === true,
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

const getVendorMarketplaceFoodTruck = async (userId, options = {}) => {
  const { enforceCompliance = true } = options;
  const vendorUser = await UserService.getById(userId);
  if (
    !vendorUser ||
    vendorUser.inactive ||
    vendorUser.verified === false ||
    vendorUser.requestStatus !== 'APPROVED'
  ) {
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
      'Elite plan is required to access Event Marketplace.',
      403
    );
  }

  if (enforceCompliance) {
    const summary = await VendorComplianceService.calculateComplianceSummary(foodTruck);
    if (!summary.eligible || !summary.can_bid) {
      const error = buildError(summary.message || 'Please update your compliance paperwork.', 409);
      error.compliance = summary;
      throw error;
    }
  }

  return foodTruck;
};

const attachVerifiedComplianceDocumentsToSubmission = async ({
  eventId,
  foodTruck,
  submission,
  submissionType,
  uploadedByUserId,
}) => {
  if (!eventId || !foodTruck?._id || !submission) {
    return submission;
  }

  const documents = await VendorComplianceDocumentService.getByData(
    {
      food_truck_id: foodTruck._id,
      document_type: { $in: Object.keys(COMPLIANCE_DOCUMENT_LABELS) },
      review_status: 'verified',
      archived_at: null,
      $or: [{ expiration_date: null }, { expiration_date: { $gte: new Date() } }],
    },
    { lean: true, sort: { created_at: -1 } }
  );

  const latestByType = documents.reduce((acc, document) => {
    if (!acc[document.document_type]) {
      acc[document.document_type] = document;
    }
    return acc;
  }, {});

  let changed = false;
  const existingUrls = new Set(submission.permit_license_urls || []);
  const existingKeys = new Set((submission.permit_license_keys || []).filter(Boolean));

  for (const [documentType, requirementLabel] of Object.entries(
    COMPLIANCE_DOCUMENT_LABELS
  )) {
    const document = latestByType[documentType];
    if (!document?.file_url) {
      continue;
    }

    const requirementKey = getRequirementKey(requirementLabel);
    const duplicateQuery = {
      event_id: eventId,
      attachment_type: REQUIREMENT_ATTACHMENT_TYPE,
      requirement_key: requirementKey,
      status: 'ACTIVE',
      ...(submissionType === 'bid'
        ? { bid_id: submission.bid_id }
        : { application_id: submission.application_id }),
    };
    const existingAttachment = await MarketplaceAttachmentService.getByData(
      duplicateQuery,
      { singleResult: true, lean: true }
    );

    if (!existingAttachment) {
      await MarketplaceAttachmentService.create({
        event_id: eventId,
        bid_id: submissionType === 'bid' ? submission.bid_id : null,
        application_id:
          submissionType === 'application' ? submission.application_id : null,
        attachment_type: REQUIREMENT_ATTACHMENT_TYPE,
        requirement_label: requirementLabel,
        requirement_key: requirementKey,
        file_url: document.file_url,
        file_key: document.file_key,
        original_name: document.original_name || document.title || requirementLabel,
        mime_type: document.mime_type,
        size_bytes: document.size_bytes,
        uploaded_by_user_id: uploadedByUserId,
      });
    }

    if (!existingUrls.has(document.file_url)) {
      submission.permit_license_urls = [
        ...(submission.permit_license_urls || []),
        document.file_url,
      ];
      existingUrls.add(document.file_url);
      changed = true;
    }
    if (document.file_key && !existingKeys.has(document.file_key)) {
      submission.permit_license_keys = [
        ...(submission.permit_license_keys || []),
        document.file_key,
      ];
      existingKeys.add(document.file_key);
      changed = true;
    }
  }

  if (changed && typeof submission.save === 'function') {
    await submission.save();
  }

  return submission;
};

const assertCustomerEventCoordinator = async (userId) => {
  const customer = await UserService.getById(userId);
  if (
    customer?.isEventCoordinator &&
    !customer.eventCoordinatorTaxIdEncrypted &&
    customer.eventCoordinatorEin
  ) {
    Object.assign(
      customer,
      buildTaxIdUpdate({
        type: customer.eventCoordinatorTaxIdType || 'EIN',
        value: customer.eventCoordinatorEin,
      })
    );
    await customer.save();
  }

  if (
    !customer ||
    !customer.isEventCoordinator ||
    !customer.eventCoordinatorTaxIdEncrypted
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
    const eventVendorProfile = await EventVendorProfileModel.findOne({
      vendor_user_id: user._id,
      status: 'ACTIVE',
      review_status: 'APPROVED',
    }).lean();
    if (!eventVendorProfile) {
      await getVendorMarketplaceFoodTruck(user._id);
    }
    const event = await MarketplaceEventService.getByData(
      { event_id: eventId },
      { singleResult: true }
    );

    if (!event) {
      throw buildError('Marketplace event not found', 404);
    }

    const eventVendorEligible = eventVendorProfile && (event.event_vendor_needs || []).some(
      (need) =>
        Number(need.quantity || 0) > 0 &&
        (eventVendorProfile.vendor_types || []).includes(need.vendor_type)
    );
    if (ACTIVE_EVENT_STATUSES.includes(event.status) && (!eventVendorProfile || eventVendorEligible)) {
      return event;
    }

    const [vendorBid, vendorApplication, eventVendorApplication] = await Promise.all([
      MarketplaceBidService.getByData(
        {
          event_id: eventId,
          vendor_user_id: user._id,
          bid_status: { $nin: ['WITHDRAWN'] },
        },
        { singleResult: true }
      ),
      MarketplaceApplicationService.getByData(
        {
          event_id: eventId,
          vendor_user_id: user._id,
          application_status: { $nin: ['WITHDRAWN'] },
        },
        { singleResult: true }
      ),
      EventVendorApplicationModel.findOne({
        event_id: eventId,
        vendor_user_id: user._id,
      }).lean(),
    ]);

    if (!vendorBid && !vendorApplication && !eventVendorApplication) {
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

const getQuestionUnreadState = (plainQuestion, viewer) => {
  return getMarketplaceMessageUnreadState(plainQuestion, viewer);
};

const toNotificationEventLabel = (event) =>
  event?.event_name || event?.name || 'Marketplace event';

const toNotificationEventDate = (event) =>
  event?.event_date || event?.start_date || event?.event_start_date || null;

const buildVendorSubmissionNotification = ({
  id,
  type,
  event,
  status,
  title,
  subtitle,
  bidId = null,
  applicationId = null,
}) => ({
  id,
  type,
  event_id: event?.event_id || null,
  event_name: toNotificationEventLabel(event),
  event_date: toNotificationEventDate(event),
  title,
  subtitle,
  status,
  bid_id: bidId,
  application_id: applicationId,
});

const getVendorSubmissionNotificationCopy = (status, submissionType) => {
  const normalizedStatus = String(status || '').toUpperCase();
  const label = submissionType === 'application' ? 'application' : 'bid';

  if (normalizedStatus === 'REVOKED') {
    return {
      title: `Event ${label} award revoked`,
      subtitle: 'Open the event to review the update.',
    };
  }

  if (['AWARDED', 'ACCEPTED', 'CONFIRMED'].includes(normalizedStatus)) {
    return {
      title: `Event ${label} accepted`,
      subtitle: 'Open the event to review next steps.',
    };
  }

  if (['PAYMENT_DUE', 'PENDING_PAYMENT'].includes(normalizedStatus)) {
    return {
      title: 'Payment/action required',
      subtitle: 'Complete the required marketplace payment to continue.',
    };
  }

  if (['NOT_AWARDED', 'DECLINED', 'NOT_SELECTED'].includes(normalizedStatus)) {
    return {
      title: `Event ${label} not selected`,
      subtitle: 'Open the event to review the update.',
    };
  }

  if (['REVISION_REQUESTED', 'UPDATE_REQUESTED'].includes(normalizedStatus)) {
    return {
      title: `${label === 'bid' ? 'Bid' : 'Application'} revision requested`,
      subtitle: 'Open the event to revise your submission.',
    };
  }

  return null;
};

const sanitizeMarketplaceQuestion = (
  question,
  { includeBlocked = false, viewer = null } = {}
) => {
  const plainQuestion = toPlainObject(question);
  const isBlocked = plainQuestion.status === 'BLOCKED';

  return {
    question_id: plainQuestion.question_id,
    event_id: plainQuestion.event_id,
    initiated_by_role: plainQuestion.initiated_by_role || 'VENDOR',
    bid_id: plainQuestion.bid_id || null,
    application_id: plainQuestion.application_id || null,
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
    unread: getQuestionUnreadState(plainQuestion, viewer),
    coordinator_read_at: plainQuestion.coordinator_read_at,
    vendor_read_at: plainQuestion.vendor_read_at,
    created_at: plainQuestion.created_at,
    answered_at: plainQuestion.answered_at,
  };
};

const markMarketplaceQuestionsRead = async (eventId, user, submissionScope = {}) => {
  if (!eventId || !user) {
    return;
  }

  if (user.userType === 'CUSTOMER' || user.userType === 'SUPER_ADMIN') {
    await MarketplaceEventQuestionService.updateMany(
      {
        event_id: eventId,
        ...submissionScope,
        status: { $in: ['PENDING', 'PUBLISHED'] },
        coordinator_read_at: null,
      },
      { coordinator_read_at: new Date() }
    );
    return;
  }

  if (user.userType === 'VENDOR') {
    await MarketplaceEventQuestionService.updateMany(
      {
        event_id: eventId,
        ...submissionScope,
        vendor_user_id: user._id,
        status: { $in: ['PUBLISHED'] },
        $or: [
          { initiated_by_role: 'CUSTOMER' },
          { answer_text_public: { $nin: [null, ''] } },
        ],
      },
      { vendor_read_at: new Date() }
    );
  }
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

const notifyVendorOfCoordinatorMarketplaceMessage = async (event, question) => {
  try {
    await MarketplaceCommunications.sendMarketplaceCommunications([
      {
        userId: question.vendor_user_id,
        title: 'Marketplace coordinator message',
        body: `${event.event_name || 'An event'} has a coordinator message for your submission.`,
        data: {
          notificationType: 'MARKETPLACE_COORDINATOR_MESSAGE',
          eventId: event.event_id,
          questionId: question.question_id,
        },
        channels: ['push', 'email'],
        metadata: { eventId: event.event_id, questionId: question.question_id },
      },
    ]);
  } catch (error) {
    console.error('Marketplace coordinator message notification failed', {
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
  event_address: 'Address/location',
  formatted_address: 'Address/location',
  location: 'Address/location',
  latitude: 'Address/location',
  longitude: 'Address/location',
  guest_count: 'Guest count',
  number_of_guests: 'Guest count',
  budgeted_amount: 'Budget/vendor fee setup',
  vendor_fee: 'Budget/vendor fee setup',
  payment_responsibility: 'Budget/vendor fee setup',
  primary_service_style: 'Service type/style',
  service_type: 'Service type/style',
  service_types: 'Service type/style',
  event_style: 'Service type/style',
  service_styles: 'Service type/style',
  equipment_needs: 'Equipment needs',
  alcohol_requirements: 'Alcohol requirements',
  free_food_offered: 'Free food requirements',
  free_food_provider: 'Free food requirements',
  vendors_required_to_giveaway_food: 'Free food requirements',
};

const URGENT_EVENT_CHANGE_FIELDS = new Set([
  'event_start_date',
  'event_date',
  'event_time',
  'address',
  'event_address',
  'formatted_address',
  'location',
  'latitude',
  'longitude',
]);

const BID_REVISION_EVENT_CHANGE_FIELDS = new Set([
  'address',
  'event_address',
  'formatted_address',
  'location',
  'latitude',
  'longitude',
  'guest_count',
  'number_of_guests',
  'primary_service_style',
  'service_type',
  'service_types',
  'event_style',
  'service_styles',
  'free_food_offered',
  'free_food_provider',
  'vendors_required_to_giveaway_food',
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

const hasOpenBidRevisionRequest = (bid = {}) => {
  if (!bid?.revision_requested_at) {
    return false;
  }
  if (!bid.revision_submitted_at) {
    return true;
  }
  return new Date(bid.revision_requested_at) > new Date(bid.revision_submitted_at);
};

const hasOpenApplicationRevisionRequest = (application = {}) => {
  if (!application?.revision_requested_at) {
    return false;
  }
  if (!application.revision_submitted_at) {
    return true;
  }
  return new Date(application.revision_requested_at) > new Date(application.revision_submitted_at);
};

const PRE_AWARD_EDITABLE_APPLICATION_STATUSES = [
  'DRAFT',
  'PENDING_SIGNATURE',
  'SUBMITTED',
  'UNDER_REVIEW',
];

const requestBidRevisionsForEventChanges = async (event, changes = []) => {
  const revisionFields = [
    ...new Set(
      changes
        .filter((change) => BID_REVISION_EVENT_CHANGE_FIELDS.has(change.field))
        .map((change) => change.field)
    ),
  ];

  if (!revisionFields.length) {
    return;
  }

  await MarketplaceBidService.getModel().updateMany(
    {
      event_id: event.event_id,
      bid_status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      archived_at: null,
    },
    {
      $set: {
        revision_requested_at: new Date(),
        revision_requested_fields: revisionFields,
      },
    }
  );
  await MarketplaceApplicationService.getModel().updateMany(
    {
      event_id: event.event_id,
      application_status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      archived_at: null,
    },
    {
      $set: {
        revision_requested_at: new Date(),
        revision_requested_fields: revisionFields,
      },
    }
  );
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

const notifyBidAwardOutcomes = async (
  event,
  selectedBidIds = [],
  { selectionClosed = true } = {}
) => {
  const bids = await MarketplaceBidService.getByData(
    { event_id: event.event_id, bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
    { lean: true }
  );
  const selected = new Set(selectedBidIds.map(String));

  const outcomeBids = bids.filter((bid) =>
    selected.has(String(bid.bid_id)) ||
    (selectionClosed && String(bid.bid_status).toUpperCase() !== 'AWARDED')
  );

  await MarketplaceCommunications.sendMarketplaceCommunications(
    outcomeBids.map((bid) => {
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

const sendCoordinatorFoodAwardSelectionEmail = async ({ event, bid }) => {
  if (getMarketplaceUnlockState({ event, bid }).details_unlocked) return;
  const coordinator = await UserService.getById(event.customer_user_id);
  if (!coordinator?.email) return;
  try {
    await MailHelper.sendMail(
      coordinator.email,
      `RTC Marketplace bid awarded - ${event.event_name || event.event_id}`,
      `
        <p>Your Food Vendor bid selection has been recorded.</p>
        <p><strong>Event:</strong> ${event.event_name || event.event_id}</p>
        <p><strong>Bid:</strong> ${bid.bid_id}</p>
      `
    );
  } catch (mailError) {
    console.error('Food Vendor bid coordinator award email failed', {
      eventId: event.event_id,
      bidId: bid.bid_id,
      message: mailError.message,
    });
  }
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
  const collectedAttachments = excludeAgreementDocuments(
    await MarketplaceAttachmentService.getByData(
    attachmentQuery,
    { sort: { created_at: 1 }, lean: true }
    )
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

  const agreement = await getValidVendorAgreement(
    bid?.vendor_user_id || application?.vendor_user_id
  );

  if (agreement?.envelope_id) {
    try {
      const envelopeDocuments = await DocuSignHelper.getEnvelopeDocuments(
        agreement.envelope_id
      );
      emailAttachments.push(...await buildAgreementEmailAttachments({
        envelopeId: agreement.envelope_id,
        envelopeDocuments,
        downloadEnvelopeDocument: DocuSignHelper.downloadEnvelopeDocument,
      }));
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
    try {
      await MailHelper.sendMail(
        coordinator.email,
        `RTC Marketplace vendor information - ${event.event_name || event.event_id}`,
        `
          <p>${coordinatorName},</p>
          <p>The marketplace payment requirements are complete. Vendor information and collected documents are attached.</p>
          ${formatEventSummaryHtml(event)}
          <p><strong>Vendor:</strong> ${vendorName}</p>
          <p><strong>Submission:</strong> ${submissionLabel}</p>
          <h3>Award details</h3>
          ${buildFoodVendorAwardDetailsHtml({ bid, application, event, vendor })}
        `,
        { attachments: emailAttachments }
      );
    } catch (error) {
      console.error('Marketplace coordinator award email failed', {
        eventId: event.event_id,
        submissionLabel,
        message: error.message,
      });
    }
  }

  if (vendor?.email) {
    try {
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
    } catch (error) {
      console.error('Marketplace vendor award email failed', {
        eventId: event.event_id,
        submissionLabel,
        message: error.message,
      });
    }
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

const notifyVendorsOfEventReopen = async (event) => {
  const vendorIds = await getEventParticipantVendorIds(event.event_id);
  if (!vendorIds.length) {
    return;
  }

  await MarketplaceCommunications.sendMarketplaceCommunications(
    vendorIds.map((userId) => ({
      userId,
      title: 'Marketplace event reopened',
      body: `${event.event_name || 'An event'} was reopened for new vendor submissions. Your previous submission remains visible to the coordinator, but previous submitters cannot submit again.`,
      data: {
        notificationType: 'MARKETPLACE_EVENT_REOPENED',
        eventId: event.event_id,
      },
      channels: ['push', 'email'],
      metadata: { eventId: event.event_id },
    }))
  );
};

const archiveMarketplaceSubmissionsForReopen = async (eventId, now = new Date()) => {
  await Promise.all([
    MarketplaceBidService.getModel().updateMany(
      {
        event_id: eventId,
        bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
        archived_at: null,
      },
      {
        $set: {
          archived_at: now,
          archived_reason: 'Event reopened after close window',
        },
      }
    ),
    MarketplaceApplicationService.getModel().updateMany(
      {
        event_id: eventId,
        application_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
        archived_at: null,
      },
      {
        $set: {
          archived_at: now,
          archived_reason: 'Event reopened after close window',
        },
      }
    ),
  ]);
};

const notifyClosedWithoutAward = async (event) => {
  const [
    bids,
    applications,
    eventVendorApplications,
    awardedBids,
    awardedApplications,
    awardedEventVendorApplications,
  ] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: event.event_id, bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      { event_id: event.event_id, application_status: { $nin: ['DRAFT', 'WITHDRAWN'] } },
      { lean: true }
    ),
    EventVendorApplicationModel.find({
      event_id: event.event_id,
      status: { $nin: ['DRAFT', 'WITHDRAWN'] },
    }).lean(),
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
    EventVendorApplicationModel.find({
      event_id: event.event_id,
      status: { $in: ['AWARDED', 'PAYMENT_DUE', 'PAID'] },
    }).lean(),
  ]);

  if (!bids.length && !applications.length && !eventVendorApplications.length) {
    return;
  }
  if (
    awardedBids.length ||
    awardedApplications.length ||
    awardedEventVendorApplications.length
  ) {
    return;
  }

  const vendorIds = [
    ...new Set(
      [...bids, ...applications, ...eventVendorApplications]
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
  const coordinatorIds = [...new Set(events.map((event) => event.customer_user_id).filter(Boolean).map(String))];
  const coordinators = coordinatorIds.length
    ? await UserService.getByData(
        { _id: { $in: coordinatorIds } },
        { lean: true },
        'firstName lastName email mobileNumber countryCode'
      )
    : [];
  const coordinatorById = coordinators.reduce((acc, coordinator) => {
    acc[String(coordinator._id)] = coordinator;
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
    const visibleEvent = event
      ? redactLockedMarketplaceEvent(event, unlockState, options)
      : null;
    if (visibleEvent && unlockState?.details_unlocked) {
      const coordinator = coordinatorById[String(event.customer_user_id)];
      visibleEvent.coordinator_contact = getUnlockedMarketplaceCoordinatorContact({
        coordinator,
        detailsUnlocked: unlockState.details_unlocked,
      });
    }
    return {
      ...visibleBid,
      marketplace_unlock: unlockState,
      marketplaceEvent: visibleEvent,
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
  const coordinatorIds = [...new Set(events.map((event) => event.customer_user_id).filter(Boolean).map(String))];
  const coordinators = coordinatorIds.length
    ? await UserService.getByData(
        { _id: { $in: coordinatorIds } },
        { lean: true },
        'firstName lastName email mobileNumber countryCode'
      )
    : [];
  const coordinatorById = coordinators.reduce((acc, coordinator) => {
    acc[String(coordinator._id)] = coordinator;
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
    const visibleEvent = event
      ? redactLockedMarketplaceEvent(event, unlockState, options)
      : null;
    if (visibleEvent && unlockState?.details_unlocked) {
      const coordinator = coordinatorById[String(event.customer_user_id)];
      visibleEvent.coordinator_contact = getUnlockedMarketplaceCoordinatorContact({
        coordinator,
        detailsUnlocked: unlockState.details_unlocked,
      });
    }
    return {
      ...visibleApplication,
      marketplace_unlock: unlockState,
      marketplaceEvent: visibleEvent,
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
      payment_status: query.payment_status || { $in: ['PENDING', 'PROCESSING', 'PAID', 'FAILED'] },
      superseded_at: null,
    },
    { singleResult: true }
  );

const getFoodVendorAwardState = async (event) => {
  const [awardedBids, awardedApplications] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: event.event_id, bid_status: 'AWARDED', archived_at: null },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
        archived_at: null,
      },
      { lean: true }
    ),
  ]);
  return getFoodVendorAwardCapacity({
    event,
    bids: awardedBids,
    applications: awardedApplications,
  });
};

const reconcilePartiallyAwardedFoodEvent = async (event) => {
  if (String(event?.status).toUpperCase() !== 'AWARDED') return event;
  const capacity = await getFoodVendorAwardState(event);
  if (capacity.remaining < 1) return event;
  if (
    event.vendor_applications_closed_at ||
    (event.event_close_date && new Date(event.event_close_date) <= new Date())
  ) return event;
  event.status = 'REOPENED';
  await event.save();
  return event;
};

const assertFoodVendorAwardBatchCapacity = async (event, selectedBids) => {
  const capacity = await getFoodVendorAwardState(event);
  const selectedVendorIds = new Set(
    selectedBids
      .map((bid) => String(bid.vendor_user_id?._id || bid.vendor_user_id || ''))
      .filter(Boolean)
  );
  const newVendorCount = [...selectedVendorIds].filter(
    (vendorUserId) => !capacity.awardedVendorIds.has(vendorUserId)
  ).length;
  if (!newVendorCount || newVendorCount > capacity.remaining) {
    throw buildError(
      capacity.remaining > 0
        ? `You can only award ${capacity.remaining} more Food Vendor(s) for this event.`
        : 'All available Food Vendor award slots have already been filled.',
      409
    );
  }
  return capacity;
};

const areMarketplaceVendorAwardNeedsFilled = async (event) => {
  const needs = (event.event_vendor_needs || []).filter(
    (need) => Number(need.quantity || 0) > 0
  );
  if (!needs.length) return true;

  const awardedApplications = await EventVendorApplicationModel.find({
    event_id: event.event_id,
    status: { $in: ['AWARDED', 'PAYMENT_DUE', 'PAID'] },
  }).lean();

  return needs.every((need) => {
    const awardedCount = awardedApplications.filter((application) =>
      (application.vendor_types || []).includes(need.vendor_type)
    ).length;
    return awardedCount >= Number(need.quantity || 0);
  });
};

const getFinalEventPaymentRecords = async (event) => {
  const [awardedBids, awardedApplications] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: event.event_id, bid_status: 'AWARDED', archived_at: null },
      { lean: true }
    ),
    MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
        archived_at: null,
      },
      { lean: true }
    ),
  ]);

  return { awardedBids, awardedApplications };
};

const getFinalEventPaymentAggregateStatus = async (eventId) => {
  const awardedBids = await MarketplaceBidService.getByData(
    { event_id: eventId, bid_status: 'AWARDED', archived_at: null },
    { lean: true }
  );
  const finalPayments = await MarketplacePaymentService.getByData(
    {
      event_id: eventId,
      payment_type: 'FINAL_EVENT_PAYMENT',
      payment_status: { $in: ['PENDING', 'PROCESSING', 'PAID', 'FAILED'] },
    },
    { lean: true }
  );
  const completion = getCoordinatorPaymentCompletion({ awardedBids, finalPayments });
  if (!completion.paymentRequired) return 'NOT_REQUIRED';
  if (completion.allRequiredPaymentsComplete) return 'PAID';
  return finalPayments.length ? 'PENDING' : 'NOT_REQUIRED';
};

const getCoordinatorPaymentCompletionForEvent = async (eventId) => {
  const [awardedBids, finalPayments] = await Promise.all([
    MarketplaceBidService.getByData(
      { event_id: eventId, bid_status: 'AWARDED', archived_at: null },
      { lean: true }
    ),
    MarketplacePaymentService.getByData(
      { event_id: eventId, payment_type: 'FINAL_EVENT_PAYMENT' },
      { lean: true }
    ),
  ]);
  return getCoordinatorPaymentCompletion({ awardedBids, finalPayments });
};

const sendFinalEventPaymentReceipt = async ({ payment, event }) => {
  const coordinator = await UserService.getById(event.customer_user_id);
  if (!coordinator?.email) {
    return;
  }

  await MailHelper.sendMail(
    coordinator.email,
    'Round The Corner event payment receipt',
    `
      <p>Your event payment has been received.</p>
      <p><strong>Event:</strong> ${event.event_name || event.event_id}</p>
      <p><strong>Award amount:</strong> $${Number(payment.base_amount || 0).toFixed(2)}</p>
      <p><strong>Tip:</strong> $${Number(payment.tip_amount || 0).toFixed(2)}</p>
      <p><strong>Total paid:</strong> $${Number(payment.total_amount || 0).toFixed(2)}</p>
      <p><strong>Payment method:</strong> ${payment.payment_method || 'Not provided'}</p>
      <p><strong>Transaction:</strong> ${payment.processor_transaction_id || 'Pending'}</p>
    `
  );
};

const finalizePaidVendorPayment = async (payment) => {
  if (payment.payment_type !== 'VENDOR_EVENT_FEE') {
    return null;
  }

  if (payment.application_id) {
    const eventVendorApplication = await EventVendorApplicationModel.findOne({
      application_id: payment.application_id,
      vendor_user_id: payment.payer_user_id,
    });
    if (eventVendorApplication) {
      eventVendorApplication.status = 'PAID';
      eventVendorApplication.payment_id = payment.payment_id;
      await eventVendorApplication.save();
      await deliverCoordinatorDetailsEmail({
        applicationModel: EventVendorApplicationModel,
        applicationId: eventVendorApplication.application_id,
        eventId: payment.event_id,
        loadEvent: (eventId) => MarketplaceEventService.getByData({ event_id: eventId }, { singleResult: true }),
        loadVendor: (vendorUserId) => UserService.getByData({ _id: vendorUserId }, { singleResult: true }),
        loadCoordinator: (coordinatorUserId) => UserService.getByData({ _id: coordinatorUserId }, { singleResult: true }),
        sendMail: MailHelper.sendMail,
        buildHtml: buildEventVendorAwardDetailsHtml,
      });
      return { eventVendorApplication };
    }
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
    if (application?.source_bid_id) {
      await MarketplaceBidService.update(
        { bid_id: application.source_bid_id },
        {
          payment_id: payment.payment_id,
          payment_status: 'PAID',
        },
        { getNew: false }
      );
    }

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

const resolveAwardSelections = (event, selectedBids, requestedSelections = []) => {
  const requestedByBidId = new Map(
    (requestedSelections || []).map((selection) => [
      selection.bid_id,
      String(selection.award_coverage || '').toUpperCase(),
    ])
  );
  return selectedBids.map((bid) => {
    const awardCoverage = requestedByBidId.get(bid.bid_id) || bid.guest_coverage;
    const offeredCoverage = bid.guest_coverage || 'REGULAR';
    const allowedAwards = getAllowedAwardCoverages(event, offeredCoverage);
    if (!allowedAwards.includes(awardCoverage)) {
      throw buildError(
        `Vendor ${bid.bid_id} did not offer ${awardCoverage} services.`,
        400
      );
    }
    return { bid_id: bid.bid_id, award_coverage: awardCoverage };
  });
};

const applyAwardSelections = async (event, selectedBids, awardSelections) => {
  const coverageByBidId = new Map(
    awardSelections.map((selection) => [selection.bid_id, selection.award_coverage])
  );
  for (const bid of selectedBids) {
    const awardCoverage = coverageByBidId.get(bid.bid_id) || bid.guest_coverage;
    const combinedFeeWaived =
      awardCoverage === 'BOTH' && event.waive_vendor_fee_for_combined_award === true;
    bid.awarded_coverage = awardCoverage;
    bid.combined_vendor_fee_waived = combinedFeeWaived;
    bid.payment_status = combinedFeeWaived ? 'NOT_REQUIRED' :
      awardCoverage === 'BOTH' && event.ga_food_sales_allowed ? 'PENDING' : 'NOT_REQUIRED';
    bid.bid_status = 'AWARDED';

    if (awardCoverage === 'BOTH' && event.ga_food_sales_allowed) {
      let linkedApplication = await MarketplaceApplicationService.getByData(
        { source_bid_id: bid.bid_id },
        { singleResult: true }
      );
      if (!linkedApplication) {
        linkedApplication = await MarketplaceApplicationService.create({
          event_id: event.event_id,
          vendor_user_id: bid.vendor_user_id,
          food_truck_id: bid.food_truck_id,
          submission_round: bid.submission_round || event.current_submission_round || 1,
          source_bid_id: bid.bid_id,
          application_status: combinedFeeWaived ? 'CONFIRMED' : 'PAYMENT_DUE',
          payment_status: combinedFeeWaived ? 'NOT_REQUIRED' : 'PENDING',
          payment_due_at: combinedFeeWaived
            ? null
            : event.vendor_fee_payment_deadline || null,
          submitted_at: bid.submitted_at || new Date(),
        });
      }
      bid.linked_application_id = linkedApplication.application_id;
    }
    await bid.save();
  }
};

const applyFoodApplicationSelections = async (event, selectedApplications = []) => {
  const vendorFeeRequired = roundMoney(event.vendor_fee || 0) > 0;
  if (vendorFeeRequired && !event.vendor_fee_payment_deadline) {
    throw buildError(
      'Set the Last Date to Accept Payments on the event before accepting vendors.',
      409
    );
  }

  for (const application of selectedApplications) {
    application.application_status = vendorFeeRequired ? 'PAYMENT_DUE' : 'CONFIRMED';
    application.payment_status = vendorFeeRequired ? 'PENDING' : 'NOT_REQUIRED';
    application.payment_due_at = vendorFeeRequired
      ? event.vendor_fee_payment_deadline || null
      : null;
    await application.save();

    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: application.vendor_user_id,
      title: vendorFeeRequired
        ? 'Vendor application accepted — payment due'
        : 'Vendor application accepted',
      body: vendorFeeRequired
        ? `Your application for ${event.event_name || 'the event'} was accepted. Pay the vendor fee by ${new Date(application.payment_due_at).toLocaleDateString('en-US')}.`
        : `Your application for ${event.event_name || 'the event'} was accepted.`,
      data: {
        notificationType: 'MARKETPLACE_APPLICATION_ACCEPTED',
        eventId: event.event_id,
        applicationId: application.application_id,
      },
      channels: ['push', 'email'],
      metadata: { eventId: event.event_id, applicationId: application.application_id },
    });

    const coordinator = await UserService.getById(event.customer_user_id);
    if (coordinator?.email) {
      try {
        await MailHelper.sendMail(
          coordinator.email,
          `RTC Marketplace application awarded - ${event.event_name || event.event_id}`,
          `
            <p>Your Food Vendor application selection has been recorded.</p>
            <p><strong>Event:</strong> ${event.event_name || event.event_id}</p>
            <p><strong>Application:</strong> ${application.application_id}</p>
          `
        );
      } catch (mailError) {
        console.error('Food Vendor application coordinator award email failed', {
          eventId: event.event_id,
          applicationId: application.application_id,
          message: mailError.message,
        });
      }
    }
  }
};

const applyEventVendorApplicationSelections = async (
  event,
  selectedApplications = []
) => {
  for (const application of selectedApplications) {
    let payment = await MarketplacePaymentService.getByData(
      {
        application_id: application.application_id,
        payment_type: 'VENDOR_EVENT_FEE',
        payment_status: { $in: ['PENDING', 'PROCESSING', 'PAID'] },
      },
      { singleResult: true }
    );
    if (!payment) {
      const subtotal = Number(application.checkout_subtotal || 0);
      const fee = getMarketplaceVendorApplicationCheckoutFeeAmount(subtotal);
      payment = await MarketplacePaymentService.create({
        event_id: event.event_id,
        application_id: application.application_id,
        payer_user_id: application.vendor_user_id,
        payer_type: 'VENDOR',
        payment_type: 'VENDOR_EVENT_FEE',
        base_amount: subtotal,
        fee_rate: 3.5,
        fee_amount: fee,
        total_amount: roundMoney(subtotal + fee),
        coordinator_payout_amount: subtotal,
        payment_status: 'PENDING',
      });
    }
    application.status = payment.payment_status === 'PAID' ? 'PAID' : 'PAYMENT_DUE';
    application.payment_id = payment.payment_id;
    await application.save();

    const coordinator = await UserService.getById(event.customer_user_id);
    if (coordinator?.email) {
      try {
        await MailHelper.sendMail(
          coordinator.email,
          `RTC Marketplace Vendor awarded - ${event.event_name || event.event_id}`,
          `
            <p>Your Marketplace Vendor selection has been recorded.</p>
            <p><strong>Event:</strong> ${event.event_name || event.event_id}</p>
            <p><strong>Event date:</strong> ${event.event_date || 'Not provided'}</p>
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
  }
};

const finalizeFoodVendorAwardBatch = async ({
  event,
  selectedBids,
  selectedFoodApplications = [],
  selectedEventVendorApplications = [],
  awardSelections,
  payment = null,
}) => {
  await applyAwardSelections(event, selectedBids, awardSelections);
  await applyFoodApplicationSelections(event, selectedFoodApplications);
  await applyEventVendorApplicationSelections(
    event,
    selectedEventVendorApplications
  );

  const capacity = await getFoodVendorAwardState(event);
  const foodSelectionClosed = !isFoodVendorMarketplaceEvent(event) || capacity.remaining === 0;

  const marketplaceVendorNeedsFilled = await areMarketplaceVendorAwardNeedsFilled(event);
  const eventFullyAwarded = foodSelectionClosed && marketplaceVendorNeedsFilled;

  const eventUpdate = {
    status: eventFullyAwarded ? 'AWARDED' : event.status,
    agreement_provider: null,
    agreement_status: 'NOT_REQUIRED',
    agreement_error_message: null,
  };
  if (payment) {
    eventUpdate.award_payment_id = payment.payment_id;
    eventUpdate.award_payment_status = payment.payment_status;
  }
  const marketplaceEvent = await MarketplaceEventService.update(
    { event_id: event.event_id },
    eventUpdate,
    { getNew: true }
  );

  if (eventFullyAwarded) {
    await MarketplaceEventQuestionService.updateMany(
      {
        event_id: event.event_id,
        status: { $in: ['PENDING', 'PUBLISHED'] },
      },
      { status: 'ARCHIVED', archived_at: new Date() }
    );
    await notifyCoordinatorOfMatchLocked(marketplaceEvent);
  }

  const selectedBidIds = selectedBids.map((bid) => bid.bid_id);
  await notifyBidAwardOutcomes(marketplaceEvent, selectedBidIds, {
    selectionClosed: false,
  });
  for (const bid of selectedBids) {
    await sendCoordinatorFoodAwardSelectionEmail({
      event: marketplaceEvent,
      bid,
    });
    await sendMarketplaceInformationEmailsIfUnlocked({
      event: marketplaceEvent,
      bid,
    });
  }

  return {
    awarded_bid_ids: selectedBidIds,
    awarded_food_application_ids: selectedFoodApplications.map(
      (application) => application.application_id
    ),
    awarded_event_vendor_application_ids: selectedEventVendorApplications.map(
      (application) => application.application_id
    ),
    marketplaceEvent,
    selection_closed: foodSelectionClosed,
    event_fully_awarded: eventFullyAwarded,
    remaining_food_vendor_awards: capacity.remaining,
  };
};

const assertEventVendorAwardBatchCapacity = async (
  event,
  selectedApplications = []
) => {
  if (!selectedApplications.length) return;
  const existingAwards = await EventVendorApplicationModel.find({
    event_id: event.event_id,
    status: { $in: ['AWARDED', 'PAYMENT_DUE', 'PAID'] },
  }).lean();
  const needs = event.event_vendor_needs || [];
  const selectedCounts = new Map();
  selectedApplications.forEach((application) => {
    (application.vendor_types || []).forEach((type) => {
      selectedCounts.set(type, (selectedCounts.get(type) || 0) + 1);
    });
  });

  for (const [type, selectedCount] of selectedCounts.entries()) {
    const need = needs.find((item) => item.vendor_type === type);
    const existingCount = existingAwards.filter((application) =>
      (application.vendor_types || []).includes(type)
    ).length;
    if (!need || existingCount + selectedCount > Number(need.quantity || 0)) {
      throw buildError(`${type} vendor capacity has already been awarded`, 409);
    }
  }
};

const loadAwardBatchSelections = async (
  event,
  payload = {},
  { allowFinalized = false } = {}
) => {
  const selectedBidIds = [...new Set(payload.bid_ids || [])];
  const selectedFoodApplicationIds = [
    ...new Set(payload.food_application_ids || []),
  ];
  const selectedEventVendorApplicationIds = [
    ...new Set(payload.event_vendor_application_ids || []),
  ];
  if (
    !selectedBidIds.length &&
    !selectedFoodApplicationIds.length &&
    !selectedEventVendorApplicationIds.length
  ) {
    throw buildError('Select at least one vendor submission to complete booking', 400);
  }

  const [selectedBids, selectedFoodApplications, selectedEventVendorApplications] =
    await Promise.all([
      selectedBidIds.length
        ? MarketplaceBidService.getByData({
            event_id: event.event_id,
            bid_id: { $in: selectedBidIds },
            bid_status: {
              $in: allowFinalized
                ? ['SUBMITTED', 'UNDER_REVIEW', 'AWARDED']
                : ['SUBMITTED', 'UNDER_REVIEW'],
            },
            archived_at: null,
          })
        : [],
      selectedFoodApplicationIds.length
        ? MarketplaceApplicationService.getByData({
            event_id: event.event_id,
            application_id: { $in: selectedFoodApplicationIds },
            application_status: {
              $in: allowFinalized
                ? ['SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'PAYMENT_DUE', 'PAID']
                : ['SUBMITTED', 'UNDER_REVIEW'],
            },
            archived_at: null,
          })
        : [],
      selectedEventVendorApplicationIds.length
        ? EventVendorApplicationModel.find({
            event_id: event.event_id,
            application_id: { $in: selectedEventVendorApplicationIds },
            status: {
              $in: allowFinalized
                ? ['SUBMITTED', 'UNDER_REVIEW', 'PAYMENT_DUE', 'PAID']
                : ['SUBMITTED', 'UNDER_REVIEW'],
            },
          })
        : [],
    ]);

  if (
    selectedBids.length !== selectedBidIds.length ||
    selectedFoodApplications.length !== selectedFoodApplicationIds.length ||
    selectedEventVendorApplications.length !== selectedEventVendorApplicationIds.length
  ) {
    throw buildError('One or more selected submissions are no longer available', 409);
  }

  const pendingBids = selectedBids.filter((bid) =>
    ['SUBMITTED', 'UNDER_REVIEW'].includes(String(bid.bid_status).toUpperCase())
  );
  const pendingFoodApplications = selectedFoodApplications.filter((application) =>
    ['SUBMITTED', 'UNDER_REVIEW'].includes(
      String(application.application_status).toUpperCase()
    )
  );
  const pendingEventVendorApplications = selectedEventVendorApplications.filter(
    (application) =>
      ['SUBMITTED', 'UNDER_REVIEW'].includes(
        String(application.status).toUpperCase()
      )
  );
  const selectedFoodRecords = [...pendingBids, ...pendingFoodApplications];
  const selectedFoodVendorIds = selectedFoodRecords.map((record) =>
    String(record.vendor_user_id?._id || record.vendor_user_id || '')
  );
  if (new Set(selectedFoodVendorIds).size !== selectedFoodVendorIds.length) {
    throw buildError('Select only one Food Vendor submission per vendor.', 409);
  }
  if (selectedFoodRecords.length) {
    await assertFoodVendorAwardBatchCapacity(event, selectedFoodRecords);
  }
  await assertEventVendorAwardBatchCapacity(
    event,
    pendingEventVendorApplications
  );

  return {
    selectedBidIds,
    selectedFoodApplicationIds,
    selectedEventVendorApplicationIds,
    selectedBids: pendingBids,
    selectedFoodApplications: pendingFoodApplications,
    selectedEventVendorApplications: pendingEventVendorApplications,
  };
};

const completeSignedAward = async (payment) => {
  if (payment.payment_type !== 'COORDINATOR_AWARD_FEE') {
    return null;
  }

  const selectedBidIds = payment.selected_bid_ids || [];
  const selectedFoodApplicationIds = payment.selected_food_application_ids || [];
  const selectedEventVendorApplicationIds =
    payment.selected_event_vendor_application_ids || [];
  if (
    !selectedBidIds.length &&
    !selectedFoodApplicationIds.length &&
    !selectedEventVendorApplicationIds.length
  ) {
    return null;
  }

  const existingEvent = await MarketplaceEventService.getByData(
    { event_id: payment.event_id },
    { singleResult: true }
  );

  const batch = await loadAwardBatchSelections(
    existingEvent,
    {
      bid_ids: selectedBidIds,
      food_application_ids: selectedFoodApplicationIds,
      event_vendor_application_ids: selectedEventVendorApplicationIds,
    },
    { allowFinalized: true }
  );
  if (
    !batch.selectedBids.length &&
    !batch.selectedFoodApplications.length &&
    !batch.selectedEventVendorApplications.length
  ) {
    const capacity = await getFoodVendorAwardState(existingEvent);
    return {
      awarded_bid_ids: selectedBidIds,
      awarded_food_application_ids: selectedFoodApplicationIds,
      awarded_event_vendor_application_ids: selectedEventVendorApplicationIds,
      marketplaceEvent: existingEvent,
      selection_closed: capacity.remaining === 0,
      remaining_food_vendor_awards: capacity.remaining,
    };
  }
  const awardSelections = resolveAwardSelections(
    existingEvent,
    batch.selectedBids,
    payment.award_selections || []
  );
  return finalizeFoodVendorAwardBatch({
    event: existingEvent,
    selectedBids: batch.selectedBids,
    selectedFoodApplications: batch.selectedFoodApplications,
    selectedEventVendorApplications: batch.selectedEventVendorApplications,
    awardSelections,
    payment,
  });
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
  return completeSignedAward(payment);
};

const finalizePaidFinalEventPayment = async (payment) => {
  if (payment.payment_type !== 'FINAL_EVENT_PAYMENT') {
    return null;
  }

  const existingEvent = await MarketplaceEventService.getByData(
    { event_id: payment.event_id },
    { singleResult: true }
  );
  const shouldSendReceipt = existingEvent?.final_payment_status !== 'PAID';

  const finalPaymentStatus = await getFinalEventPaymentAggregateStatus(payment.event_id);
  const completedAt = new Date();
  const marketplaceEvent = await MarketplaceEventService.update(
    { event_id: payment.event_id },
    {
      final_payment_id: payment.payment_id,
      final_payment_food_truck_id: payment.food_truck_id || null,
      final_payment_status: finalPaymentStatus,
      ...(finalPaymentStatus === 'PAID'
        ? {
            status: 'CLOSED',
            closed_at: completedAt,
            vendor_applications_closed_at:
              existingEvent.vendor_applications_closed_at || completedAt,
          }
        : {}),
    },
    { getNew: true }
  );

  if (marketplaceEvent && shouldSendReceipt) {
    await sendFinalEventPaymentReceipt({ payment, event: marketplaceEvent });
  }

  return { marketplaceEvent };
};

const finalizePaidMarketplacePayment = async (payment) => {
  if (payment.payment_type === 'VENDOR_EVENT_FEE') {
    return finalizePaidVendorPayment(payment);
  }

  if (payment.payment_type === 'COORDINATOR_AWARD_FEE') {
    return finalizePaidAwardPayment(payment);
  }

  if (payment.payment_type === 'FINAL_EVENT_PAYMENT') {
    return finalizePaidFinalEventPayment(payment);
  }

  return null;
};

const safelyFinalizePaidMarketplacePayment = async (payment) => {
  try {
    return await finalizePaidMarketplacePayment(payment);
  } catch (finalizationError) {
    // Payment confirmation is authoritative. Coordinator-detail delivery can retry later.
    console.error('Marketplace paid-payment finalization failed', {
      paymentId: payment?.payment_id,
      message: finalizationError.message,
    });
    return { retryable_finalization_error: true };
  }
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

  if (
    user.userType === 'VENDOR' &&
    payment.payment_type === 'FINAL_EVENT_PAYMENT' &&
    payment.food_truck_id
  ) {
    const foodTruck = await FoodTruckService.getByData(
      { userId: user._id },
      { singleResult: true, lean: true }
    );
    if (foodTruck && String(foodTruck._id) === String(payment.food_truck_id)) {
      return payment;
    }
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

exports.adminCreateEvent = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can create marketplace events', 403);
    }

    const customerUserId = req.body.customer_user_id;
    if (!customerUserId) {
      throw buildError('Select an existing event coordinator.', 400);
    }
    await assertCustomerEventCoordinator(customerUserId);

    const { customer_user_id, ...eventPayload } = req.body;
    const normalizedEvent = normalizeMarketplaceEventPayload(eventPayload);
    const marketplaceEvent = await MarketplaceEventService.create({
      ...normalizedEvent,
      customer_user_id: customerUserId,
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
    const gaCommitted = Number(event.ga_tickets_sold || 0) + Number(event.ga_tickets_reserved || 0);
    const vipCommitted = Number(event.vip_tickets_sold || 0) + Number(event.vip_tickets_reserved || 0);
    if (req.body.ga_ticket_quantity != null && Number(req.body.ga_ticket_quantity) < gaCommitted) {
      throw buildError(`GA Ticket Capacity cannot be lower than ${gaCommitted} sold or reserved ticket(s).`, 409);
    }
    if (req.body.vip_ticket_quantity != null && Number(req.body.vip_ticket_quantity) < vipCommitted) {
      throw buildError(`VIP Ticket Capacity cannot be lower than ${vipCommitted} sold or reserved ticket(s).`, 409);
    }
    if (req.body.vip_section_enabled === false && vipCommitted > 0) {
      throw buildError('The VIP section cannot be disabled after VIP tickets have been sold or reserved.', 409);
    }
    const protectedParticipationFields = [
      'fully_catered_event',
      'catered_vip_section_enabled',
      'ga_food_sales_allowed',
      'separate_vip_vendor_required',
      'waive_vendor_fee_for_combined_award',
      'vendor_fee_payment_deadline',
      'payment_responsibility',
    ];
    const participationChanged = protectedParticipationFields.some(
      (field) => req.body[field] !== undefined &&
        String(req.body[field] ?? '') !== String(event[field] ?? '')
    );
    if (req.body.vip_section_enabled === false || participationChanged) {
      const [existingBids, existingApplications, existingPayments] = await Promise.all([
        MarketplaceBidService.getByData({ event_id: event.event_id, archived_at: null }, { lean: true }),
        MarketplaceApplicationService.getByData({ event_id: event.event_id, archived_at: null }, { lean: true }),
        MarketplacePaymentService.getByData({ event_id: event.event_id }, { lean: true }),
      ]);
      if (existingBids.length || existingApplications.length || existingPayments.length) {
        throw buildError(
          `Participation and payment rules cannot be changed after marketplace activity begins. Contact support at ${MARKETPLACE_PHONE_NUMBER}.`,
          409
        );
      }
    }
    if (req.body.number_of_vendors_needed != null) {
      const [filledBids, filledApplications] = await Promise.all([
        MarketplaceBidService.getByData(
          { event_id: event.event_id, bid_status: 'AWARDED', archived_at: null },
          { lean: true }
        ),
        MarketplaceApplicationService.getByData(
          {
            event_id: event.event_id,
            application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
            archived_at: null,
          },
          { lean: true }
        ),
      ]);
      const proposedEvent = { ...toPlainObject(event), ...req.body };
      const selectedRequirement = Number(req.body.number_of_vendors_needed);
      const { gaRequirement, vipRequirement } =
        getMarketplaceServiceRequirements(proposedEvent, selectedRequirement);
      const filled = getMarketplaceFilledSlotSummary({
        bids: filledBids,
        applications: filledApplications,
        separateVipVendorRequired: proposedEvent.separate_vip_vendor_required,
        gaRequirement,
        vipRequirement,
      });
      if (isMarketplaceVendorReductionBlocked({
        selectedRequirement,
        gaRequirement,
        vipRequirement,
        filled,
      })) {
        throw buildError(
          `By decreasing vendors, you will be required to refund vendor fees. Please contact support to refund vendors that are no longer needed for the event: ${MARKETPLACE_PHONE_NUMBER}. GA filled: ${filled.gaSlotsFilled}; VIP filled: ${filled.vipSlotsFilled}; minimum unique vendors: ${filled.minimumUniqueVendors}.`,
          409
        );
      }
    }
    const updatePayload = preserveSavedMarketplaceLocationFields(
      {
        ...toPlainObject(event),
        ...req.body,
        status: req.body.status || event.status,
      },
      event
    );
    const normalizedEvent = normalizeMarketplaceEventPayload(
      updatePayload,
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
      const importantChanges = getImportantEventChanges(event, marketplaceEvent);
      await requestBidRevisionsForEventChanges(marketplaceEvent, importantChanges);
      await notifyVendorsOfEventChanges(
        marketplaceEvent,
        importantChanges
      );
    }

    const marketplaceEventWithImages = await MarketplaceEventService.getWithImages(
      marketplaceEvent.event_id
    );

    return res.data(
      { marketplaceEvent: marketplaceEventWithImages },
      'Marketplace event updated'
    );
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
	    if (event.status !== 'CLOSED') {
	      throw buildError('Only closed events can be reopened.', 400);
	    }
	    if (event.status === 'AWARDED' || await hasMarketplaceAwards(event.event_id)) {
	      throw buildError('Events with awarded vendors cannot be reopened.', 400);
	    }
	    const eventStartDate = event.event_date ? new Date(event.event_date) : null;
	    const requestedEventDate = req.body.event_date ? new Date(req.body.event_date) : null;
	    if (
	      eventStartDate &&
	      eventStartDate <= new Date() &&
	      (!requestedEventDate || requestedEventDate <= new Date())
	    ) {
	      throw buildError(
	        'The event date has passed. Update the event to a future date before reopening.',
	        400
	      );
	    }
	    const normalizedEvent = normalizeMarketplaceEventPayload(
	      {
	        ...toPlainObject(event),
	        ...req.body,
        status: 'REOPENED',
      },
      { existingEvent: event }
    );
	    const reopenableEventFields = { ...normalizedEvent };
	    [
	      '_id',
	      '__v',
	      'event_id',
	      'customer_user_id',
	      'reopen_count',
	      'current_submission_round',
	      'created_at',
	      'updated_at',
	    ].forEach((field) => delete reopenableEventFields[field]);
	    const reopenedAt = new Date();
	    await archiveMarketplaceSubmissionsForReopen(event.event_id, reopenedAt);
	    const marketplaceEvent = await MarketplaceEventService.update(
	      { event_id: req.params.eventId, customer_user_id: req.user._id },
	      {
	        $set: {
	          ...reopenableEventFields,
	          status: 'REOPENED',
	          closed_at: null,
	          archived_at: null,
	          close_notification_sent_at: null,
	          submissions_seen_at: null,
	          current_submission_round: (event.current_submission_round || 1) + 1,
	        },
	        $inc: { reopen_count: 1 },
      },
	      { getNew: true, directApply: true }
	    );
	    await notifyVendorsOfEventReopen(marketplaceEvent);
	    const marketplaceEventWithImages = await MarketplaceEventService.getWithImages(
	      marketplaceEvent.event_id
	    );

	    return res.data(
	      { marketplaceEvent: marketplaceEventWithImages },
	      'Marketplace event reopened'
	    );
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
    if (![...ACTIVE_EVENT_STATUSES, 'AWARDED'].includes(event.status)) {
      throw buildError('Only open events can be closed.', 400);
    }

    const completion = await getCoordinatorPaymentCompletionForEvent(event.event_id);
    if (completion.outstandingBidIds.length) {
      throw buildError(
        'Complete all coordinator vendor payments before closing this event.',
        409
      );
    }

    const now = new Date();
    const marketplaceEvent = await MarketplaceEventService.update(
      { event_id: req.params.eventId, customer_user_id: req.user._id },
      {
        status: 'CLOSED',
        closed_at: now,
        vendor_applications_closed_at: now,
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

    return res.data({ marketplaceEvent }, 'Marketplace vendor applications closed');
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
    const marketplaceEventWithTiming = {
      ...marketplaceEvent,
      final_payment_timing: buildVendorEventCloseState(marketplaceEvent),
    };
    if (fullAccess) {
      const eventVendorApplications = await EventVendorApplicationModel.find({
        event_id: event.event_id,
      }).select('vendor_types status').lean();
      marketplaceEventWithTiming.event_vendor_requirement_summary =
        buildEventVendorRequirementSummary({
          needs: marketplaceEvent.event_vendor_needs || [],
          applications: eventVendorApplications,
        });
    }

    return res.data(
      {
        marketplaceEvent: redactLockedMarketplaceEvent(marketplaceEventWithTiming, unlockState, {
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

    const [vendorBids, vendorApplications] = await Promise.all([
      MarketplaceBidService.getByData(
        { vendor_user_id: req.user._id },
        { lean: true }
      ),
      MarketplaceApplicationService.getByData(
        { vendor_user_id: req.user._id },
        { lean: true }
      ),
    ]);
    const excludedEventIds = [...new Set([
      ...(vendorBids || []).map((item) => item.event_id),
      ...(vendorApplications || []).map((item) => item.event_id),
    ])];
    const openEventQuery = {
      status: { $in: ACTIVE_EVENT_STATUSES },
      event_close_date: { $gt: new Date() },
      vendor_applications_closed_at: null,
      event_id: { $nin: excludedEventIds },
    };

    const openEvents = await MarketplaceEventService.getByData(
      openEventQuery,
      {
        sort: { event_close_date: 1, created_at: -1 },
        lean: true,
      }
    );
    const eventIds = openEvents.map((event) => event.event_id);
    const [awardedBids, awardedApplications] = await Promise.all([
      MarketplaceBidService.getByData(
        { event_id: { $in: eventIds }, bid_status: 'AWARDED', archived_at: null },
        { lean: true }
      ),
      MarketplaceApplicationService.getByData(
        {
          event_id: { $in: eventIds },
          application_status: { $in: FOOD_APPLICATION_FILLED_STATUSES },
          archived_at: null,
        },
        { lean: true }
      ),
    ]);
    const eligibleEvents = openEvents.filter((event) =>
      isFoodVendorMarketplaceEvent(event) && hasFoodVendorAwardCapacity({
        event,
        bids: awardedBids.filter((bid) => bid.event_id === event.event_id),
        applications: awardedApplications.filter((application) => application.event_id === event.event_id),
      })
    );
    const limit = Math.max(1, Number(req.query.limit || 20));
    const page = Math.max(1, Number(req.query.page || 1));
    const pageEvents = eligibleEvents.slice((page - 1) * limit, page * limit);
    const marketplaceEventList = await MarketplaceEventService.attachImages(pageEvents);
    const visibleMarketplaceEventList = marketplaceEventList.map((event) =>
      redactLockedMarketplaceEvent(
        event,
        getMarketplaceUnlockState({ event }),
        { fullAccess: false }
      )
    );

    const total = eligibleEvents.length;

    return res.data(
      {
        marketplaceEventList: visibleMarketplaceEventList,
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      'Open marketplace events'
    );
  } catch (e) {
    return next(e);
  }
};

exports.getPublicOpenEvent = async (req, res, next) => {
  try {
    const event = await MarketplaceEventService.getByData(
      getPublicMarketplaceEventQuery(req.params.eventId),
      { singleResult: true, lean: true }
    );

    if (!event || !isPublicMarketplaceEventEligible(event)) {
      throw buildError('Open marketplace event not found', 404);
    }
    await MarketplaceEventService.update(
      { event_id: event.event_id },
      { $inc: { event_impression_count: 1 } },
      { directApply: true }
    );

    const marketplaceEvent = await MarketplaceEventService.getWithImages(
      event.event_id
    );

    return res.data(
      { marketplaceEvent: sanitizePublicMarketplaceEvent(marketplaceEvent) },
      'Open marketplace event'
    );
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
        ticket_sales_closed_at: null,
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
    const coordinatorVisibleStatuses = qaArchived
      ? ['PENDING', 'PUBLISHED', 'ARCHIVED']
      : ['PENDING', 'PUBLISHED'];
    let query = {
      event_id: req.params.eventId,
      status: { $in: coordinatorVisibleStatuses },
    };
    const submissionScope = buildMarketplaceMessageScope({
      bidId: req.query.bid_id || null,
      applicationId: req.query.application_id || null,
    });
    query = { ...query, ...submissionScope };

    if (req.user.userType === 'VENDOR') {
      query = qaArchived
        ? {
            event_id: req.params.eventId,
            ...submissionScope,
            vendor_user_id: req.user._id,
            status: { $in: ['PENDING', 'PUBLISHED', 'ARCHIVED'] },
          }
        : {
            event_id: req.params.eventId,
            ...submissionScope,
            vendor_user_id: req.user._id,
            status: { $in: ['PENDING', 'PUBLISHED'] },
          };
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

    const marketplaceQuestionList = questions.map((question) =>
      sanitizeMarketplaceQuestion(question, {
        includeBlocked: req.user.userType === 'SUPER_ADMIN',
        viewer: req.user,
      })
    );

    // Return the unread state that existed when the thread was opened, then
    // acknowledge it so the next notification refresh reflects the read state.
    if (req.query.markRead === 'true') {
      await markMarketplaceQuestionsRead(req.params.eventId, req.user, submissionScope);
    }

    return res.data(
      {
        marketplaceQuestionList,
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
    // Reject an ambiguous scope before any event, submission, or profile lookup.
    buildMarketplaceMessageScope({ bidId: req.body.bid_id, applicationId: req.body.application_id });
    const event = await getEventForUser(req.params.eventId, req.user);

    if (isQuestionBoardArchived(event)) {
      throw buildError('This event message board is archived.', 410);
    }

    const questionText = String(req.body.question_text || '').trim();
    const moderation = moderateMarketplaceText(questionText);
    const isBlocked = moderation.status === 'BLOCKED';
    if (isBlocked) {
      assertMarketplaceTextAllowed(questionText, 'Message');
    }
    let vendorUserId = req.user._id;
    let foodTruckId = null;
    let eventVendorProfileId = null;
    let bidId = null;
    let applicationId = null;
    let displayIdentity = null;
    let initiatedByRole = 'VENDOR';

    if (req.user.userType === 'VENDOR') {
      if (req.body.bid_id) {
        const ownedBid = await MarketplaceBidService.getByData(
          { event_id: event.event_id, bid_id: req.body.bid_id, vendor_user_id: req.user._id },
          { singleResult: true }
        );
        if (!ownedBid) throw buildError('Marketplace bid not found', 404);
        bidId = ownedBid.bid_id;
        ({ foodTruckId, eventVendorProfileId, displayIdentity } = resolveMarketplaceSubmissionParticipant({
          foodBid: ownedBid,
        }));
      } else if (req.body.application_id) {
        const [ownedFoodApplication, ownedEventVendorApplication] = await Promise.all([
          MarketplaceApplicationService.getByData(
            { event_id: event.event_id, application_id: req.body.application_id, vendor_user_id: req.user._id },
            { singleResult: true }
          ),
          EventVendorApplicationModel.findOne({
            event_id: event.event_id,
            application_id: req.body.application_id,
            vendor_user_id: req.user._id,
          }).lean(),
        ]);
        if (!ownedFoodApplication && !ownedEventVendorApplication) throw buildError('Marketplace application not found', 404);
        applicationId = (ownedFoodApplication || ownedEventVendorApplication).application_id;
        ({ foodTruckId, eventVendorProfileId, displayIdentity } = resolveMarketplaceSubmissionParticipant({
          foodApplication: ownedFoodApplication,
          eventVendorApplication: ownedEventVendorApplication,
        }));
      } else {
        const eventVendorProfile = await EventVendorProfileModel.findOne({
          vendor_user_id: req.user._id,
          status: 'ACTIVE',
          review_status: 'APPROVED',
        }).lean();
        const fallbackFoodTruckId = eventVendorProfile
          ? null
          : (await getVendorMarketplaceFoodTruck(req.user._id))._id;
        ({ foodTruckId, eventVendorProfileId, displayIdentity } = resolveMarketplaceSubmissionParticipant({
          fallbackEventVendorProfileId: eventVendorProfile?.profile_id || null,
          fallbackFoodTruckId,
        }));
      }
    } else if (req.user.userType === 'CUSTOMER') {
      const targetBid = req.body.bid_id
        ? await MarketplaceBidService.getByData(
            {
              event_id: event.event_id,
              bid_id: req.body.bid_id,
              bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
            },
            { singleResult: true }
          )
        : null;
      const [targetFoodApplication, targetEventVendorApplication] = req.body.application_id
        ? await Promise.all([
            MarketplaceApplicationService.getByData(
              {
                event_id: event.event_id,
                application_id: req.body.application_id,
                application_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
              },
              { singleResult: true }
            ),
            EventVendorApplicationModel.findOne({
              event_id: event.event_id,
              application_id: req.body.application_id,
              status: { $nin: ['WITHDRAWN'] },
            }).lean(),
          ])
        : [null, null];
      const targetApplicationParticipant = targetFoodApplication || targetEventVendorApplication
        ? resolveMarketplaceSubmissionParticipant({
            foodApplication: targetFoodApplication,
            eventVendorApplication: targetEventVendorApplication,
          })
        : null;
      const targetApplication = targetFoodApplication || targetEventVendorApplication;
      const targetVendorUserId =
        targetBid?.vendor_user_id ||
        targetApplication?.vendor_user_id ||
        normalizeMarketplaceVendorIdentifier(req.body.vendor_user_id);

      if (!targetVendorUserId) {
        throw buildError('Select a submitted vendor to message.', 400);
      }

      const [targetVendorBid, targetVendorApplication, matchedSubmission] =
        await Promise.all([
          MarketplaceBidService.getByData(
            {
              event_id: event.event_id,
              vendor_user_id: targetVendorUserId,
              bid_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
            },
            { singleResult: true }
          ),
          MarketplaceApplicationService.getByData(
            {
              event_id: event.event_id,
              vendor_user_id: targetVendorUserId,
              application_status: { $nin: ['DRAFT', 'WITHDRAWN'] },
            },
            { singleResult: true }
          ),
          targetBid || targetApplication
            ? null
            : findMarketplaceSubmissionForVendorIdentifier(
                event.event_id,
                targetVendorUserId
              ),
        ]);

      const targetSubmission =
        targetBid ||
        targetApplication ||
        targetVendorBid ||
        targetVendorApplication ||
        matchedSubmission;
      if (!targetSubmission) {
        throw buildError('Vendor submission not found for this event.', 404);
      }

      vendorUserId = targetSubmission.vendor_user_id;
      foodTruckId = targetApplicationParticipant?.foodTruckId ?? targetSubmission.food_truck_id;
      bidId = targetSubmission.bid_id || null;
      applicationId = targetSubmission.application_id || null;
      eventVendorProfileId = targetApplicationParticipant?.eventVendorProfileId ?? targetSubmission.profile_id ?? null;
      displayIdentity = targetApplicationParticipant?.displayIdentity || foodTruckId || eventVendorProfileId || vendorUserId;
      initiatedByRole = 'CUSTOMER';
    } else {
      throw buildError('Only vendors and coordinators can send marketplace messages', 403);
    }

    assertMarketplaceMessageParticipantContext({
      foodTruckId,
      eventVendorProfileId,
      bidId,
      applicationId,
    });

    const marketplaceQuestion = await MarketplaceEventQuestionService.create({
      event_id: event.event_id,
      vendor_user_id: vendorUserId,
      food_truck_id: foodTruckId,
      event_vendor_profile_id: eventVendorProfileId,
      vendor_display_id: getVendorDisplayId(displayIdentity || foodTruckId || eventVendorProfileId || vendorUserId),
      initiated_by_role: initiatedByRole,
      bid_id: bidId,
      application_id: applicationId,
      question_text_raw: questionText,
      question_text_public: questionText,
      status: initiatedByRole === 'CUSTOMER' ? 'PUBLISHED' : 'PENDING',
      question_moderation_status: moderation.status,
      question_moderation_reasons: moderation.reasons,
      coordinator_read_at: initiatedByRole === 'CUSTOMER' ? new Date() : null,
    });

    if (initiatedByRole === 'CUSTOMER') {
      await notifyVendorOfCoordinatorMarketplaceMessage(event, marketplaceQuestion);
    } else {
      await notifyCoordinatorOfMarketplaceQuestion(event);
    }

    return res.data(
      {
        marketplaceQuestion: sanitizeMarketplaceQuestion(marketplaceQuestion),
        blocked: false,
      },
      initiatedByRole === 'CUSTOMER'
          ? 'Marketplace message sent'
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
    if (isBlocked) {
      assertMarketplaceTextAllowed(answerText, 'Message');
    }

    question.answer_text_raw = answerText;
    question.answer_text_public = answerText;
    question.answer_moderation_status = moderation.status;
    question.answer_moderation_reasons = moderation.reasons;
    question.answered_by_user_id = req.user._id;
    question.answered_by_role = req.user.userType;
    question.answered_at = new Date();
    question.vendor_read_at = null;
    question.acted_by_admin_user_id =
      req.user.userType === 'SUPER_ADMIN' ? req.user._id : null;
    question.acted_on_behalf_of_user_id =
      req.user.userType === 'SUPER_ADMIN' ? event.customer_user_id : null;
    question.proxy_action_reason = req.body.proxy_action_reason || null;
    question.status = 'PUBLISHED';
    await question.save();

    await notifyVendorsOfMarketplaceAnswer(event, question);

    return res.data(
      {
        marketplaceQuestion: sanitizeMarketplaceQuestion(question, {
          includeBlocked: req.user.userType === 'SUPER_ADMIN',
        }),
        blocked: false,
      },
      'Marketplace answer published'
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
        {
          event_id: req.params.eventId,
          bid_status: { $nin: ['DRAFT', 'PENDING_SIGNATURE'] },
        },
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
        {
          event_id: req.params.eventId,
          application_status: { $nin: ['DRAFT', 'PENDING_SIGNATURE'] },
        },
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
    const linkedApplicationIds = bids
      .map((bid) => bid.linked_application_id)
      .filter(Boolean);
    const linkedVendorPayments = linkedApplicationIds.length
      ? await MarketplacePaymentService.getByData(
          {
            application_id: { $in: linkedApplicationIds },
            payment_type: 'VENDOR_EVENT_FEE',
            payment_status: { $in: ['PENDING', 'PROCESSING', 'PAID'] },
          },
          { sort: { created_at: -1 }, lean: true }
        )
      : [];
    const linkedVendorPaymentByApplicationId = linkedVendorPayments.reduce(
      (result, payment) => {
        if (!result[payment.application_id]) result[payment.application_id] = payment;
        return result;
      },
      {}
    );
    const bidsWithUnlock = bids.map((bid) => {
      const unlockState = getMarketplaceUnlockState({ event, bid });
      const linkedVendorPayment = bid.linked_application_id
        ? linkedVendorPaymentByApplicationId[bid.linked_application_id]
        : null;
      return {
        ...redactLockedMarketplaceRecord(bid, unlockState, {
          fullAccess: false,
        }),
        linked_vendor_payment_status: linkedVendorPayment?.payment_status || null,
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

    await MarketplaceEventService.update(
      { event_id: req.params.eventId, customer_user_id: req.user._id },
      { submissions_seen_at: new Date() }
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

const notifyVendorNotSelected = async ({ event, vendorUserId, submissionType, submissionId }) => {
  try {
    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: vendorUserId,
      title: 'Marketplace submission not selected',
      body: `${event.event_name || 'Your event'} did not select your ${submissionType}.`,
      data: {
        notificationType: 'MARKETPLACE_SUBMISSION_NOT_SELECTED',
        eventId: event.event_id,
        submissionType,
        submissionId,
      },
      metadata: { eventId: event.event_id, submissionType, submissionId },
    });
  } catch (error) {
    console.error('Marketplace not-selected notification failed', {
      eventId: event.event_id,
      submissionId,
      message: error.message,
    });
  }
};

exports.declineBid = async (req, res, next) => {
  try {
    const bid = await MarketplaceBidService.getByData(
      { bid_id: req.params.bidId },
      { singleResult: true }
    );
    if (!bid) throw buildError('Marketplace bid not found', 404);
    const event = await getOwnedEvent(bid.event_id, req.user._id);
    const transition = getCoordinatorNotSelectTransition('BID', bid.bid_status);
    if (transition.idempotent) {
      return res.data({ marketplaceBid: bid }, 'Marketplace bid already declined');
    }
    assertEventOpenForRejectionDecision(event);
    if (!transition.eligible) {
      throw buildError('This bid can no longer be declined.', 409);
    }
    const marketplaceBid = await MarketplaceBidService.update(
      { bid_id: bid.bid_id, bid_status: bid.bid_status },
      { bid_status: transition.targetStatus },
      { getNew: true }
    );
    await notifyVendorNotSelected({
      event,
      vendorUserId: bid.vendor_user_id,
      submissionType: 'bid',
      submissionId: bid.bid_id,
    });
    return res.data({ marketplaceBid }, 'Marketplace bid declined');
  } catch (e) {
    return next(e);
  }
};

exports.declineApplication = async (req, res, next) => {
  try {
    const application = await MarketplaceApplicationService.getByData(
      { application_id: req.params.applicationId },
      { singleResult: true }
    );
    if (!application) throw buildError('Marketplace application not found', 404);
    const event = await getOwnedEvent(application.event_id, req.user._id);
    const transition = getCoordinatorNotSelectTransition(
      'APPLICATION',
      application.application_status
    );
    if (transition.idempotent) {
      return res.data(
        { marketplaceApplication: application },
        'Marketplace application already not selected'
      );
    }
    assertEventOpenForRejectionDecision(event);
    if (!transition.eligible) {
      throw buildError('This application can no longer be marked not selected.', 409);
    }
    const marketplaceApplication = await MarketplaceApplicationService.update(
      { application_id: application.application_id, application_status: application.application_status },
      { application_status: transition.targetStatus },
      { getNew: true }
    );
    await notifyVendorNotSelected({
      event,
      vendorUserId: application.vendor_user_id,
      submissionType: 'application',
      submissionId: application.application_id,
    });
    return res.data({ marketplaceApplication }, 'Marketplace application not selected');
  } catch (e) {
    return next(e);
  }
};

exports.submitBid = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can submit marketplace bids', 403);
    }

    const isEventVendor = req.user.vendorSubtype === 'EVENT_VENDOR';
    const foodTruck = isEventVendor ? null : await getVendorMarketplaceFoodTruck(req.user._id);
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

    if (roundMoney(event.budgeted_amount || 0) <= 0) {
      throw buildError('This event uses the application flow, not bids', 400);
    }
    if (requestedStatus !== 'DRAFT') {
      await assertFoodVendorEventHasCapacity(event);
    }

    const withdrawnBid = await MarketplaceBidService.getByData(
      {
        event_id: req.params.eventId,
        vendor_user_id: req.user._id,
        submission_round: currentRound,
        bid_status: 'WITHDRAWN',
      },
      { singleResult: true }
    );
    if (withdrawnBid) {
      throw buildError('This bid was withdrawn. Use the deliberate Reapply workflow if the coordinator permits another submission.', 409);
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
    if (existingApplication) {
      throw buildError(
        'You already chose the vendor-paid application option for this event. Delete or withdraw it before submitting a bid.',
        409
      );
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
    const isBidRevision = existingBid && hasOpenBidRevisionRequest(existingBid);

    if (requestedStatus !== 'DRAFT' && !isBidRevision) {
      await assertVendorCanSubmitRound(event, req.user._id);
    }

    if (
      existingBid &&
      !['DRAFT', 'PENDING_SIGNATURE'].includes(existingBid.bid_status) &&
      !isBidRevision
    ) {
      throw buildError('A bid has already been submitted for this event', 409);
    }
    if (isBidRevision && requestedStatus !== 'SUBMITTED') {
      throw buildError('Submit the revised bid to update your response.', 400);
    }

    const allowedCoverages = getAllowedBidCoverages(event);
    const guestCoverage = String(
      req.body.guest_coverage || allowedCoverages[0]
    ).toUpperCase();
    if (!allowedCoverages.includes(guestCoverage)) {
      throw buildError(
        `This event only accepts: ${allowedCoverages.join(', ')}.`,
        400
      );
    }
    const regularGuestAmount = roundMoney(req.body.regular_guest_amount || 0);
    const vipCateringAmount = roundMoney(req.body.vip_catering_amount || 0);
    const normalizedFullBidAmount = guestCoverage === 'BOTH'
      ? event.fully_catered_event
        ? roundMoney(regularGuestAmount + vipCateringAmount)
        : vipCateringAmount
      : roundMoney(req.body.full_bid_amount || 0);

    if (requestedStatus !== 'DRAFT') {
      assertRequiredMarketplaceFields({
        'Full bid amount': normalizedFullBidAmount,
      });
      if (
        guestCoverage === 'BOTH' &&
        ((event.fully_catered_event && regularGuestAmount <= 0) ||
          vipCateringAmount <= 0)
      ) {
        throw buildError(
          event.fully_catered_event
            ? 'Enter separate Regular Guests and VIP Catering amounts when offering Both.'
            : 'Enter the VIP Catering amount for a combined VIP Catering and GA Sales offer.',
          400
        );
      }
    }
    const liquorLicenseSatisfied = await hasSatisfiedLiquorLicenseRequirement({
      event,
      foodTruckId: foodTruck._id,
      liquorLicenseConfirmed: req.body.liquor_license_confirmed,
    });
    if (requestedStatus !== 'DRAFT' && !liquorLicenseSatisfied) {
      throw buildError(
        'Liquor license confirmation is required for this event',
        400
      );
    }
    assertMarketplaceTextAllowed(req.body.notes, 'Notes');
    if (requestedStatus === 'SUBMITTED') {
      await requireSignedVendorAgreementForSubmission(req.user._id);
    }

    // A bid competes for the coordinator-paid award. The vendor attendance
    // fee belongs only to the mutually exclusive application path.
    const requiresPayment = false;
    const submittedAt =
      requestedStatus === 'SUBMITTED' && !requiresPayment ? new Date() : null;
    const bidPayload = {
      ...req.body,
      guest_coverage: guestCoverage,
      regular_guest_amount:
        guestCoverage === 'BOTH' && event.fully_catered_event
          ? regularGuestAmount
          : null,
      vip_catering_amount:
        guestCoverage === 'BOTH' ? vipCateringAmount : null,
      full_bid_amount: normalizedFullBidAmount,
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
      payment_id: isBidRevision ? existingBid.payment_id : undefined,
      payment_status: isBidRevision
        ? existingBid.payment_status
        : requiresPayment
          ? 'PENDING'
          : 'NOT_REQUIRED',
      submitted_at: submittedAt || existingBid?.submitted_at || null,
      revision_submitted_at: isBidRevision ? submittedAt : existingBid?.revision_submitted_at || null,
      revision_requested_fields: isBidRevision ? [] : existingBid?.revision_requested_fields || [],
      revision_count: isBidRevision ? Number(existingBid.revision_count || 0) + 1 : existingBid?.revision_count || 0,
    };
    const marketplaceBid = existingBid
      ? await MarketplaceBidService.update(
          { bid_id: existingBid.bid_id },
          bidPayload,
          { getNew: true }
        )
      : await MarketplaceBidService.create(bidPayload);

    if (requestedStatus === 'SUBMITTED') {
      await attachVerifiedComplianceDocumentsToSubmission({
        eventId: event.event_id,
        foodTruck,
        submission: marketplaceBid,
        submissionType: 'bid',
        uploadedByUserId: req.user._id,
      });
    }

    let marketplacePayment = null;
    if (requiresPayment && requestedStatus === 'SUBMITTED') {
      marketplacePayment = await MarketplacePaymentService.create({
        event_id: event.event_id,
        bid_id: marketplaceBid.bid_id,
        payer_user_id: req.user._id,
        payer_type: 'VENDOR',
        food_truck_id: foodTruck?._id || null,
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

exports.withdrawBid = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can withdraw marketplace bids', 403);
    }

    const bid = await MarketplaceBidService.getByData(
      {
        bid_id: req.params.bidId,
        vendor_user_id: req.user._id,
        archived_at: null,
      },
      { singleResult: true }
    );

    if (!bid) {
      throw buildError('Marketplace bid not found', 404);
    }

    if (bid.bid_status === 'WITHDRAWN') {
      return res.data({ marketplaceBid: bid }, 'Marketplace bid already withdrawn');
    }

    if (['AWARDED', 'NOT_AWARDED', 'DECLINED'].includes(bid.bid_status)) {
      throw buildError('This bid can no longer be withdrawn.', 400);
    }

    bid.bid_status = 'WITHDRAWN';
    bid.withdrawn_at = new Date();
    bid.withdrawn_by_user_id = req.user._id;
    await bid.save();

    return res.data({ marketplaceBid: bid }, 'Marketplace bid withdrawn');
  } catch (e) {
    return next(e);
  }
};

exports.deleteDraftBid = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can delete marketplace bid drafts', 403);
    }

    const bid = await MarketplaceBidService.getByData(
      {
        bid_id: req.params.bidId,
        vendor_user_id: req.user._id,
        archived_at: null,
      },
      { singleResult: true }
    );

    if (!bid) {
      throw buildError('Marketplace bid not found', 404);
    }

    if (bid.bid_status !== 'DRAFT') {
      throw buildError('Only draft bids can be deleted. Submitted bids can be withdrawn.', 400);
    }

    const attachments = await MarketplaceAttachmentService.getByData({
      bid_id: bid.bid_id,
      status: { $ne: 'DELETED' },
    });
    for (const attachment of attachments || []) {
      if (attachment.file_key) {
        try {
          await removeObject(attachment.file_key);
        } catch (error) {
          console.warn('Failed to remove draft bid attachment from storage', {
            attachment_id: attachment.attachment_id,
            file_key: attachment.file_key,
            message: error?.message,
          });
        }
      }
    }

    await MarketplaceAttachmentService.destroyMany({ bid_id: bid.bid_id });
    await MarketplaceBidService.destroy({ bid_id: bid.bid_id });

    return res.data({ bid_id: req.params.bidId }, 'Marketplace bid draft deleted');
  } catch (e) {
    return next(e);
  }
};

exports.vendorNotificationSummary = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can view marketplace notifications', 403);
    }

    const eventVendorProfile = await EventVendorProfileModel.findOne({
      vendor_user_id: req.user._id,
      status: 'ACTIVE',
    }).lean();
    const vendorFoodTruck = eventVendorProfile
      ? null
      : await getVendorMarketplaceFoodTruck(req.user._id, { enforceCompliance: false });
    if (vendorFoodTruck) {
      await OperationalComplianceFormService.retryPendingNotificationsForVendor(
        req.user._id
      );
    }

    const [questions, bids, applications, closedCandidateBids, closedCandidateApplications, operationalNotifications] = await Promise.all([
      MarketplaceEventQuestionService.getByData(
        {
          vendor_user_id: req.user._id,
          status: { $in: ['PUBLISHED'] },
          $or: [
            { initiated_by_role: 'CUSTOMER' },
            { answer_text_public: { $nin: [null, ''] } },
          ],
        },
        { sort: { answered_at: -1, created_at: -1 }, lean: true }
      ),
      MarketplaceBidService.getByData(
        {
          vendor_user_id: req.user._id,
          bid_status: {
            $in: [
              'AWARDED',
              'NOT_AWARDED',
              'DECLINED',
              'NOT_SELECTED',
              'PAYMENT_DUE',
              'PENDING_PAYMENT',
              'REVISION_REQUESTED',
              'UPDATE_REQUESTED',
            ],
          },
        },
        { sort: { updated_at: -1, submitted_at: -1, created_at: -1 }, lean: true }
      ),
      MarketplaceApplicationService.getByData(
        {
          vendor_user_id: req.user._id,
          application_status: {
            $in: [
              'ACCEPTED',
              'CONFIRMED',
              'PAYMENT_DUE',
              'PENDING_PAYMENT',
              'DECLINED',
              'NOT_SELECTED',
              'REVISION_REQUESTED',
              'UPDATE_REQUESTED',
            ],
          },
        },
        { sort: { updated_at: -1, submitted_at: -1, created_at: -1 }, lean: true }
      ),
      MarketplaceBidService.getByData(
        {
          vendor_user_id: req.user._id,
          bid_status: {
            $nin: [
              'DRAFT',
              'WITHDRAWN',
              'AWARDED',
              'NOT_AWARDED',
              'DECLINED',
              'NOT_SELECTED',
            ],
          },
        },
        { sort: { updated_at: -1, submitted_at: -1, created_at: -1 }, lean: true }
      ),
      MarketplaceApplicationService.getByData(
        {
          vendor_user_id: req.user._id,
          application_status: {
            $nin: [
              'DRAFT',
              'WITHDRAWN',
              'ACCEPTED',
              'CONFIRMED',
              'PAYMENT_DUE',
              'PENDING_PAYMENT',
              'DECLINED',
              'NOT_SELECTED',
            ],
          },
        },
        { sort: { updated_at: -1, submitted_at: -1, created_at: -1 }, lean: true }
      ),
      OperationalNotificationModel.find({ vendor_user_id: req.user._id })
        .sort({ occurred_at: -1 })
        .limit(50)
        .lean(),
    ]);

    const eventIds = [
      ...new Set(
        [
          ...questions.map((question) => question.event_id),
          ...bids.map((bid) => bid.event_id),
          ...applications.map((application) => application.event_id),
          ...closedCandidateBids.map((bid) => bid.event_id),
          ...closedCandidateApplications.map((application) => application.event_id),
        ]
          .map((eventId) => String(eventId || '').trim())
          .filter(Boolean)
      ),
    ];
    const events = eventIds.length
      ? await MarketplaceEventService.getByData(
          { event_id: { $in: eventIds } },
          { lean: true }
        )
      : [];
    const eventById = events.reduce((acc, event) => {
      acc[String(event.event_id)] = event;
      return acc;
    }, {});

    const messageNotifications = questions.map((question) => {
      const event = eventById[String(question.event_id)] || {};
      return {
        ...buildMarketplaceMessageNotification(question, event, req.user),
        event_name: toNotificationEventLabel(event),
        event_date: toNotificationEventDate(event),
      };
    });

    const bidNotifications = bids
      .map((bid) => {
        const displayStatus = bid.award_revoked_at ? 'REVOKED' : bid.bid_status;
        const copy = getVendorSubmissionNotificationCopy(displayStatus, 'bid');
        if (!copy) return null;
        return buildVendorSubmissionNotification({
          id: `marketplace-bid-${bid.bid_id}-${bid.bid_status}`,
          type: 'MARKETPLACE_BID',
          event: eventById[String(bid.event_id)] || {},
          status: displayStatus,
          title: copy.title,
          subtitle: copy.subtitle,
          bidId: bid.bid_id,
        });
      })
      .filter(Boolean);

    const applicationNotifications = applications
      .map((application) => {
        const displayStatus = application.award_revoked_at
          ? 'REVOKED'
          : application.application_status;
        const copy = getVendorSubmissionNotificationCopy(
          displayStatus,
          'application'
        );
        if (!copy) return null;
        return buildVendorSubmissionNotification({
          id: `marketplace-application-${application.application_id}-${application.application_status}`,
          type: 'MARKETPLACE_APPLICATION',
          event: eventById[String(application.event_id)] || {},
          status: displayStatus,
          title: copy.title,
          subtitle: copy.subtitle,
          applicationId: application.application_id,
        });
      })
      .filter(Boolean);

    const closedBidNotifications = closedCandidateBids
      .map((bid) => {
        const event = eventById[String(bid.event_id)] || {};
        if (event.status !== 'CLOSED') return null;
        return buildVendorSubmissionNotification({
          id: `marketplace-closed-bid-${bid.bid_id}`,
          type: 'MARKETPLACE_EVENT_CLOSED',
          event,
          status: 'CLOSED',
          title: 'Event closed',
          subtitle: 'This event closed and no vendor was awarded.',
          bidId: bid.bid_id,
        });
      })
      .filter(Boolean);

    const closedApplicationNotifications = closedCandidateApplications
      .map((application) => {
        const event = eventById[String(application.event_id)] || {};
        if (event.status !== 'CLOSED') return null;
        return buildVendorSubmissionNotification({
          id: `marketplace-closed-application-${application.application_id}`,
          type: 'MARKETPLACE_EVENT_CLOSED',
          event,
          status: 'CLOSED',
          title: 'Event closed',
          subtitle: 'This event closed and your application was not selected.',
          applicationId: application.application_id,
        });
      })
      .filter(Boolean);

    const operationalNotificationList = operationalNotifications.map((item) => {
      const truckUnit = (vendorFoodTruck?.truck_units || []).find(
        (unit) => String(unit._id) === String(item.truck_unit_id)
      );
      const location = (vendorFoodTruck?.locations || []).find(
        (entry) => String(entry._id) === String(item.location_id)
      );
      const formLabel = String(item.form_type || '')
        .toLowerCase()
        .replaceAll('_', ' ');
      return {
        id: `operational-${item._id}`,
        notification_id: String(item._id),
        type: 'OPERATIONAL_COMPLIANCE',
        title: `${item.employee_name} ${item.action === 'SAVED' ? 'saved' : 'submitted'} ${formLabel}`,
        subtitle: [truckUnit?.name, location?.address || location?.name]
          .filter(Boolean)
          .join(' · ') || 'Open the operations form.',
        employee_name: item.employee_name,
        form_id: String(item.form_id),
        form_type: item.form_type,
        truck_unit_id: item.truck_unit_id,
        location_id: item.location_id,
        occurred_at: item.occurred_at,
        acknowledged: !!item.acknowledged_at,
      };
    });

    const marketplaceNotificationList = [
      ...operationalNotificationList,
      ...messageNotifications,
      ...bidNotifications,
      ...applicationNotifications,
      ...closedBidNotifications,
      ...closedApplicationNotifications,
    ].slice(0, 50);

    return res.data(
      {
        marketplaceNotificationList,
        unread_message_count: messageNotifications.filter((item) => item.unread).length,
        action_required_count:
          bidNotifications.length +
          applicationNotifications.length +
          closedBidNotifications.length +
          closedApplicationNotifications.length,
        operational_unread_count: operationalNotificationList.filter(
          (item) => !item.acknowledged
        ).length,
        total_count: marketplaceNotificationList.length,
      },
      'Vendor marketplace notifications'
    );
  } catch (e) {
    return next(e);
  }
};

exports.acknowledgeVendorNotifications = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can acknowledge notifications', 403);
    }
    await OperationalNotificationModel.updateMany(
      {
        _id: { $in: req.body.notification_ids },
        vendor_user_id: req.user._id,
        acknowledged_at: null,
      },
      { $set: { acknowledged_at: new Date() } }
    );
    return res.data({}, 'Vendor notifications acknowledged');
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

    if (roundMoney(event.vendor_fee || 0) <= 0) {
      throw buildError('This event uses the bid flow, not applications', 400);
    }
    if (requestedStatus !== 'DRAFT') {
      await assertFoodVendorEventHasCapacity(event);
    }

    const withdrawnApplication = await MarketplaceApplicationService.getByData(
      {
        event_id: req.params.eventId,
        vendor_user_id: req.user._id,
        submission_round: currentRound,
        application_status: 'WITHDRAWN',
      },
      { singleResult: true }
    );
    if (withdrawnApplication) {
      throw buildError('This application was withdrawn. Use the deliberate Reapply workflow if the coordinator permits another submission.', 409);
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
    if (existingBid) {
      throw buildError(
        'You already chose the coordinator-paid bid option for this event. Delete or withdraw it before submitting an application.',
        409
      );
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
    const isApplicationRevision =
      existingApplication && hasOpenApplicationRevisionRequest(existingApplication);
    const canEditPreAwardApplication =
      existingApplication &&
      PRE_AWARD_EDITABLE_APPLICATION_STATUSES.includes(
        existingApplication.application_status
      );
    const isFinalApplicationStatus = ['SUBMITTED', 'UNDER_REVIEW'].includes(
      requestedStatus
    );

    if (
      requestedStatus !== 'DRAFT' &&
      !isApplicationRevision &&
      !canEditPreAwardApplication
    ) {
      await assertVendorCanSubmitRound(event, req.user._id);
    }

    if (
      existingApplication &&
      !canEditPreAwardApplication &&
      !isApplicationRevision
    ) {
      throw buildError('This application can no longer be edited', 409);
    }
    if (isApplicationRevision && requestedStatus !== 'SUBMITTED') {
      throw buildError('Submit the revised application to update your response.', 400);
    }

    // Contact identity is authoritative from the authenticated account. Mobile
    // clients may not choose which vendor contact details reach a coordinator.
    const vendorContact = deriveMarketplaceVendorContact({
      user: req.user,
      foodTruck,
    });

    if (requestedStatus !== 'DRAFT') {
      assertRequiredMarketplaceFields({
        'Business name': req.body.business_name,
        'Contact name': vendorContact.contact_name,
        Phone: vendorContact.phone,
        Email: vendorContact.email,
        'Food type / cuisine': req.body.food_type_cuisine,
      });
    }
    const liquorLicenseSatisfied = await hasSatisfiedLiquorLicenseRequirement({
      event,
      foodTruckId: foodTruck._id,
      liquorLicenseConfirmed: req.body.liquor_license_confirmed,
    });
    if (requestedStatus !== 'DRAFT' && !liquorLicenseSatisfied) {
      throw buildError(
        'Liquor license confirmation is required for this event',
        400
      );
    }
    assertMarketplaceTextAllowed(req.body.notes, 'Notes');
    if (isFinalApplicationStatus) {
      await requireSignedVendorAgreementForSubmission(req.user._id);
    }

    const submittedAt = isFinalApplicationStatus ? new Date() : null;
    const applicationPayload = {
      ...req.body,
      ...vendorContact,
      event_id: req.params.eventId,
      vendor_user_id: req.user._id,
      food_truck_id: foodTruck._id,
      submission_round: currentRound,
      nda_required: true,
      nda_acknowledged: isFinalApplicationStatus,
      nda_acknowledged_at: isFinalApplicationStatus ? new Date() : null,
      agreement_provider: 'DOCUSIGN',
      agreement_status: isFinalApplicationStatus ? 'SIGNED' : 'PENDING_SIGNATURE',
      application_status: requestedStatus,
      payment_status: existingApplication?.payment_status || 'NOT_REQUIRED',
      submitted_at: submittedAt || existingApplication?.submitted_at || null,
      revision_submitted_at: isApplicationRevision
        ? submittedAt
        : existingApplication?.revision_submitted_at || null,
      revision_requested_fields: isApplicationRevision
        ? []
        : existingApplication?.revision_requested_fields || [],
      revision_count: isApplicationRevision
        ? Number(existingApplication.revision_count || 0) + 1
        : existingApplication?.revision_count || 0,
    };
    const marketplaceApplication = existingApplication
      ? await MarketplaceApplicationService.update(
          { application_id: existingApplication.application_id },
          applicationPayload,
          { getNew: true }
        )
      : await MarketplaceApplicationService.create(applicationPayload);

    if (isFinalApplicationStatus) {
      await attachVerifiedComplianceDocumentsToSubmission({
        eventId: event.event_id,
        foodTruck,
        submission: marketplaceApplication,
        submissionType: 'application',
        uploadedByUserId: req.user._id,
      });
    }

    if (isFinalApplicationStatus) {
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
    const eventIds = [
      ...new Set(
        marketplaceApplicationList
          .map((application) => String(application.event_id || '').trim())
          .filter(Boolean)
      ),
    ];
    const unreadMessageCounts = eventIds.length
      ? await MarketplaceEventQuestionService.getModel().aggregate([
          {
            $match: {
              event_id: { $in: eventIds },
              vendor_user_id: req.user._id,
              status: 'PUBLISHED',
              $or: [
                {
                  initiated_by_role: 'CUSTOMER',
                  $or: [
                    { vendor_read_at: null },
                    { $expr: { $lt: ['$vendor_read_at', '$created_at'] } },
                  ],
                },
                {
                  answer_text_public: { $nin: [null, ''] },
                  answered_at: { $ne: null },
                  $or: [
                    { vendor_read_at: null },
                    { $expr: { $lt: ['$vendor_read_at', '$answered_at'] } },
                  ],
                },
              ],
            },
          },
          { $group: { _id: '$event_id', total: { $sum: 1 } } },
        ])
      : [];
    const unreadMessageCountByEventId = unreadMessageCounts.reduce(
      (acc, item) => {
        acc[item._id] = item.total;
        return acc;
      },
      {}
    );
    const marketplaceApplicationsWithUnreadMessages =
      marketplaceApplicationList.map((application) => ({
        ...application,
        unread_message_count:
          unreadMessageCountByEventId[application.event_id] || 0,
      }));

    return res.data(
      { marketplaceApplicationList: marketplaceApplicationsWithUnreadMessages },
      'Marketplace applications'
    );
  } catch (e) {
    return next(e);
  }
};

exports.withdrawApplication = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can withdraw marketplace applications', 403);
    }

    const application = await MarketplaceApplicationService.getByData(
      {
        application_id: req.params.applicationId,
        vendor_user_id: req.user._id,
        archived_at: null,
      },
      { singleResult: true }
    );

    if (!application) {
      throw buildError('Marketplace application not found', 404);
    }

    if (application.application_status === 'WITHDRAWN') {
      return res.data(
        { marketplaceApplication: application },
        'Marketplace application already withdrawn'
      );
    }

    if (
      [
        'ACCEPTED',
        'PAYMENT_DUE',
        'PAID',
        'CONFIRMED',
        'NOT_SELECTED',
      ].includes(application.application_status)
    ) {
      throw buildError('This application can no longer be withdrawn.', 400);
    }

    application.application_status = 'WITHDRAWN';
    application.withdrawn_at = new Date();
    application.withdrawn_by_user_id = req.user._id;
    await application.save();

    return res.data(
      { marketplaceApplication: application },
      'Marketplace application withdrawn'
    );
  } catch (e) {
    return next(e);
  }
};

exports.deleteDraftApplication = async (req, res, next) => {
  try {
    if (req.user.userType !== 'VENDOR') {
      throw buildError('Only vendors can delete marketplace application drafts', 403);
    }

    const application = await MarketplaceApplicationService.getByData(
      {
        application_id: req.params.applicationId,
        vendor_user_id: req.user._id,
        archived_at: null,
      },
      { singleResult: true }
    );

    if (!application) {
      throw buildError('Marketplace application not found', 404);
    }

    if (application.application_status !== 'DRAFT') {
      throw buildError(
        'Only draft applications can be deleted. Submitted applications can be withdrawn.',
        400
      );
    }

    const attachments = await MarketplaceAttachmentService.getByData({
      application_id: application.application_id,
      status: { $ne: 'DELETED' },
    });
    for (const attachment of attachments || []) {
      if (attachment.file_key) {
        try {
          await removeObject(attachment.file_key);
        } catch (error) {
          console.warn('Failed to remove draft application attachment from storage', {
            attachment_id: attachment.attachment_id,
            file_key: attachment.file_key,
            message: error?.message,
          });
        }
      }
    }

    await MarketplaceAttachmentService.destroyMany({
      application_id: application.application_id,
    });
    await MarketplaceApplicationService.destroy({
      application_id: application.application_id,
    });

    return res.data(
      { application_id: req.params.applicationId },
      'Marketplace application draft deleted'
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

    const { foodTruck, eventVendorProfile } =
      await resolveMarketplaceAgreementVendorContext({
        user: req.user,
        findApprovedEventVendorProfile: (vendorUserId) =>
          EventVendorProfileModel.findOne({
            vendor_user_id: vendorUserId,
            status: 'ACTIVE',
            review_status: 'APPROVED',
          }).lean(),
        findFoodTruck: (vendorUserId) =>
          getVendorMarketplaceFoodTruck(vendorUserId),
      });
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
    const agreementType = eventVendorProfile ? 'EVENT_VENDOR' : 'FOOD_VENDOR';
    const activeIdentityKey = buildActiveAgreementIdentityKey({
      vendorUserId: req.user._id,
      eventVendorProfileId: eventVendorProfile?.profile_id || null,
      eventId: event.event_id,
      agreementType,
    });

    const forceNewAgreement =
      req.body.force_new === true ||
      req.body.force_new_agreement === true ||
      String(req.body.force_new || '').toLowerCase() === 'true' ||
      String(req.body.force_new_agreement || '').toLowerCase() === 'true';
    const validAgreement = req.body.reconcile_only === true
      ? null
      : await getValidVendorAgreement(
          req.user._id,
          eventVendorProfile?.profile_id || null
        );
    if (validAgreement && !forceNewAgreement) {
      await writeVendorAgreementAudit(validAgreement, 'ENVELOPE_REUSED', {
        source: 'USER_REFRESH',
        message: 'Existing signed annual agreement reused',
      });
      await persistSignedAgreementAttachment(
        buildSignedAgreementAttachmentContext({
          agreement: validAgreement,
          eventId: event.event_id,
          bidId: bid?.bid_id || null,
          applicationId: application?.application_id || null,
          vendorUserId: req.user._id,
          foodTruck,
          reuseExistingSignedDocument: true,
        })
      );

      return res.data(
        {
          marketplaceVendorAgreement: validAgreement,
          already_signed: true,
        },
        'Vendor agreements are already signed'
      );
    }

    const existingAgreements = forceNewAgreement
      ? []
      : await MarketplaceVendorAgreementService.getByData(
          {
            vendor_user_id: req.user._id,
            event_id: event.event_id,
            ...(eventVendorProfile
              ? { event_vendor_profile_id: eventVendorProfile.profile_id }
              : {}),
            ...(bid ? { bid_id: bid.bid_id } : {}),
            ...(application ? { application_id: application.application_id } : {}),
            $or: [
              {
                status: {
                  $in: [
                    'PENDING_SIGNATURE', 'SENT', 'VIEWED',
                    'CANCELLED', 'DECLINED', 'VOIDED', 'ERROR',
                  ],
                },
              },
              { status: 'SIGNED', expires_at: { $gt: new Date() } },
            ],
          },
          { sort: { created_at: -1 }, lean: false }
        );
    let existingAgreement = null;
    for (const candidate of existingAgreements || []) {
      if (!candidate.envelope_id) {
        existingAgreement ||= candidate;
        continue;
      }
      const documentVerification = await verifyVendorAgreementEnvelopeDocuments(candidate);
      if (!documentVerification.valid) {
        continue;
      }
      const reconciliation = await reconcileVendorAgreementEnvelope({
        agreement: candidate,
        getEnvelopeStatus: DocuSignHelper.getEnvelopeStatus,
        mapEnvelopeStatus: DocuSignHelper.mapEnvelopeStatus,
        setSubmissionSignatureStatus,
        persistSignedAgreementAttachment,
        getAnnualAgreementExpiry,
        recordAudit: (action, status, message) =>
          writeVendorAgreementAudit(candidate, action, {
            status,
            message,
            source: req.body.reconcile_only ? 'APP_RESUME' : 'USER_REFRESH',
          }),
      });
      if (reconciliation.alreadySigned) {
        return res.data(
          { marketplaceVendorAgreement: candidate, already_signed: true },
          'Vendor agreement signature reconciled'
        );
      }
      if (!['CANCELLED', 'DECLINED', 'VOIDED', 'ERROR'].includes(reconciliation.status)) {
        existingAgreement ||= candidate;
      }
    }

    if (req.body.reconcile_only === true) {
      const pendingRecipientView = existingAgreement?.envelope_id
        ? await createPendingVendorAgreementRecipientView({ agreement: existingAgreement })
        : null;
      return res.data(
        {
          marketplaceVendorAgreement: existingAgreement,
          already_signed: false,
          signing_incomplete: true,
          signing_url: pendingRecipientView?.url || null,
        },
        existingAgreement
          ? 'Vendor agreement is not yet signed'
          : 'No pending vendor agreement was found'
      );
    }
    if (existingAgreement) {
      await writeVendorAgreementAudit(existingAgreement, 'ENVELOPE_REUSED', {
        source: 'USER_REFRESH',
        message: 'Existing nonterminal envelope reused',
      });
    }

    const signer = getVendorSignerInfo(req.user);
    if (!signer.signerEmail) {
      throw buildError('Vendor email is required for DocuSign signing', 400);
    }

    let agreement = existingAgreement;
    let envelopeId = agreement?.envelope_id;

    try {
      let ownsEnvelopeCreation = false;
      if (!agreement) {
        const reservation = await reserveActiveMarketplaceAgreement({
          identityKey: activeIdentityKey,
          create: (payload) => MarketplaceVendorAgreementService.create(payload),
          find: (identityKey) => MarketplaceVendorAgreementService.getByData(
            { active_identity_key: identityKey },
            { singleResult: true, sort: { created_at: -1 }, lean: false }
          ),
          payload: {
            vendor_user_id: req.user._id,
            food_truck_id: foodTruck?._id || null,
            event_vendor_profile_id: eventVendorProfile?.profile_id || null,
            event_id: event.event_id,
            bid_id: bid?.bid_id || null,
            application_id: application?.application_id || null,
            application_draft_id: req.body.application_draft_id || null,
            agreement_type: agreementType,
            envelope_id: null,
            governance_template_id: docusign.governanceTemplateId,
            nda_template_id: docusign.ndaTemplateId,
            governance_version: docusign.governanceVersion,
            nda_version: docusign.ndaVersion,
            signer_role: docusign.signerRole,
            signer_name: signer.signerName,
            signer_email: signer.signerEmail,
            status: 'NOT_STARTED',
          },
        });
        agreement = reservation.agreement;
        ownsEnvelopeCreation = reservation.created;
        if (!ownsEnvelopeCreation) {
          await writeVendorAgreementAudit(agreement, 'ENVELOPE_REUSED', {
            message: 'Concurrent signing request reused the active envelope',
          });
        }
      }

      if (ownsEnvelopeCreation) {
        const envelope = await DocuSignHelper.createVendorMarketplaceSigningEnvelope({
          vendorName: signer.signerName,
          vendorEmail: signer.signerEmail,
          vendorUserId: req.user._id,
          event,
          bid,
          application,
        });
        envelopeId = envelope.envelopeId;
        agreement.envelope_id = envelopeId;
        agreement.status = 'SENT';
        await agreement.save();
        const documentVerification = await verifyVendorAgreementEnvelopeDocuments(agreement);
        if (!documentVerification.valid) {
          throw buildError(
            'DocuSign did not create both required agreement documents. Please try again.',
            502
          );
        }
        await writeVendorAgreementAudit(agreement, 'ENVELOPE_CREATED');
      } else if (!agreement.envelope_id) {
        for (let attempt = 0; attempt < 5 && !agreement.envelope_id; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          agreement = await MarketplaceVendorAgreementService.getByData(
            { active_identity_key: activeIdentityKey },
            { singleResult: true, sort: { created_at: -1 }, lean: false }
          );
        }
        if (!agreement?.envelope_id) {
          throw buildError('Agreement signing is being prepared. Please try again.', 409);
        }
        envelopeId = agreement.envelope_id;
      } else {
        envelopeId = agreement.envelope_id;
      }

      await setSubmissionSignatureStatus(agreement, 'PENDING_SIGNATURE');

      const recipientView = await createPendingVendorAgreementRecipientView({
        agreement,
        returnUrl: req.body.return_url,
      });
      if (!recipientView?.url) {
        throw buildError('DocuSign did not provide both required signing steps. Please try again.', 502);
      }

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
        agreement.active_identity_key = null;
        agreement.error_message = error.message;
        await agreement.save();
        await writeVendorAgreementAudit(agreement, 'ERROR', {
          status: 'ERROR',
          message: 'DocuSign signing request failed',
        });
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
    await writeVendorAgreementAudit(agreement, 'RETURN_RECEIVED', {
      source: 'APP_RETURN',
      message: `App return status: ${returnStatus}`,
    });

    try {
      if (!agreement.envelope_id) {
        throw buildError('DocuSign envelope is unavailable for verification', 409);
      }
      const envelope = await DocuSignHelper.getEnvelopeStatus(
        agreement.envelope_id
      );
      const envelopeStatus = DocuSignHelper.mapEnvelopeStatus(envelope.status);
      agreement.error_message = null;
      if (envelopeStatus === 'SIGNED') {
        agreement.status = 'SIGNED';
        agreement.signed_at = envelope.completedDateTime
          ? new Date(envelope.completedDateTime)
          : new Date();
        agreement.expires_at = getAnnualAgreementExpiry(agreement.signed_at);
        agreement.active_identity_key = null;
      } else if (returnStatus === 'cancelled') {
        agreement.status = 'CANCELLED';
        agreement.active_identity_key = null;
      } else if (returnStatus === 'declined') {
        agreement.status = 'DECLINED';
        agreement.active_identity_key = null;
      } else {
        agreement.status = envelopeStatus;
        agreement.error_message = returnStatus === 'completed'
          ? 'DocuSign has not confirmed the completed signature.'
          : 'Vendor returned from DocuSign with an error status.';
      }

      await agreement.save();
      await writeVendorAgreementAudit(agreement, 'STATUS_REFRESHED', {
        source: 'APP_RETURN',
        status: agreement.status,
        message: `DocuSign status: ${String(envelope.status || 'unknown')}`,
      });
      await setSubmissionSignatureStatus(agreement, agreement.status);
      if (agreement.status === 'SIGNED') {
        await persistSignedAgreementAttachment(agreement);
        await writeVendorAgreementAudit(agreement, 'SIGNED_DOCUMENT_RETRIEVED', {
          source: 'APP_RETURN',
        });
      }

      if (agreement.status === 'ERROR') {
        await sendDeveloperAlert('DocuSign vendor return error', agreement.error_message, {
          agreement_id: agreement.agreement_id,
          vendor_user_id: req.user._id,
        });
      }

      const nextRecipientView = !['SIGNED', 'CANCELLED', 'DECLINED', 'VOIDED', 'ERROR'].includes(agreement.status)
        ? await createPendingVendorAgreementRecipientView({ agreement })
        : null;
      if (nextRecipientView?.url) {
        await writeVendorAgreementAudit(agreement, 'SIGNING_STEP_CONTINUED', {
          source: 'APP_RETURN',
          message: 'Next required agreement signer view issued',
        });
      }

      return res.data(
        {
          marketplaceVendorAgreement: agreement,
          signing_url: nextRecipientView?.url || null,
          signing_incomplete: Boolean(nextRecipientView?.url),
        },
        'Vendor agreement return recorded'
      );
    } catch (error) {
      agreement.error_message = error.message;
      await agreement.save();
      await writeVendorAgreementAudit(agreement, 'RETRY_SCHEDULED', {
        source: 'APP_RETURN',
        message: 'DocuSign status lookup will be retried',
      });
      await sendDeveloperAlert('DocuSign vendor return error', error, {
        agreement_id: agreement.agreement_id,
        vendor_user_id: req.user._id,
      });
      throw buildError(
        'DocuSign status is temporarily unavailable. Please try again.',
        503
      );
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
    const marketplaceBidListWithFiles = await attachFilesToBids(
      await attachEventsToBids(bids, {
        fullAccess: false,
        redactRecord: false,
      }),
      { fullAccess: false, redactRecord: false }
    );
    const activeFinalPayments = await MarketplacePaymentService.getByData(
      {
        bid_id: { $in: bids.map((bid) => bid.bid_id) },
        payment_type: 'FINAL_EVENT_PAYMENT',
        payment_status: { $in: ['PENDING', 'PROCESSING', 'PAID', 'FAILED'] },
      },
      { sort: { created_at: -1 }, lean: true }
    );
    const paymentByBidId = activeFinalPayments.reduce((payments, payment) => {
      if (!payments[payment.bid_id]) payments[payment.bid_id] = payment;
      return payments;
    }, {});
    const marketplaceBidList = marketplaceBidListWithFiles.map((bid) => {
      const payment = paymentByBidId[bid.bid_id] || null;
      const marketplaceEvent = bid.marketplaceEvent || {};
      const eventForCloseState = {
        ...marketplaceEvent,
        final_payment_id: payment?.payment_id || null,
        final_payment_status: payment?.payment_status || 'NOT_REQUIRED',
      };
      return {
        ...bid,
        final_payment_id: payment?.payment_id || null,
        final_payment_status: payment?.payment_status || 'NOT_REQUIRED',
        vendor_event_close: buildVendorEventCloseState(eventForCloseState),
      };
    });

    return res.data({ marketplaceBidList }, 'Awarded marketplace bids');
  } catch (e) {
    return next(e);
  }
};

exports.awardBids = async (req, res, next) => {
  try {
    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    await reconcilePartiallyAwardedFoodEvent(event);
    assertEventOpenForSubmissionDecision(event);
    const batch = await loadAwardBatchSelections(event, req.body);
    const {
      selectedBidIds,
      selectedFoodApplicationIds,
      selectedEventVendorApplicationIds,
      selectedBids,
      selectedFoodApplications,
      selectedEventVendorApplications,
    } = batch;
    const awardSelections = resolveAwardSelections(
      event,
      selectedBids,
      req.body.award_selections || []
    );
    const baseAmount = roundMoney(
      selectedBids.reduce(
        (total, bid) => total + Number(bid.full_bid_amount || 0),
        0
      ) || event.budgeted_amount
    );
    const feeAmount = selectedBids.length
      ? getCoordinatorAwardFeeAmount(baseAmount)
      : 0;

    if (feeAmount > 0) {
      let marketplacePayment = await findActiveMarketplacePayment({
        event_id: event.event_id,
        payer_user_id: req.user._id,
        payment_type: 'COORDINATOR_AWARD_FEE',
        payment_status: { $in: ['PENDING', 'PROCESSING', 'FAILED'] },
      });

      if (!marketplacePayment) {
        marketplacePayment = await MarketplacePaymentService.create({
          event_id: event.event_id,
          selected_bid_ids: selectedBidIds,
          selected_food_application_ids: selectedFoodApplicationIds,
          selected_event_vendor_application_ids: selectedEventVendorApplicationIds,
          award_selections: awardSelections,
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
        marketplacePayment.selected_food_application_ids = selectedFoodApplicationIds;
        marketplacePayment.selected_event_vendor_application_ids =
          selectedEventVendorApplicationIds;
        marketplacePayment.award_selections = awardSelections;
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
            awarded_food_application_ids: selectedFoodApplicationIds,
            awarded_event_vendor_application_ids: selectedEventVendorApplicationIds,
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

    const finalized = await finalizeFoodVendorAwardBatch({
      event,
      selectedBids,
      selectedFoodApplications,
      selectedEventVendorApplications,
      awardSelections,
    });
    return res.data(
      finalized,
      'Marketplace bids awarded'
    );
  } catch (e) {
    return next(e);
  }
};

exports.acceptApplication = async (req, res, next) => {
  try {
    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    await reconcilePartiallyAwardedFoodEvent(event);
    assertEventOpenForSubmissionDecision(event);
    const application = await MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        application_id: req.params.applicationId,
        application_status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
        archived_at: null,
      },
      { singleResult: true }
    );
    if (!application) {
      throw buildError('This vendor application is no longer available.', 404);
    }

    const awardCapacity = await getFoodVendorAwardState(event);
    if (
      !awardCapacity.awardedVendorIds.has(String(application.vendor_user_id)) &&
      awardCapacity.remaining < 1
    ) {
      throw buildError('All available vendor GA slots have already been filled.', 409);
    }

    const vendorFeeRequired = roundMoney(event.vendor_fee || 0) > 0;
    if (vendorFeeRequired && !event.vendor_fee_payment_deadline) {
      throw buildError(
        'Set the Last Date to Accept Payments on the event before accepting vendors.',
        409
      );
    }
    application.application_status = vendorFeeRequired ? 'PAYMENT_DUE' : 'CONFIRMED';
    application.payment_status = vendorFeeRequired ? 'PENDING' : 'NOT_REQUIRED';
    application.payment_due_at = vendorFeeRequired
      ? event.vendor_fee_payment_deadline || null
      : null;
    await application.save();

    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: application.vendor_user_id,
      title: vendorFeeRequired ? 'Vendor application accepted — payment due' : 'Vendor application accepted',
      body: vendorFeeRequired
        ? `Your application for ${event.event_name || 'the event'} was accepted. Pay the vendor fee by ${new Date(application.payment_due_at).toLocaleDateString('en-US')}.`
        : `Your application for ${event.event_name || 'the event'} was accepted.`,
      data: {
        notificationType: 'MARKETPLACE_APPLICATION_ACCEPTED',
        eventId: event.event_id,
        applicationId: application.application_id,
      },
      channels: ['push', 'email'],
      metadata: { eventId: event.event_id, applicationId: application.application_id },
    });

    const coordinator = await UserService.getById(event.customer_user_id);
    if (coordinator?.email) {
      try {
        await MailHelper.sendMail(
          coordinator.email,
          `RTC Marketplace application awarded - ${event.event_name || event.event_id}`,
          `
            <p>Your Food Vendor application selection has been recorded.</p>
            <p><strong>Event:</strong> ${event.event_name || event.event_id}</p>
            <p><strong>Application:</strong> ${application.application_id}</p>
          `
        );
      } catch (mailError) {
        console.error('Food Vendor application coordinator award email failed', {
          eventId: event.event_id,
          applicationId: application.application_id,
          message: mailError.message,
        });
      }
    }

    const updatedCapacity = await getFoodVendorAwardState(event);
    if (updatedCapacity.remaining === 0) {
      if (await areMarketplaceVendorAwardNeedsFilled(event)) {
        event.status = 'AWARDED';
        await event.save();
        await notifyCoordinatorOfMatchLocked(event);
      }
    }

    return res.data(
      { marketplaceApplication: application },
      vendorFeeRequired ? 'Vendor application accepted; payment is due' : 'Vendor application accepted'
    );
  } catch (e) {
    return next(e);
  }
};

const refundPaidVendorFeePaymentForRevocation = async ({ payment, actorUserId }) =>
  refundPaidMarketplaceVendorFee({
    payment,
    actorUserId,
    processRefund: PaymentHelper.processRefund.bind(PaymentHelper),
    claimRefund: ({ paymentId, actorUserId: actorId }) =>
      MarketplacePaymentService.getModel().findOneAndUpdate(
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
            refund_status: 'PROCESSING',
            refund_started_at: new Date(),
            refund_failure_reason: null,
            refund_processed_by_user_id: actorId,
          },
        },
        { new: true, runValidators: true }
      ),
    completeRefund: ({ paymentId, actorUserId: actorId, refundTransactionId, refundMode }) =>
      MarketplacePaymentService.getModel().findOneAndUpdate(
        { payment_id: paymentId, payment_status: 'PAID', refund_status: 'PROCESSING', refund_processed_by_user_id: actorId },
        {
          $set: {
            payment_status: 'REFUNDED',
            refund_status: 'REFUNDED',
            refund_transaction_id: refundTransactionId,
            refund_mode: refundMode,
            refunded_at: new Date(),
            refund_failure_reason: null,
          },
        },
        { new: true, runValidators: true }
      ),
    failRefund: ({ paymentId, actorUserId: actorId, message }) =>
      MarketplacePaymentService.getModel().findOneAndUpdate(
        { payment_id: paymentId, payment_status: 'PAID', refund_status: 'PROCESSING', refund_processed_by_user_id: actorId },
        { $set: { refund_status: 'FAILED', refund_failure_reason: message } },
        { new: true, runValidators: true }
      ),
  });

const cancelPendingVendorFeePaymentForRevocation = async ({ payment, event, actorUserId }) => {
  if (payment?.payment_status === 'PAID') {
    return (await refundPaidVendorFeePaymentForRevocation({ payment, actorUserId })).payment;
  }
  if (payment?.payment_status !== 'PENDING') return payment;
  const cancelledPayment = await MarketplacePaymentService.update(
    { payment_id: payment.payment_id, payment_status: 'PENDING' },
    { payment_status: 'CANCELLED', superseded_at: new Date() },
    { getNew: true }
  );
  if (cancelledPayment) return cancelledPayment;

  const currentPayment = await MarketplacePaymentService.getByData(
    { payment_id: payment.payment_id },
    { singleResult: true }
  );
  if (currentPayment?.payment_status === 'PAID') {
    return (await refundPaidVendorFeePaymentForRevocation({
      payment: currentPayment,
      actorUserId,
    })).payment;
  }
  const decision = getMarketplaceAwardRevocationDecision({
    event,
    vendorPaymentStatus: currentPayment?.payment_status || 'PROCESSING',
  });
  throw buildError(getMarketplaceAwardRevocationError(decision), 409);
};

exports.revokeAward = async (req, res, next) => {
  try {
    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    const bid = await MarketplaceBidService.getByData(
      {
        event_id: event.event_id,
        bid_id: req.params.bidId,
        bid_status: 'AWARDED',
        archived_at: null,
      },
      { singleResult: true }
    );
    if (!bid) throw buildError('Awarded vendor not found.', 404);

    const linkedApplication = bid.linked_application_id
      ? await MarketplaceApplicationService.getByData(
          { application_id: bid.linked_application_id },
          { singleResult: true }
        )
      : null;
    const linkedVendorPayment = linkedApplication
      ? await MarketplacePaymentService.getByData(
          {
            application_id: linkedApplication.application_id,
            payment_type: 'VENDOR_EVENT_FEE',
            payment_status: { $in: ['PENDING', 'PROCESSING', 'PAID'] },
          },
          { singleResult: true }
        )
      : null;
    const initialRevocationDecision = getMarketplaceAwardRevocationDecision({
      event,
      vendorPaymentStatus: linkedVendorPayment?.payment_status === 'PROCESSING'
        ? 'PROCESSING'
        : null,
    });
    if (!initialRevocationDecision.canRevoke) {
      throw buildError(getMarketplaceAwardRevocationError(initialRevocationDecision), 409);
    }
    const resolvedVendorPayment = await cancelPendingVendorFeePaymentForRevocation({
      payment: linkedVendorPayment,
      event,
      actorUserId: req.user._id,
    });
    const revocationDecision = getMarketplaceAwardRevocationDecision({
      event,
      vendorPaymentStatus:
        resolvedVendorPayment?.payment_status ||
        linkedApplication?.payment_status ||
        (linkedApplication?.application_status === 'PAID' ? 'PAID' : null),
    });
    if (!revocationDecision.canRevoke) {
      throw buildError(getMarketplaceAwardRevocationError(revocationDecision), 409);
    }

    if (linkedApplication) {
      linkedApplication.application_status = 'NOT_SELECTED';
      linkedApplication.award_revoked_at = new Date();
      linkedApplication.payment_status = 'CANCELLED';
      linkedApplication.archived_at = new Date();
      linkedApplication.archived_reason = req.body?.reason || 'Award revoked by coordinator';
      await linkedApplication.save();
    }
    bid.bid_status = 'NOT_AWARDED';
    bid.award_revoked_at = new Date();
    bid.awarded_coverage = null;
    bid.linked_application_id = null;
    bid.combined_vendor_fee_waived = false;
    bid.payment_status = 'NOT_REQUIRED';
    await bid.save();

    await MarketplaceBidService.getModel().updateMany(
      {
        event_id: event.event_id,
        bid_id: { $ne: bid.bid_id },
        bid_status: 'NOT_AWARDED',
        archived_at: null,
      },
      { $set: { bid_status: 'UNDER_REVIEW' } }
    );
    if (event.award_payment_id) {
      await MarketplacePaymentService.update(
        { payment_id: event.award_payment_id },
        { superseded_at: new Date() },
        { getNew: false }
      );
    }
    event.status = 'REOPENED';
    event.award_payment_id = null;
    event.award_payment_status = 'NOT_REQUIRED';
    await event.save();

    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: bid.vendor_user_id,
      title: 'Marketplace award revoked',
      body: `${event.event_name || 'Your event'} award was revoked by the coordinator.${req.body?.reason ? ` Reason: ${req.body.reason}` : ''}`,
      data: {
        notificationType: 'MARKETPLACE_AWARD_REVOKED',
        eventId: event.event_id,
        bidId: bid.bid_id,
      },
      channels: ['push', 'email'],
      metadata: { eventId: event.event_id, bidId: bid.bid_id },
    });

    return res.data(
      { marketplaceEvent: event, marketplaceBid: bid },
      'Award revoked; remaining proposals are available for selection'
    );
  } catch (e) {
    return next(e);
  }
};

exports.revokeApplicationAward = async (req, res, next) => {
  try {
    const event = await getOwnedEvent(req.params.eventId, req.user._id);
    const application = await MarketplaceApplicationService.getByData(
      {
        event_id: event.event_id,
        application_id: req.params.applicationId,
        application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
        archived_at: null,
      },
      { singleResult: true }
    );
    if (!application) throw buildError('Awarded vendor application not found.', 404);
    if (!['PAID', 'CONFIRMED'].includes(application.application_status)) {
      throw buildError(
        'This application is selected and awaiting payment. It is not yet a completed award and cannot be revoked.',
        409
      );
    }

    const vendorPayment = await MarketplacePaymentService.getByData(
      {
        application_id: application.application_id,
        payment_type: 'VENDOR_EVENT_FEE',
        payment_status: { $in: ['PENDING', 'PROCESSING', 'PAID'] },
      },
      { singleResult: true }
    );
    const initialRevocationDecision = getMarketplaceAwardRevocationDecision({
      event,
      vendorPaymentStatus: vendorPayment?.payment_status === 'PROCESSING'
        ? 'PROCESSING'
        : null,
    });
    if (!initialRevocationDecision.canRevoke) {
      throw buildError(getMarketplaceAwardRevocationError(initialRevocationDecision), 409);
    }
    const resolvedVendorPayment = await cancelPendingVendorFeePaymentForRevocation({
      payment: vendorPayment,
      event,
      actorUserId: req.user._id,
    });
    const revocationDecision = getMarketplaceAwardRevocationDecision({
      event,
      vendorPaymentStatus:
        resolvedVendorPayment?.payment_status ||
        application.payment_status ||
        (application.application_status === 'PAID' ? 'PAID' : null),
    });
    if (!revocationDecision.canRevoke) {
      throw buildError(getMarketplaceAwardRevocationError(revocationDecision), 409);
    }

    application.application_status = 'NOT_SELECTED';
    application.award_revoked_at = new Date();
    application.payment_status = 'CANCELLED';
    application.payment_due_at = null;
    application.archived_at = new Date();
    application.archived_reason = req.body?.reason || 'Award revoked by coordinator';
    await application.save();

    await MarketplaceCommunications.sendMarketplaceCommunication({
      userId: application.vendor_user_id,
      title: 'Marketplace award revoked',
      body: `${event.event_name || 'Your event'} award was revoked by the coordinator.${req.body?.reason ? ` Reason: ${req.body.reason}` : ''}`,
      data: {
        notificationType: 'MARKETPLACE_AWARD_REVOKED',
        eventId: event.event_id,
        applicationId: application.application_id,
      },
      channels: ['push', 'email'],
      metadata: { eventId: event.event_id, applicationId: application.application_id },
    });

    return res.data(
      { marketplaceEvent: event, marketplaceApplication: application },
      'Application award revoked; the vendor slot is available'
    );
  } catch (e) {
    return next(e);
  }
};

exports.adminAwardBids = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can award marketplace bids', 403);
    }

    const event = await MarketplaceEventService.getByData(
      { event_id: req.params.eventId },
      { singleResult: true }
    );
    if (!event) {
      throw buildError('Marketplace event not found', 404);
    }
    await reconcilePartiallyAwardedFoodEvent(event);
    if (['AWARDED', 'CANCELLED'].includes(event.status)) {
      throw buildError('Awarded or cancelled events cannot be awarded again.', 400);
    }

    const selectedBidIds = req.body.bid_ids || [];
    if (!selectedBidIds.length) {
      throw buildError('At least one bid is required to award vendors', 400);
    }

    const selectedBids = await MarketplaceBidService.getByData({
      event_id: req.params.eventId,
      bid_id: { $in: selectedBidIds },
      bid_status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      archived_at: null,
    });

    if (selectedBids.length !== selectedBidIds.length) {
      throw buildError('One or more selected bids are invalid', 400);
    }
    await assertFoodVendorAwardBatchCapacity(event, selectedBids);
    const awardSelections = resolveAwardSelections(
      event,
      selectedBids,
      req.body.award_selections || []
    );
    const coordinatorUserId = event.customer_user_id;
    const baseAmount = roundMoney(
      selectedBids.reduce(
        (total, bid) => total + Number(bid.full_bid_amount || 0),
        0
      ) || event.budgeted_amount
    );
    const feeAmount = getCoordinatorAwardFeeAmount(baseAmount);

    if (feeAmount > 0) {
      let marketplacePayment = await findActiveMarketplacePayment({
        event_id: event.event_id,
        payer_user_id: coordinatorUserId,
        payment_type: 'COORDINATOR_AWARD_FEE',
        payment_status: { $in: ['PENDING', 'PROCESSING', 'FAILED'] },
      });

      if (!marketplacePayment) {
        marketplacePayment = await MarketplacePaymentService.create({
          event_id: event.event_id,
          selected_bid_ids: selectedBidIds,
          award_selections: awardSelections,
          payer_user_id: coordinatorUserId,
          payer_type: 'CUSTOMER',
          payment_type: 'COORDINATOR_AWARD_FEE',
          base_amount: baseAmount,
          fee_rate: COORDINATOR_AWARD_FEE_RATE,
          fee_amount: feeAmount,
          total_amount: feeAmount,
          payment_status: 'PENDING',
          manually_marked_paid: false,
        });
        await createPaymentAudit(
          marketplacePayment,
          req,
          'CREATE',
          'Admin created coordinator award fee while awarding marketplace event'
        );
      } else if (marketplacePayment.payment_status === 'PENDING') {
        marketplacePayment.selected_bid_ids = selectedBidIds;
        marketplacePayment.award_selections = awardSelections;
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

    const finalized = await finalizeFoodVendorAwardBatch({
      event,
      selectedBids,
      awardSelections,
    });
    return res.data(
      finalized,
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

exports.adminMarketplaceEvents = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can view marketplace events', 403);
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    const query = {};
    const search = String(req.query.search || '').trim();

    if (req.query.status) {
      query.status = req.query.status;
    }
    if (search) {
      query.$or = [
        { event_id: { $regex: search, $options: 'i' } },
        { event_name: { $regex: search, $options: 'i' } },
        { event_description: { $regex: search, $options: 'i' } },
        { event_city: { $regex: search, $options: 'i' } },
        { event_state: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const [events, total] = await Promise.all([
      MarketplaceEventService.getModel()
        .find(query)
        .populate('customer_user_id', 'firstName lastName email mobileNumber countryCode')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MarketplaceEventService.getModel().countDocuments(query),
    ]);

    const eventIds = events.map((event) => event.event_id).filter(Boolean);
    const [eventsWithImages, bids, applications] = await Promise.all([
      MarketplaceEventService.attachImages(events),
      eventIds.length
        ? MarketplaceBidService.getModel()
            .find({ event_id: { $in: eventIds }, archived_at: null })
            .populate('vendor_user_id', 'firstName lastName email')
            .populate('food_truck_id', 'name logo')
            .sort({ created_at: -1 })
            .lean()
        : [],
      eventIds.length
        ? MarketplaceApplicationService.getModel()
            .find({ event_id: { $in: eventIds }, archived_at: null })
            .populate('vendor_user_id', 'firstName lastName email')
            .populate('food_truck_id', 'name logo')
            .sort({ created_at: -1 })
            .lean()
        : [],
    ]);

    const bidsByEventId = bids.reduce((acc, bid) => {
      acc[bid.event_id] = acc[bid.event_id] || [];
      acc[bid.event_id].push(bid);
      return acc;
    }, {});
    const applicationsByEventId = applications.reduce((acc, application) => {
      acc[application.event_id] = acc[application.event_id] || [];
      acc[application.event_id].push(application);
      return acc;
    }, {});

    const marketplaceEventList = eventsWithImages.map((event) => ({
      ...event,
      bids: bidsByEventId[event.event_id] || [],
      applications: applicationsByEventId[event.event_id] || [],
      bid_count: (bidsByEventId[event.event_id] || []).length,
      application_count: (applicationsByEventId[event.event_id] || []).length,
    }));

    return res.data(
      {
        marketplaceEventList,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      'Marketplace events'
    );
  } catch (e) {
    return next(e);
  }
};

exports.adminUpdateEvent = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can update marketplace events', 403);
    }

    if (!Object.keys(req.body || {}).length) {
      throw buildError('No marketplace event updates provided', 400);
    }

    const event = await MarketplaceEventService.getByData(
      { event_id: req.params.eventId },
      { singleResult: true }
    );
    if (!event) {
      throw buildError('Marketplace event not found', 404);
    }

    const updatePayload = preserveSavedMarketplaceLocationFields(
      {
        ...toPlainObject(event),
        ...req.body,
        status: req.body.status || event.status,
      },
      event
    );
    const normalizedEvent = normalizeMarketplaceEventPayload(updatePayload, {
      existingEvent: event,
    });

    const marketplaceEvent = await MarketplaceEventService.update(
      { event_id: req.params.eventId },
      normalizedEvent,
      { getNew: true }
    );

    return res.data({ marketplaceEvent }, 'Marketplace event updated');
  } catch (e) {
    return next(e);
  }
};

exports.adminWithdrawSubmission = async (req, res, next) => {
  try {
    if (req.user.userType !== 'SUPER_ADMIN') {
      throw buildError('Only admins can withdraw marketplace submissions', 403);
    }

    const submissionType = String(req.body.submission_type || '').toUpperCase();
    const submissionId = String(req.body.submission_id || '').trim();
    const reason = String(req.body.reason || '').trim();

    if (!['BID', 'APPLICATION'].includes(submissionType) || !submissionId) {
      throw buildError('Select a valid bid or application to withdraw.', 400);
    }

    const now = new Date();
    if (submissionType === 'BID') {
      const bid = await MarketplaceBidService.getByData(
        {
          event_id: req.params.eventId,
          bid_id: submissionId,
          archived_at: null,
        },
        { singleResult: true }
      );
      if (!bid) {
        throw buildError('Marketplace bid not found', 404);
      }
      if (['AWARDED', 'WITHDRAWN'].includes(bid.bid_status)) {
        throw buildError('This bid can no longer be withdrawn.', 400);
      }
      bid.bid_status = 'WITHDRAWN';
      bid.withdrawn_at = now;
      bid.withdrawn_by_user_id = req.user._id;
      bid.revision_requested_fields = [
        ...(bid.revision_requested_fields || []),
        reason ? `Admin withdrawal: ${reason}` : 'Admin withdrawal',
      ];
      await bid.save();
      return res.data({ marketplaceBid: bid }, 'Marketplace bid withdrawn');
    }

    const application = await MarketplaceApplicationService.getByData(
      {
        event_id: req.params.eventId,
        application_id: submissionId,
        archived_at: null,
      },
      { singleResult: true }
    );
    if (!application) {
      throw buildError('Marketplace application not found', 404);
    }
    if (
      ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED', 'WITHDRAWN'].includes(
        application.application_status
      )
    ) {
      throw buildError('This application can no longer be withdrawn.', 400);
    }
    application.application_status = 'WITHDRAWN';
    application.withdrawn_at = now;
    application.withdrawn_by_user_id = req.user._id;
    application.revision_requested_fields = [
      ...(application.revision_requested_fields || []),
      reason ? `Admin withdrawal: ${reason}` : 'Admin withdrawal',
    ];
    await application.save();
    return res.data(
      { marketplaceApplication: application },
      'Marketplace application withdrawn'
    );
  } catch (e) {
    return next(e);
  }
};

exports.createFinalEventPayment = async (req, res, next) => {
  try {
    const isCoordinator = req.user.userType === 'CUSTOMER';
    const isVendor = req.user.userType === 'VENDOR';
    if (!isCoordinator && !isVendor) {
      throw buildError('Only event coordinators or awarded vendors can close events for payment', 403);
    }

    const event = isCoordinator
      ? await getOwnedEvent(req.params.eventId, req.user._id)
      : await MarketplaceEventService.getByData(
          { event_id: req.params.eventId },
          { singleResult: true }
        );
    if (!event) throw buildError('Marketplace event not found', 404);
    if (!['AWARDED', 'CLOSED'].includes(event.status)) {
      throw buildError('Final event payment is only available for awarded events.', 400);
    }
    if (isCoordinator) {
      const timing = getMarketplaceEventTiming(event);
      if (!timing) {
        throw buildError('A valid event date, time, duration, and timezone are required.', 409);
      }
      if (Date.now() < timing.end_at.getTime()) {
        throw buildError('The event cannot be closed for payment before it ends.', 409);
      }
    }

    const bidId = String(req.body.bid_id || '').trim();
    const applicationId = String(req.body.application_id || '').trim();
    if (applicationId) {
      throw buildError('Merchandise and service vendors do not receive final event payouts.', 400);
    }
    if (!bidId) {
      throw buildError('Select an awarded food-vendor bid for final payment.', 400);
    }
    if (isVendor) {
      await getVendorMarketplaceFoodTruck(req.user._id, { enforceCompliance: false });
      if (!bidId || applicationId) {
        throw buildError('Vendor event close is only available for an awarded food-vendor bid.', 403);
      }
      const ownedAwardedBid = await MarketplaceBidService.getByData(
        {
          event_id: event.event_id,
          bid_id: bidId,
          vendor_user_id: req.user._id,
          bid_status: 'AWARDED',
          archived_at: null,
        },
        { singleResult: true, lean: true }
      );
      if (!ownedAwardedBid) {
        throw buildError('Only the awarded vendor can close this event for payment.', 403);
      }
      const existingVendorPayment = await findActiveMarketplacePayment({
        event_id: event.event_id,
        bid_id: bidId,
        payment_type: 'FINAL_EVENT_PAYMENT',
      });
      const closeState = buildVendorEventCloseState({
        ...toPlainObject(event),
        final_payment_id: existingVendorPayment?.payment_id || null,
        final_payment_status: existingVendorPayment?.payment_status || 'NOT_REQUIRED',
      });
      if (!existingVendorPayment && !closeState.can_close) {
        const error = buildError(
          closeState.status === 'WAITING_FOR_COORDINATOR'
            ? 'The coordinator still has time to close this event for payment.'
            : 'This event is not available for vendor close.',
          409
        );
        error.vendor_event_close = closeState;
        throw error;
      }
    }

    const awardedBid = bidId
      ? await MarketplaceBidService.getByData(
          {
            event_id: event.event_id,
            bid_id: bidId,
            bid_status: 'AWARDED',
            archived_at: null,
          },
          { singleResult: true, lean: true }
        )
      : null;
    const awardedApplication = applicationId
      ? await MarketplaceApplicationService.getByData(
          {
            event_id: event.event_id,
            application_id: applicationId,
            application_status: { $in: ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'] },
            archived_at: null,
          },
          { singleResult: true, lean: true }
        )
      : null;

    if (!awardedBid && !awardedApplication) {
      throw buildError('Selected awarded vendor is not available for final payment.', 400);
    }

    const awardedAmount = awardedBid
      ? roundMoney(awardedBid.full_bid_amount || 0)
      : roundMoney(event.budgeted_amount || 0);
    if (awardedAmount <= 0) {
      throw buildError('Award amount is required before closing event for payment.', 400);
    }

    const requestedTipAmount = roundMoney(req.body.tip_amount || 0);
    const {
      baseAmount,
      tipAmount,
      totalAmount,
      coordinatorPayoutAmount,
    } = getFinalEventPaymentAmounts(awardedAmount, requestedTipAmount);
    const foodTruckId = awardedBid?.food_truck_id || awardedApplication?.food_truck_id || null;

    let marketplacePayment = await findActiveMarketplacePayment({
      event_id: event.event_id,
      payer_user_id: event.customer_user_id,
      payment_type: 'FINAL_EVENT_PAYMENT',
      ...(awardedBid ? { bid_id: awardedBid.bid_id } : {}),
      ...(awardedApplication ? { application_id: awardedApplication.application_id } : {}),
    });

    if (!marketplacePayment) {
      try {
        marketplacePayment = await MarketplacePaymentService.create({
          event_id: event.event_id,
          bid_id: awardedBid?.bid_id || null,
          application_id: awardedApplication?.application_id || null,
          selected_bid_ids: awardedBid ? [awardedBid.bid_id] : [],
          payer_user_id: event.customer_user_id,
          payer_type: 'CUSTOMER',
          food_truck_id: foodTruckId,
          payment_type: 'FINAL_EVENT_PAYMENT',
          base_amount: baseAmount,
          fee_rate: null,
          fee_amount: 0,
          tip_amount: tipAmount,
          total_amount: totalAmount,
          coordinator_payout_amount: coordinatorPayoutAmount,
          payment_status: 'PENDING',
        });
        await createPaymentAudit(marketplacePayment, req, 'CREATE');
      } catch (createError) {
        if (createError?.code !== 11000) throw createError;
        marketplacePayment = await findActiveMarketplacePayment({
          event_id: event.event_id,
          payment_type: 'FINAL_EVENT_PAYMENT',
          ...(awardedBid ? { bid_id: awardedBid.bid_id } : {}),
          ...(awardedApplication ? { application_id: awardedApplication.application_id } : {}),
        });
        if (!marketplacePayment) throw createError;
      }
    } else if (marketplacePayment.payment_status === 'PENDING') {
      marketplacePayment.bid_id = awardedBid?.bid_id || null;
      marketplacePayment.application_id = awardedApplication?.application_id || null;
      marketplacePayment.selected_bid_ids = awardedBid ? [awardedBid.bid_id] : [];
      marketplacePayment.food_truck_id = foodTruckId;
      marketplacePayment.base_amount = baseAmount;
      marketplacePayment.fee_amount = 0;
      marketplacePayment.tip_amount = tipAmount;
      marketplacePayment.total_amount = totalAmount;
      marketplacePayment.coordinator_payout_amount = coordinatorPayoutAmount;
      await marketplacePayment.save();
    }

    event.final_payment_id = marketplacePayment.payment_id;
    event.final_payment_food_truck_id = foodTruckId;
    event.final_payment_status = await getFinalEventPaymentAggregateStatus(event.event_id);
    await event.save();

    return res.data(
      {
        marketplaceEvent: event,
        marketplacePayment,
        requires_payment: marketplacePayment.payment_status !== 'PAID',
      },
      'Final event payment created'
    );
  } catch (e) {
    return next(e);
  }
};

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

exports.updateFinalPaymentTip = async (req, res, next) => {
  try {
    const payment = await getPaymentForUser(req.params.paymentId, req.user);
    if (
      !['VENDOR', 'CUSTOMER'].includes(req.user.userType) ||
      payment.payment_type !== 'FINAL_EVENT_PAYMENT'
    ) {
      throw buildError('Only the event coordinator or awarded vendor can update the final event tip.', 403);
    }

    const tipAmount = roundMoney(req.body.tip_amount || 0);
    const totalAmount = roundMoney(payment.base_amount + tipAmount);
    const updatedPayment = await MarketplacePaymentService.getModel().findOneAndUpdate(
      {
        payment_id: payment.payment_id,
        payment_status: { $in: ['PENDING', 'FAILED'] },
      },
      {
        $set: {
          tip_amount: tipAmount,
          total_amount: totalAmount,
          coordinator_payout_amount: totalAmount,
          payment_method: null,
        },
      },
      { new: true, runValidators: true }
    );
    if (!updatedPayment) {
      throw buildError('The tip is locked because payment processing has started.', 409);
    }

    await createPaymentAudit(
      updatedPayment,
      req,
      'TIP_UPDATED',
      `Tip set to $${tipAmount.toFixed(2)}`
    );
    return res.data({ marketplacePayment: updatedPayment }, 'Final event tip updated');
  } catch (e) {
    return next(e);
  }
};

exports.checkoutPayment = async (req, res, next) => {
  try {
    const authorizedPayment = await getPaymentForUser(req.params.paymentId, req.user);
    const paymentMethod = req.body.payment_method;
    const isFinalEventPayment = authorizedPayment.payment_type === 'FINAL_EVENT_PAYMENT';

    if (!isMarketplacePaymentMethodAllowed({
      paymentType: authorizedPayment.payment_type,
      userType: req.user.userType,
      paymentMethod,
    })) {
      if (isFinalEventPayment && req.user.userType === 'CUSTOMER') {
        throw buildError('Event coordinators can only use Apple Pay or Google Pay.', 403);
      }
      if (isFinalEventPayment && req.user.userType === 'VENDOR') {
        throw buildError('Awarded vendors can only collect Cash or Tap to Pay.', 403);
      }
      throw buildError('This marketplace payment requires Apple Pay or Google Pay.', 400);
    }

    if (isFinalEventPayment && req.user.userType === 'VENDOR') {
      const vendorFoodTruck = await getVendorMarketplaceFoodTruck(req.user._id, {
        enforceCompliance: false,
      });
      if (paymentMethod === 'CASH' && !canUseCashPOS(vendorFoodTruck)) {
        throw buildError('Cash collection is not available for this vendor plan.', 403);
      }
      if (paymentMethod === 'TAP_TO_PAY' && !canUseTapToPay(vendorFoodTruck)) {
        throw buildError('Tap to Pay is not available for this vendor plan.', 403);
      }
    }
    if (roundMoney(req.body.expected_total) !== roundMoney(authorizedPayment.total_amount)) {
      throw buildError('The payment amount changed. Refresh before completing payment.', 409);
    }
    if (authorizedPayment.payment_status === 'PAID') {
      const routingResult = await safelyFinalizePaidMarketplacePayment(authorizedPayment);
      return res.data(
        { marketplacePayment: authorizedPayment, routingResult },
        'Marketplace payment already confirmed'
      );
    }
    if (!['PENDING', 'FAILED'].includes(authorizedPayment.payment_status)) {
      throw buildError('Payment is already processing and cannot be started again.', 409);
    }

    let marketplacePayment = await MarketplacePaymentService.getModel().findOneAndUpdate(
      {
        payment_id: authorizedPayment.payment_id,
        payment_status: { $in: ['PENDING', 'FAILED'] },
      },
      {
        $set: {
          payment_method: paymentMethod,
          payment_status: 'PROCESSING',
          processing_started_at: new Date(),
          processing_by_user_id: req.user._id,
        },
      },
      { new: true, runValidators: true }
    );
    if (!marketplacePayment) {
      const currentPayment = await MarketplacePaymentService.getByData(
        { payment_id: authorizedPayment.payment_id },
        { singleResult: true }
      );
      if (currentPayment?.payment_status === 'PAID') {
        const routingResult = await safelyFinalizePaidMarketplacePayment(currentPayment);
        return res.data(
          { marketplacePayment: currentPayment, routingResult },
          'Marketplace payment already confirmed'
        );
      }
      throw buildError('Payment is already processing on another device.', 409);
    }
    await createPaymentAudit(marketplacePayment, req, 'CHECKOUT_STARTED', paymentMethod);

    if (paymentMethod === 'CASH') {
      marketplacePayment = await MarketplacePaymentService.getModel().findOneAndUpdate(
        {
          payment_id: marketplacePayment.payment_id,
          payment_status: 'PROCESSING',
          processing_by_user_id: req.user._id,
        },
        { $set: { payment_status: 'PAID', paid_at: new Date() } },
        { new: true, runValidators: true }
      );
      if (!marketplacePayment) {
        throw buildError('Cash payment could not be confirmed.', 409);
      }
      await createPaymentAudit(marketplacePayment, req, 'CHECKOUT_PAID', 'CASH');
      const routingResult = await finalizePaidMarketplacePayment(marketplacePayment);
      return res.data(
        { marketplacePayment, routingResult },
        'Marketplace cash payment confirmed'
      );
    }

    const processedTapToPay =
      paymentMethod === 'TAP_TO_PAY' &&
      req.body.payment_data?.type === 'PROCESSED_TRANSACTION' &&
      req.body.payment_data?.transactionId;
    if (processedTapToPay) {
      const transactionId = String(req.body.payment_data.transactionId);
      const reusedTransaction = await MarketplacePaymentService.getByData(
        {
          processor_transaction_id: transactionId,
          payment_id: { $ne: marketplacePayment.payment_id },
          payment_status: 'PAID',
        },
        { singleResult: true, lean: true }
      );
      if (reusedTransaction) {
        await MarketplacePaymentService.getModel().updateOne(
          { payment_id: marketplacePayment.payment_id, payment_status: 'PROCESSING' },
          { $set: { payment_status: 'FAILED' } }
        );
        throw buildError('This Tap to Pay transaction has already been used.', 409);
      }
      try {
        await CyberSourcePaymentHelper.verifyTransaction({
          transactionId,
          expectedAmount: marketplacePayment.total_amount,
          expectedCurrency: 'USD',
          expectedReference: marketplacePayment.payment_id,
        });
      } catch (verificationError) {
        await MarketplacePaymentService.getModel().updateOne(
          { payment_id: marketplacePayment.payment_id, payment_status: 'PROCESSING' },
          { $set: { payment_status: 'FAILED' } }
        );
        throw buildError('Tap to Pay could not be verified with the payment processor.', 502);
      }
      marketplacePayment = await MarketplacePaymentService.getModel().findOneAndUpdate(
        {
          payment_id: marketplacePayment.payment_id,
          payment_status: 'PROCESSING',
          processing_by_user_id: req.user._id,
        },
        {
          $set: {
            payment_status: 'PAID',
            processor_transaction_id: transactionId,
            paid_at: new Date(),
          },
        },
        { new: true, runValidators: true }
      );
      if (!marketplacePayment) {
        throw buildError('Tap to Pay result could not be confirmed.', 409);
      }
      await createPaymentAudit(
        marketplacePayment,
        req,
        'CHECKOUT_PAID',
        'TAP_TO_PAY processed by native reader'
      );
      const routingResult = await finalizePaidMarketplacePayment(marketplacePayment);
      return res.data(
        { marketplacePayment, routingResult },
        'Marketplace Tap to Pay payment confirmed'
      );
    }

    const opaquePaymentData = normalizeOpaquePaymentData(req.body.payment_data);
    const opaqueToken =
      paymentMethod === 'APPLE_PAY'
        ? Buffer.from(JSON.stringify(req.body.payment_data)).toString('base64')
        : Buffer.from(
            typeof req.body.payment_data === 'string'
              ? req.body.payment_data
              : JSON.stringify(req.body.payment_data)
          ).toString('base64');

    if (!opaqueToken) {
      await MarketplacePaymentService.getModel().updateOne(
        { payment_id: marketplacePayment.payment_id, payment_status: 'PROCESSING' },
        { $set: { payment_status: 'FAILED' } }
      );
      throw buildError('Payment token missing', 400);
    }

    let chargeResp;
    try {
      chargeResp = await PaymentHelper.chargePaymentUnified({
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
    } catch (chargeError) {
      marketplacePayment = await MarketplacePaymentService.getModel().findOneAndUpdate(
        { payment_id: marketplacePayment.payment_id, payment_status: 'PROCESSING' },
        { $set: { payment_status: 'FAILED' } },
        { new: true }
      );
      if (marketplacePayment) {
        await createPaymentAudit(
          marketplacePayment,
          req,
          'CHECKOUT_FAILED',
          chargeError.message || 'Payment gateway error'
        );
      }
      throw chargeError;
    }

    if (!chargeResp.success) {
      marketplacePayment = await MarketplacePaymentService.getModel().findOneAndUpdate(
        { payment_id: marketplacePayment.payment_id, payment_status: 'PROCESSING' },
        { $set: { payment_status: 'FAILED' } },
        { new: true }
      );
      await createPaymentAudit(
        marketplacePayment,
        req,
        'CHECKOUT_FAILED',
        chargeResp.message || 'Wallet payment failed'
      );
      throw buildError(chargeResp.message || 'Payment failed', 400);
    }

    marketplacePayment = await MarketplacePaymentService.getModel().findOneAndUpdate(
      {
        payment_id: marketplacePayment.payment_id,
        payment_status: 'PROCESSING',
        processing_by_user_id: req.user._id,
      },
      {
        $set: {
          payment_status: 'PAID',
          processor_transaction_id:
            chargeResp.transactionId || chargeResp?.fullResponse?.transId || null,
          paid_at: new Date(),
        },
      },
      { new: true, runValidators: true }
    );
    if (!marketplacePayment) {
      throw buildError('Payment result could not be finalized.', 409);
    }
    await createPaymentAudit(marketplacePayment, req, 'CHECKOUT_PAID', paymentMethod);

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

    if (['PROCESSING', 'CANCELLED', 'REFUNDED'].includes(marketplacePayment.payment_status)) {
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

    const moderationResult = await assertMarketplaceEventImageHasNoContactInfo(
      req.file
    );

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
      status_reason:
        moderationResult?.moderation_status === 'BLOCKED'
          ? moderationResult.moderation_reason
          : null,
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
      status_reason:
        moderationResult?.moderation_status === 'BLOCKED'
          ? moderationResult.moderation_reason
          : null,
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
	    await assertMarketplaceSubmissionEditable(bid.event_id);
	    const normalizedAttachment = normalizeMarketplaceAttachmentRequest(
	      req.body.attachment_type,
	      req.body.requirement_label
	    );
	    const attachmentType = normalizedAttachment.attachmentType;
    const config = validateAttachmentFile(req.file, attachmentType);
    const requirementLabel = normalizedAttachment.requirementLabel;
    const requirementKey = getRequirementKey(requirementLabel);
    if (attachmentType === REQUIREMENT_ATTACHMENT_TYPE) {
      assertMarketplaceRequirementAllowed(requirementLabel);
    }

    if (attachmentType === 'BID_IMAGE') {
      await assertMarketplaceEventImageHasNoContactInfo(req.file);
    }

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

    await syncMarketplaceAttachmentToVendorDocuments({
      foodTruckId: bid.food_truck_id,
      attachment: marketplaceAttachment,
      uploadedByUserId: req.user._id,
    });

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
	    await assertMarketplaceSubmissionEditable(application.event_id);
	    const normalizedAttachment = normalizeMarketplaceAttachmentRequest(
	      req.body.attachment_type,
	      req.body.requirement_label
	    );
	    const attachmentType = normalizedAttachment.attachmentType;
    const config = validateAttachmentFile(req.file, attachmentType);
    const requirementLabel = normalizedAttachment.requirementLabel;
    const requirementKey = getRequirementKey(requirementLabel);
    if (attachmentType === REQUIREMENT_ATTACHMENT_TYPE) {
      assertMarketplaceRequirementAllowed(requirementLabel);
    }

    if (attachmentType === 'APPLICATION_IMAGE') {
      await assertMarketplaceEventImageHasNoContactInfo(req.file);
    }

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

    await syncMarketplaceAttachmentToVendorDocuments({
      foodTruckId: application.food_truck_id,
      attachment: marketplaceAttachment,
      uploadedByUserId: req.user._id,
    });

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
    if (
      application.payment_due_at &&
      new Date(application.payment_due_at) < new Date()
    ) {
      await notifyMissedVendorFeePayments();
      throw buildError(
        `The vendor payment deadline has passed. Contact the coordinator or RTC support at ${MARKETPLACE_PHONE_NUMBER}.`,
        410
      );
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
    if (application.source_bid_id) {
      await MarketplaceBidService.update(
        { bid_id: application.source_bid_id },
        { payment_id: marketplacePayment.payment_id, payment_status: 'PENDING' },
        { getNew: false }
      );
    }

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
	    await assertMarketplaceSubmissionEditable(bid.event_id);
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
	    await assertMarketplaceSubmissionEditable(application.event_id);
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
