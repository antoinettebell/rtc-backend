const fs = require('fs');
const {
  FoodTruckService,
  MarketplaceAttachmentService,
  MarketplaceAgreementAuditService,
  MarketplaceBidService,
  MarketplaceEventImageService,
  MarketplaceEventService,
  MarketplaceFileAuditService,
  MarketplacePaymentAuditService,
  MarketplacePaymentService,
  UserService,
} = require('../services');
const {
  canAccessEventMarketplace,
} = require('../../helper/vendor-plan-helper');
const { addObjectWithKey, removeObject } = require('../../helper/aws');
const PaymentHelper = require('../../helper/payment-helper');
const DocuSignHelper = require('../../helper/docusign-helper');

const buildError = (message, code = 400) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const MARKETPLACE_PHONE_NUMBER = '800-410-7053';
const COORDINATOR_AWARD_FEE_RATE = 0.035;

const roundMoney = (value) => Number((Number(value || 0)).toFixed(2));

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
  if (body.primary_service_style === 'Food Truck') {
    return Math.max(1, Math.ceil(Number(body.number_of_guests || 0) / 75));
  }

  return Math.max(1, Number(body.number_of_vendors_needed || 1));
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
    await getOwnedEvent(attachment.event_id, user._id);
    return attachment;
  }

  if (user.userType === 'VENDOR') {
    if (!attachment.bid_id) {
      throw buildError('Marketplace repository file not found', 404);
    }
    await getOwnedBid(attachment.bid_id, user._id);
    return attachment;
  }

  throw buildError('You do not have access to this marketplace file', 403);
};

const decorateRepositoryFiles = async (attachments = []) => {
  const eventIds = [
    ...new Set(attachments.map((item) => item.event_id).filter(Boolean)),
  ];
  const bidIds = [...new Set(attachments.map((item) => item.bid_id).filter(Boolean))];

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

  return attachments.map((attachment) => {
    const event = eventById[attachment.event_id] || null;
    const bid = attachment.bid_id ? bidById[attachment.bid_id] || null : null;
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
      vendor_user_id: bid?.vendor_user_id || null,
      food_truck_id: bid?.food_truck_id || null,
    };
  });
};

const getVendorMarketplaceFoodTruck = async (userId) => {
  const foodTruck = await FoodTruckService.getByData(
    { userId },
    { singleResult: true, populate: ['addOns', 'planId'] }
  );

  if (!foodTruck) {
    throw buildError('Food truck not found', 404);
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
    !customer.eventCoordinatorEin
  ) {
    throw buildError(
      'Event coordination profile with company EIN is required to access My Events.',
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

    if (event.status === 'OPEN') {
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

const attachEventsToBids = async (bids = []) => {
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

  return bids.map((bid) => ({
    ...bid,
    marketplaceEvent: eventById[bid.event_id] || null,
  }));
};

const attachFilesToBids = async (bids = []) => {
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
    attachments: attachmentsByBidId[bid.bid_id] || [],
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
  if (payment.payment_type !== 'VENDOR_EVENT_FEE' || !payment.bid_id) {
    return null;
  }

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

    const marketplaceEvent = await MarketplaceEventService.create({
      ...normalizeMarketplaceEventLocation(req.body),
      number_of_vendors_needed: normalizeMarketplaceVendorCount(req.body),
      customer_user_id: req.user._id,
      status: req.body.status || 'DRAFT',
    });

    return res.data({ marketplaceEvent }, 'Marketplace event created');
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

    return res.data({ marketplaceEvent }, 'Marketplace event');
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

    const marketplaceEventList = await MarketplaceEventService.getByData(
      { status: 'OPEN' },
      {
        paging: {
          limit: Number(req.query.limit || 20),
          page: Number(req.query.page || 1),
        },
        sort: { event_close_date: 1, created_at: -1 },
        lean: true,
      }
    );

    const total = await MarketplaceEventService.getCount({ status: 'OPEN' });

    return res.data(
      {
        marketplaceEventList,
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
      { event_id: req.params.eventId, status: 'OPEN' },
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

exports.getEventBids = async (req, res, next) => {
  try {
    await getOwnedEvent(req.params.eventId, req.user._id);

    const bids = await MarketplaceBidService.getByData(
      { event_id: req.params.eventId, bid_status: { $ne: 'DRAFT' } },
      {
        sort: { submitted_at: -1, created_at: -1 },
        populate: [
          { path: 'vendor_user_id', select: 'firstName lastName email' },
          { path: 'food_truck_id', select: 'name logo cuisine' },
        ],
        lean: true,
      }
    );
    const marketplaceBidList = await attachFilesToBids(bids);

    return res.data({ marketplaceBidList }, 'Marketplace event bids');
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
    const event = await MarketplaceEventService.getByData(
      { event_id: req.params.eventId, status: 'OPEN' },
      { singleResult: true }
    );

    if (!event) {
      throw buildError('Open marketplace event not found', 404);
    }

    if (req.body.nda_required && !req.body.nda_acknowledged) {
      throw buildError('NDA acknowledgment is required for this bid', 400);
    }

    if (event.alcohol_required && !req.body.liquor_license_confirmed) {
      throw buildError(
        'Liquor license confirmation is required for this event',
        400
      );
    }

    const existingBid = await MarketplaceBidService.getByData(
      {
        event_id: req.params.eventId,
        vendor_user_id: req.user._id,
        bid_status: { $nin: ['WITHDRAWN'] },
      },
      { singleResult: true }
    );

    if (existingBid) {
      throw buildError('A bid has already been submitted for this event', 409);
    }

    const ndaAcknowledgedAt = req.body.nda_acknowledged ? new Date() : null;
    const vendorFee = roundMoney(event.vendor_fee || 0);
    const requiresPayment = vendorFee > 0;
    const marketplaceBid = await MarketplaceBidService.create({
      ...req.body,
      event_id: req.params.eventId,
      vendor_user_id: req.user._id,
      food_truck_id: foodTruck._id,
      nda_acknowledged_at: ndaAcknowledgedAt,
      agreement_status: req.body.nda_acknowledged
        ? 'ACKNOWLEDGED'
        : 'NOT_REQUIRED',
      bid_status: requiresPayment ? 'DRAFT' : req.body.bid_status || 'SUBMITTED',
      payment_status: requiresPayment ? 'PENDING' : 'NOT_REQUIRED',
      submitted_at: requiresPayment ? null : new Date(),
    });

    let marketplacePayment = null;
    if (requiresPayment) {
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

    return res.data(
      {
        marketplaceBid,
        marketplacePayment,
        requires_payment: requiresPayment,
        rtc_phone_number: MARKETPLACE_PHONE_NUMBER,
      },
      requiresPayment
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
      await attachEventsToBids(bids)
    );

    return res.data({ marketplaceBidList }, 'Marketplace bids');
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
      await attachEventsToBids(bids)
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

    const marketplaceEvent = await MarketplaceEventService.update(
      { event_id: req.params.eventId },
      { status: req.body.status },
      { getNew: true }
    );

    if (!marketplaceEvent) {
      throw buildError('Marketplace event not found', 404);
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

    if (attachmentType === 'PERMIT_LICENSE') {
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

    if (attachment.attachment_type === 'PERMIT_LICENSE') {
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

exports.repositoryFiles = async (req, res, next) => {
  try {
    if (req.user.userType === 'EMPLOYEE') {
      throw buildError('Employees cannot access marketplace repository files', 403);
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    const query = {};

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
      query.$or = [
        { original_name: { $regex: req.query.search.trim(), $options: 'i' } },
        { event_id: { $regex: req.query.search.trim(), $options: 'i' } },
        { bid_id: { $regex: req.query.search.trim(), $options: 'i' } },
        { file_key: { $regex: req.query.search.trim(), $options: 'i' } },
      ];
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
      const bids = await MarketplaceBidService.getByData(
        { vendor_user_id: req.user._id },
        { lean: true }
      );
      const bidIds = bids.map((bid) => bid.bid_id);
      if (!bidIds.length) {
        return res.data(
          { marketplaceRepositoryFileList: [], total: 0, page, totalPages: 1 },
          'Marketplace repository files'
        );
      }
      query.bid_id = query.bid_id
        ? { $in: bidIds.filter((bidId) => bidId === query.bid_id) }
        : { $in: bidIds };
    }

    const [attachments, total] = await Promise.all([
      MarketplaceAttachmentService.getByData(query, {
        paging: { page, limit },
        sort: { created_at: -1 },
        lean: true,
      }),
      MarketplaceAttachmentService.getCount(query),
    ]);
    const marketplaceRepositoryFileList =
      await decorateRepositoryFiles(attachments);

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

        if (attachment.attachment_type === 'PERMIT_LICENSE') {
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
