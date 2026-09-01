const {
  MarketplaceEventModel,
  MarketplaceTicketOrderModel,
  MarketplaceTicketModel,
  MarketplaceScannerSessionModel,
  MarketplaceAttachmentModel,
  MarketplaceEventImageModel,
  UserModel,
} = require('../../models');
const TicketService = require('../services/marketplace-ticket-service');
const PaymentHelper = require('../../helper/payment-helper');
const TaxHelper = require('../../helper/tax-helper');
const {
  calculateTicketAmounts,
  getAdmissionsTaxCode,
  getEntityUseCode,
  cancellationDeadline,
  assertInventoryAvailable,
  encodeWalletPaymentToken,
} = require('../../helper/event-ticket-helper');
const {
  hashTicketToken,
  createTicketToken,
  buildPublicTicketUrl,
} = require('../../helper/ticket-token-helper');
const { server } = require('../../config');
const fs = require('fs');
const { addObjectWithKey, removeObject } = require('../../helper/aws');
const EncryptionService = require('../../helper/encryption');
const {
  renderTicketPage,
  renderScannerPage,
} = require('../../helper/public-ticket-page');
const SmsHelper = require('../../helper/sms-helper');
const MailHelper = require('../../helper/mail-helper');
const {
  buildTicketQrDataUrl,
  buildTicketQrEmailAttachment,
} = require('../../helper/ticket-qr-helper');
const { isScannerAvailable } = require('../../helper/event-ticket-helper');
const {
  isPublicMarketplaceEventEligible,
  isPublicTicketPurchaseAvailable,
  sanitizePublicMarketplaceEvent,
} = require('../../helper/public-marketplace-event-helper');

const money = (value) => Number(Number(value || 0).toFixed(2));
const buildError = (message, code = 400) => Object.assign(new Error(message), { code });
const buildAndroidTicketStoreURL = (playStoreURL, shareToken) => {
  try {
    const url = new URL(playStoreURL);
    // The share token is already the public invitation capability. Keep it out
    // of logs and use the Play referrer only to restore this destination after
    // a first Android install.
    url.searchParams.set('referrer', `rtc_ticket_share=${shareToken}`);
    return url.toString();
  } catch (_) {
    return playStoreURL;
  }
};
const buildTicketEmail = ({ recipientName = 'there', paragraphs = '', details = '' }) => `
  <p>Hi ${recipientName},</p>
  ${paragraphs}
  ${details}
  <p>For help, contact Round Da’ Corner Support at 800-410-7053.</p>
  <p>Best Regards,<br>Round Da' Corner Support Team</p>
`;

const addressFromEvent = (event) => ({
  line1: event.event_address,
  city: event.event_city,
  region: event.event_state,
  postalCode: event.event_zip,
  country: 'US',
  latitude: event.latitude,
  longitude: event.longitude,
});

const availableTicketInventoryQuery = {
  $or: [
    { $expr: { $gt: [
      { $subtract: [
        { $ifNull: ['$ga_ticket_quantity', 0] },
        { $add: [
          { $ifNull: ['$ga_tickets_sold', 0] },
          { $ifNull: ['$ga_tickets_reserved', 0] },
        ] },
      ] },
      0,
    ] } },
    {
      vip_section_enabled: true,
      $expr: { $gt: [
        { $subtract: [
          { $ifNull: ['$vip_ticket_quantity', 0] },
          { $add: [
            { $ifNull: ['$vip_tickets_sold', 0] },
            { $ifNull: ['$vip_tickets_reserved', 0] },
          ] },
        ] },
        0,
      ] },
    },
  ],
};

const getTicketInvitationEvent = (shareToken) => MarketplaceEventModel.findOne({
  ticket_sales_enabled: true,
  ticket_sales_closed_at: null,
  status: { $nin: ['DRAFT', 'CANCELLED'] },
  $and: [
    {
      $or: [
        { ticket_share_token_hash: hashTicketToken(shareToken) },
        { ticket_share_token_hashes: hashTicketToken(shareToken) },
      ],
    },
    availableTicketInventoryQuery,
  ],
});

const attachActiveEventImages = async (event) => {
  if (!event) return event;

  const images = await MarketplaceEventImageModel.find({
    event_id: event.event_id,
    status: 'ACTIVE',
  })
    .sort({ created_at: 1 })
    .lean();

  return { ...event, images };
};

const getPublicGuestTicketEvent = async (eventId) => {
  const event = await MarketplaceEventModel.findOne({
    event_id: eventId,
    event_visibility: 'PUBLIC',
    ticket_sales_enabled: true,
    ticket_sales_closed_at: null,
    status: { $in: ['OPEN', 'CLOSED'] },
  }).lean();
  return event &&
    isPublicMarketplaceEventEligible(event) &&
    isPublicTicketPurchaseAvailable(event)
    ? event
    : null;
};

const getGuestPurchaser = (purchaser = {}) => ({
  _id: null,
  firstName: purchaser.first_name,
  lastName: purchaser.last_name,
  email: purchaser.email,
  countryCode: '',
  mobileNumber: purchaser.phone,
});

const responseTicketsForOrder = async (order) => {
  const tickets = await MarketplaceTicketModel.find({ ticket_order_id: order.ticket_order_id })
    .select('+token_encrypted')
    .sort({ created_at: 1 })
    .lean();
  return tickets.map((ticket) => {
    const token = EncryptionService.decrypt(ticket.token_encrypted);
    const safeTicket = { ...ticket };
    delete safeTicket.token_encrypted;
    return { ...safeTicket, ticket_url: buildPublicTicketUrl(server.publicTicketBaseURL, token) };
  });
};

const buildTicketQuote = async ({ event, customerReference, gaQuantity, vipQuantity, billingAddress }) => {
  const gaAmounts = gaQuantity
    ? calculateTicketAmounts({ unitPrice: event.ga_ticket_price, quantity: gaQuantity })
    : null;
  const vipAmounts = vipQuantity
    ? calculateTicketAmounts({ unitPrice: event.vip_ticket_price, quantity: vipQuantity })
    : null;
  const ticketSubtotal = money((gaAmounts?.ticketSubtotal || 0) + (vipAmounts?.ticketSubtotal || 0));
  const customerProcessingFee = money((gaAmounts?.customerProcessingFee || 0) + (vipAmounts?.customerProcessingFee || 0));
  const coordinatorProcessingFee = money((gaAmounts?.coordinatorProcessingFee || 0) + (vipAmounts?.coordinatorProcessingFee || 0));
  const safeCustomerReference = String(customerReference || 'GUEST').replace(/[^a-zA-Z0-9]/g, '');
  const transactionCode = `RTC-TICKET-${Date.now()}-${safeCustomerReference.slice(-6) || 'GUEST'}`;
  const exemptionApproved = event.tax_exemption_status === 'APPROVED' &&
    (!event.tax_exemption_expires_at || event.tax_exemption_expires_at > new Date());
  const entityUseCode = exemptionApproved
    ? event.tax_exemption_entity_use_code || getEntityUseCode({
        charitableEvent: event.charitable_event,
        religiousOrganization: event.religious_organization,
      })
    : null;
  const taxResult = await TaxHelper.calculateEventTicketTax({
    shipFrom: addressFromEvent(event),
    shipTo: billingAddress,
    ticketAmount: ticketSubtotal,
    serviceFee: customerProcessingFee,
    admissionsTaxCode: getAdmissionsTaxCode(event.event_type),
    customerCode: String(customerReference || 'GUEST'),
    merchantSellerIdentifier: String(event.customer_user_id),
    entityUseCode,
    transactionCode,
  });
  if (!taxResult.success) throw buildError(taxResult.message || 'Tax calculation failed', 502);
  const salesTax = money(taxResult.totalTax);
  return {
    ticketSubtotal,
    customerProcessingFee,
    coordinatorProcessingFee,
    salesTax,
    totalAmount: money(ticketSubtotal + customerProcessingFee + salesTax),
    // Sales tax is paid by the purchaser on top of the ticket subtotal, and
    // coordinator payout fees are settled outside this application.
    netCoordinatorPayout: ticketSubtotal,
    entityUseCode,
    transactionCode,
  };
};

exports.quote = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({
      event_id: req.params.eventId,
      ticket_sales_enabled: true,
      status: { $nin: ['DRAFT', 'CANCELLED'] },
      ticket_sales_closed_at: null,
      ...(req.publicGuestCheckout ? {
        event_visibility: 'PUBLIC',
        tax_exemption_status: { $in: ['NOT_REQUESTED', 'APPROVED'] },
      } : {}),
    }).lean();
    if (!event) throw buildError('Ticket sales are unavailable', 404);
    const gaQuantity = Number(req.body.ga_quantity || 0);
    const vipQuantity = Number(req.body.vip_quantity || 0);
    if (gaQuantity) {
      assertInventoryAvailable({
        capacity: event.ga_ticket_quantity,
        sold: event.ga_tickets_sold,
        reserved: event.ga_tickets_reserved,
        requested: gaQuantity,
      });
    }
    if (vipQuantity) {
      assertInventoryAvailable({
        capacity: event.vip_ticket_quantity,
        sold: event.vip_tickets_sold,
        reserved: event.vip_tickets_reserved,
        requested: vipQuantity,
      });
    }
    const quote = await buildTicketQuote({
      event,
      customerReference: req.user._id || req.user.email,
      gaQuantity,
      vipQuantity,
      billingAddress: req.body.billing_address,
    });
    return res.data({ quote }, 'Ticket quote calculated');
  } catch (error) {
    return next(error);
  }
};

exports.guestQuote = async (req, res, next) => {
  try {
    const event = await getTicketInvitationEvent(req.params.shareToken).select('event_id').lean();
    if (!event) throw buildError('Ticket invitation is unavailable', 404);
    req.params.eventId = event.event_id;
    req.user = getGuestPurchaser(req.body.purchaser);
    return exports.quote(req, res, next);
  } catch (error) {
    return next(error);
  }
};

exports.publicGuestQuote = async (req, res, next) => {
  try {
    const event = await getPublicGuestTicketEvent(req.params.eventId);
    if (!event) throw buildError('Ticket sales are unavailable', 404);
    req.user = getGuestPurchaser(req.body.purchaser);
    req.publicGuestCheckout = true;
    return exports.quote(req, res, next);
  } catch (error) {
    return next(error);
  }
};

exports.checkout = async (req, res, next) => {
  let order = null;
  let inventoryReserved = false;
  try {
    const priorOrder = await MarketplaceTicketOrderModel.findOne({
      customer_user_id: req.user._id,
      idempotency_key: req.body.idempotency_key,
    });
    if (priorOrder) {
      if (priorOrder.status === 'PAID') {
        return res.data(
          { ticketOrder: priorOrder, tickets: await responseTicketsForOrder(priorOrder) },
          'Ticket purchase already confirmed'
        );
      }
      throw buildError('This ticket purchase is already being processed. Check My Tickets before retrying.', 409);
    }
    const gaQuantity = Number(req.body.ga_quantity || 0);
    const vipQuantity = Number(req.body.vip_quantity || 0);
    const event = await TicketService.reserveEventInventory({
      eventId: req.params.eventId,
      gaQuantity,
      vipQuantity,
    });
    inventoryReserved = true;
    if (req.publicGuestCheckout && !isPublicMarketplaceEventEligible(event)) {
      throw buildError('Ticket sales are unavailable', 404);
    }

    const quote = await buildTicketQuote({
      event,
      customerReference: req.user._id || req.user.email,
      gaQuantity,
      vipQuantity,
      billingAddress: req.body.billing_address,
    });
    const {
      ticketSubtotal,
      customerProcessingFee,
      coordinatorProcessingFee,
      salesTax,
      totalAmount,
      netCoordinatorPayout,
      entityUseCode,
      transactionCode,
    } = quote;
    const opaqueToken = encodeWalletPaymentToken(req.body.payment_data);

    order = await MarketplaceTicketOrderModel.create({
      event_id: event.event_id,
      customer_user_id: req.user._id,
      idempotency_key: req.body.idempotency_key,
      purchaser_name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Customer',
      purchaser_email: req.user.email,
      purchaser_phone: `${req.user.countryCode || ''}${req.user.mobileNumber || ''}`,
      ga_quantity: gaQuantity,
      vip_quantity: vipQuantity,
      ticket_subtotal: ticketSubtotal,
      customer_processing_fee: customerProcessingFee,
      coordinator_processing_fee: coordinatorProcessingFee,
      sales_tax: salesTax,
      total_amount: totalAmount,
      net_coordinator_payout: netCoordinatorPayout,
      avalara_transaction_code: transactionCode,
      avalara_entity_use_code: entityUseCode,
      payment_method: req.body.payment_method,
      reservation_expires_at: TicketService.reservationExpiry(),
      status: 'PAYMENT_PROCESSING',
    });

    const charge = await PaymentHelper.chargePaymentUnified({
      opaqueToken,
      amount: totalAmount,
      paymentMethod: req.body.payment_method,
      firstName: req.user.firstName || 'Ticket',
      lastName: req.user.lastName || 'Customer',
      email: req.user.email,
      subTotal: money(ticketSubtotal + customerProcessingFee),
      taxAmount: salesTax,
      userId: req.user._id || order.ticket_order_id,
    });
    if (!charge.success) {
      order.status = 'PAYMENT_FAILED';
      order.failure_reason = charge.message || 'Payment failed';
      await order.save();
      await TicketService.releaseReservation(order);
      inventoryReserved = false;
      throw buildError(order.failure_reason);
    }

    order.gateway_transaction_id =
      charge.transactionId || charge?.fullResponse?.transId || null;
    order.status = 'PAID';
    order.paid_at = new Date();
    await order.save();
    await TicketService.confirmReservation(order);
    inventoryReserved = false;
    const avalaraCommit = await TaxHelper.commitAvalaraTransaction(transactionCode);
    if (!avalaraCommit.success) {
      console.error('Ticket Avalara commit requires reconciliation', {
        ticketOrderId: order.ticket_order_id,
        transactionCode,
        message: avalaraCommit.message,
      });
    }
    const tickets = await TicketService.createTicketsForPaidOrder(order);

    const ticketLinks = tickets
      .map(({ ticket, url }) => `${ticket.attendee_label} (${ticket.ticket_type}): ${url}`)
      .join('\n');
    const emailTickets = await Promise.all(
      tickets.map(async ({ ticket, url }) => ({
        ticket,
        url,
        qr: await buildTicketQrEmailAttachment({
          ticketId: ticket.ticket_id,
          ticketUrl: url,
        }),
      }))
    );
    const [smsDelivery, emailDelivery] = await Promise.allSettled([
      SmsHelper.sendSms({
        to: order.purchaser_phone,
        body: `RTC tickets for ${event.event_name}:\n${ticketLinks}`,
        metadata: { ticketOrderId: order.ticket_order_id },
      }),
      MailHelper.sendMail(
        order.purchaser_email,
        `Your Tickets for ${event.event_name}`,
        buildTicketEmail({
          recipientName: order.purchaser_name || 'Ticket Buyer',
          paragraphs: `<p>Thank you for your purchase. Your tickets for ${event.event_name} are ready.</p><p>Open your secure ticket link below to view each attendee’s ticket, ticket type, and QR code.</p>`,
          details: `${emailTickets
          .map(
            ({ ticket, url, qr }) =>
              `<p><strong>${ticket.attendee_label} (${ticket.ticket_type})</strong><br><img src="cid:${qr.contentId}" width="240" height="240" alt="Ticket QR code"><br><a href="${url}">Open secure ticket</a></p>`
          )
          .join('')}`,
        }),
        { attachments: emailTickets.map(({ qr }) => qr.attachment) }
      ),
    ]);
    const smsResult = smsDelivery.status === 'fulfilled' ? smsDelivery.value : null;
    const emailResult = emailDelivery.status === 'fulfilled' ? emailDelivery.value : null;
    order.ticket_sms_status = smsDelivery.status === 'rejected' || smsResult?.failed
      ? 'FAILED'
      : smsResult?.skipped ? 'SKIPPED' : 'SENT';
    order.ticket_email_status = emailDelivery.status === 'rejected' || emailResult?.failed
      ? 'FAILED'
      : 'SENT';
    order.ticket_sms_failure_reason = smsDelivery.reason?.message || smsResult?.reason || null;
    order.ticket_email_failure_reason = emailDelivery.reason?.message || emailResult?.reason || null;
    if (order.ticket_sms_status === 'SENT' && order.ticket_email_status === 'SENT') {
      order.ticket_delivery_sent_at = new Date();
    }
    await order.save();

    return res.data(
      {
        ticketOrder: order,
        tickets: tickets.map(({ ticket, url }) => ({ ...ticket, ticket_url: url })),
      },
      'Ticket purchase confirmed'
    );
  } catch (error) {
    if (inventoryReserved) {
      await TicketService.releaseReservation(
        order || {
          event_id: req.params.eventId,
          ga_quantity: Number(req.body.ga_quantity || 0),
          vip_quantity: Number(req.body.vip_quantity || 0),
        }
      );
    }
    if (error?.code === 11000 && req.body.idempotency_key) {
      const priorOrder = await MarketplaceTicketOrderModel.findOne({
        customer_user_id: req.user._id,
        idempotency_key: req.body.idempotency_key,
      });
      if (priorOrder?.status === 'PAID') {
        return res.data(
          { ticketOrder: priorOrder, tickets: await responseTicketsForOrder(priorOrder) },
          'Ticket purchase already confirmed'
        );
      }
      return next(buildError('This ticket purchase is already being processed. Check My Tickets before retrying.', 409));
    }
    return next(error);
  }
};

exports.guestCheckout = async (req, res, next) => {
  try {
    const event = await getTicketInvitationEvent(req.params.shareToken).select('event_id').lean();
    if (!event) throw buildError('Ticket invitation is unavailable', 404);
    req.params.eventId = event.event_id;
    req.user = getGuestPurchaser(req.body.purchaser);
    return exports.checkout(req, res, next);
  } catch (error) {
    return next(error);
  }
};

exports.publicGuestCheckout = async (req, res, next) => {
  try {
    const event = await getPublicGuestTicketEvent(req.params.eventId);
    if (!event) throw buildError('Ticket sales are unavailable', 404);
    req.user = getGuestPurchaser(req.body.purchaser);
    req.publicGuestCheckout = true;
    return exports.checkout(req, res, next);
  } catch (error) {
    return next(error);
  }
};

exports.myTickets = async (req, res, next) => {
  try {
    const orders = await MarketplaceTicketOrderModel.find({
      customer_user_id: req.user._id,
      status: { $in: ['PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'] },
    })
      .sort({ created_at: -1 })
      .lean();
    const orderIds = orders.map((order) => order.ticket_order_id);
    const eventIds = [...new Set(orders.map((order) => order.event_id))];
    const [tickets, events] = await Promise.all([
      MarketplaceTicketModel.find({ ticket_order_id: { $in: orderIds } })
        .select('+token_encrypted')
        .sort({ created_at: 1 })
        .lean(),
      MarketplaceEventModel.find({ event_id: { $in: eventIds } }).lean(),
    ]);
    const eventMap = Object.fromEntries(events.map((event) => [event.event_id, event]));
    const ticketsByOrder = tickets.reduce((result, ticket) => {
      const token = EncryptionService.decrypt(ticket.token_encrypted);
      const safeTicket = { ...ticket };
      delete safeTicket.token_encrypted;
      result[ticket.ticket_order_id] = result[ticket.ticket_order_id] || [];
      result[ticket.ticket_order_id].push({
        ...safeTicket,
        ticket_url: buildPublicTicketUrl(server.publicTicketBaseURL, token),
      });
      return result;
    }, {});
    return res.data(
      {
        ticketOrders: orders.map((order) => ({
          ...order,
          event: eventMap[order.event_id] || null,
          tickets: ticketsByOrder[order.ticket_order_id] || [],
        })),
      },
      'My tickets'
    );
  } catch (error) {
    return next(error);
  }
};

exports.uploadExemptionCertificate = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({
      event_id: req.params.eventId,
      customer_user_id: req.user._id,
    });
    if (!event) throw buildError('Event not found', 404);
    if (!event.charitable_event && !event.religious_organization) {
      throw buildError('This event did not request a tax exemption');
    }
    if (!req.file) throw buildError('State Sales Tax Exemption Certificate is required');
    const previousExemptionStatus = event.tax_exemption_status;
    const previousCertificates = await MarketplaceAttachmentModel.find({
      event_id: event.event_id,
      attachment_type: 'TAX_EXEMPTION_CERTIFICATE',
      status: 'ACTIVE',
    });
    const { url, key } = await addObjectWithKey(
      req.file,
      'marketplace/events/tax-exemption-certificates'
    );
    fs.unlink(req.file.path, () => {});
    const certificate = await MarketplaceAttachmentModel.create({
      event_id: event.event_id,
      attachment_type: 'TAX_EXEMPTION_CERTIFICATE',
      requirement_label: 'State Sales Tax Exemption Certificate',
      file_url: url,
      file_key: key,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      uploaded_by_user_id: req.user._id,
    });
    if (previousCertificates.length) {
      const previousIds = previousCertificates.map((item) => item._id);
      if (previousExemptionStatus === 'APPROVED') {
        await MarketplaceAttachmentModel.updateMany(
          { _id: { $in: previousIds } },
          { $set: { status: 'ARCHIVED', status_reason: 'Replaced by coordinator' } }
        );
      } else {
        await MarketplaceAttachmentModel.deleteMany({ _id: { $in: previousIds } });
        await Promise.all(
          previousCertificates
            .filter((item) => item.file_key)
            .map((item) => removeObject(item.file_key).catch(() => null))
        );
      }
    }
    event.tax_exemption_certificate_url = url;
    event.tax_exemption_status = 'PENDING';
    event.tax_exemption_entity_use_code = null;
    event.tax_exemption_reviewed_at = null;
    event.tax_exemption_reviewed_by_user_id = null;
    await event.save();
    return res.data({ certificate, marketplaceEvent: event }, 'Certificate submitted for admin review');
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(error);
  }
};

exports.adminListTaxExemptions = async (req, res, next) => {
  try {
    const query = {
      tax_exemption_status: req.query.status || 'PENDING',
      $or: [{ charitable_event: true }, { religious_organization: true }],
    };
    const events = await MarketplaceEventModel.find(query)
      .populate('customer_user_id', 'firstName lastName email eventCoordinatorCompanyName')
      .sort({ updated_at: -1 })
      .lean();
    const eventIds = events.map((event) => event.event_id);
    const certificates = await MarketplaceAttachmentModel.find({
      event_id: { $in: eventIds },
      attachment_type: 'TAX_EXEMPTION_CERTIFICATE',
      status: 'ACTIVE',
    })
      .sort({ created_at: -1 })
      .lean();
    const certificateMap = Object.fromEntries(
      certificates.map((certificate) => [certificate.event_id, certificate])
    );
    return res.data(
      {
        taxExemptionList: events.map((event) => ({
          ...event,
          certificate: certificateMap[event.event_id] || null,
        })),
      },
      'Event tax exemptions'
    );
  } catch (error) {
    return next(error);
  }
};

exports.adminReviewTaxExemption = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({
      event_id: req.params.eventId,
      $or: [{ charitable_event: true }, { religious_organization: true }],
    });
    if (!event) throw buildError('Tax-exemption request not found', 404);
    const certificate = await MarketplaceAttachmentModel.findOne({
      event_id: event.event_id,
      attachment_type: 'TAX_EXEMPTION_CERTIFICATE',
      status: 'ACTIVE',
    }).lean();
    if (!certificate) throw buildError('Tax-exemption certificate is missing', 409);

    const approved = req.body.status === 'APPROVED';
    const entityUseCode = approved
      ? getEntityUseCode({
          charitableEvent: event.charitable_event,
          religiousOrganization: event.religious_organization,
        })
      : null;
    event.tax_exemption_status = req.body.status;
    event.tax_exemption_entity_use_code = entityUseCode;
    event.tax_exemption_expires_at = approved ? req.body.expiration_date || null : null;
    event.tax_exemption_reviewed_at = new Date();
    event.tax_exemption_reviewed_by_user_id = req.user._id;
    await event.save();

    await UserModel.updateOne(
      { _id: event.customer_user_id },
      {
        $set: {
          eventCoordinatorEntityUseCode: entityUseCode,
          eventCoordinatorTaxExemptionStatus: req.body.status,
          eventCoordinatorTaxExemptionExpiresAt:
            approved ? req.body.expiration_date || null : null,
        },
      }
    );
    if (!approved) {
      const coordinator = await UserModel.findById(event.customer_user_id).select('email firstName').lean();
      if (coordinator?.email) {
        await MailHelper.sendMail(
          coordinator.email,
          `Tax-Exemption Document Needs Attention — ${event.event_name}`,
          buildTicketEmail({
            recipientName: coordinator.firstName || 'Event Coordinator',
            paragraphs: `<p>Your tax-exemption document for ${event.event_name} was not approved. Please open the app to review the notes and upload a corrected document.</p>`,
          })
        );
      }
    }
    return res.data({ marketplaceEvent: event }, `Tax exemption ${req.body.status.toLowerCase()}`);
  } catch (error) {
    return next(error);
  }
};

exports.validateTicket = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({
      event_id: req.params.eventId,
      customer_user_id: req.user._id,
    }).lean();
    if (!event) throw buildError('Event not found', 404);
    if (
      !isScannerAvailable({
        eventDate: event.event_date,
        eventTime: event.event_time,
        timeZone: event.event_timezone,
        closedAt: event.ticket_scanning_closed_at,
      })
    ) {
      throw buildError('Ticket scanning is not currently available', 403);
    }

    const tokenHash = hashTicketToken(req.body.ticket_token);
    const checkedInAt = new Date();
    const ticket = await MarketplaceTicketModel.findOneAndUpdate(
      { event_id: event.event_id, token_hash: tokenHash, status: 'ACTIVE' },
      {
        $set: {
          status: 'CHECKED_IN',
          checked_in_at: checkedInAt,
          checked_in_by_user_id: req.user._id,
          checked_in_session_id: req.body.scanner_session_id || null,
        },
      },
      { new: true }
    ).select('+token_hash');

    if (!ticket) {
      const existing = await MarketplaceTicketModel.findOne({ token_hash: tokenHash })
        .select('+token_hash')
        .lean();
      if (!existing) throw buildError('Invalid ticket', 404);
      if (existing.event_id !== event.event_id) throw buildError('Ticket belongs to another event', 409);
      throw buildError(
        existing.status === 'CHECKED_IN'
          ? `Ticket already checked in${
              existing.checked_in_at ? ` at ${existing.checked_in_at.toISOString()}` : ''
            }`
          : `Ticket is ${existing.status.toLowerCase().replaceAll('_', ' ')}`,
        409
      );
    }

    return res.data(
      {
        valid: true,
        attendeeName: ticket.attendee_label,
        ticketType: ticket.ticket_type,
        checkedInAt,
      },
      'Ticket checked in'
    );
  } catch (error) {
    return next(error);
  }
};

exports.cancelEventAndRefundTickets = async (req, res, next) => {
  try {
    let event = await MarketplaceEventModel.findOne({
      event_id: req.params.eventId,
      customer_user_id: req.user._id,
    });
    if (!event) throw buildError('Event not found', 404);

    if (event.status !== 'CANCELLED') {
      const deadline = cancellationDeadline(event);
      if (new Date() > deadline) {
        throw buildError('Events must be cancelled at least 72 hours before they begin', 409);
      }
      event.status = 'CANCELLED';
      event.cancelled_at = new Date();
      event.ticket_sales_closed_at = new Date();
      event.ticket_scanning_closed_at = new Date();
      await event.save();
      await MarketplaceTicketModel.updateMany(
        { event_id: event.event_id, status: { $in: ['ACTIVE', 'CHECKED_IN'] } },
        { $set: { status: 'EVENT_CANCELLED' } }
      );
    }

    const refundableOrders = await MarketplaceTicketOrderModel.find({
      event_id: event.event_id,
      status: { $in: ['PAID', 'REFUND_FAILED'] },
    });
    const results = [];
    for (const candidate of refundableOrders) {
      const order = await MarketplaceTicketOrderModel.findOneAndUpdate(
        { _id: candidate._id, status: candidate.status },
        { $set: { status: 'REFUND_PENDING', refund_failure_reason: null } },
        { new: true }
      );
      if (!order) continue;

      const refund = await PaymentHelper.processRefund({
        transactionId: order.gateway_transaction_id,
        amount: order.total_amount,
      });
      if (refund.success) {
        order.status = 'REFUNDED';
        order.refund_transaction_id = refund.refundTransactionId || null;
        order.refunded_at = new Date();
        await order.save();
        await TaxHelper.voidAvalaraTransaction(order.avalara_transaction_code);
        await Promise.allSettled([
          SmsHelper.sendSms({
            to: order.purchaser_phone,
            body: `RTC: ${event.event_name} was cancelled. Your ticket refund of $${money(
              order.total_amount
            ).toFixed(2)} has been issued.`,
            metadata: { ticketOrderId: order.ticket_order_id },
          }),
          MailHelper.sendMail(
            order.purchaser_email,
            `${event.event_name} Canceled — Refund Issued`,
            buildTicketEmail({
              recipientName: order.purchaser_name || 'Ticket Buyer',
              paragraphs: `<p>We’re sorry—${event.event_name} has been canceled. Your refund of <strong>$${money(order.total_amount).toFixed(2)}</strong> has been issued to your original payment method. Processing time may vary by your bank or card provider.</p>`,
            })
          ),
        ]);
        results.push({ ticket_order_id: order.ticket_order_id, status: 'REFUNDED' });
      } else {
        order.status = 'REFUND_FAILED';
        order.refund_failure_reason = refund.message || 'Refund failed';
        await order.save();
        await Promise.allSettled([
          SmsHelper.sendSms({
            to: order.purchaser_phone,
            body: `RTC: ${event.event_name} was cancelled. Your ticket refund is being reviewed and will be processed manually.`,
            metadata: { ticketOrderId: order.ticket_order_id },
          }),
          MailHelper.sendMail(
            order.purchaser_email,
            `${event.event_name} Canceled — Refund Processing`,
            buildTicketEmail({
              recipientName: order.purchaser_name || 'Ticket Buyer',
              paragraphs: `<p>We’re sorry—${event.event_name} has been canceled. Your refund is being reviewed and will be processed manually. We will update you when processing is complete.</p>`,
            })
          ),
        ]);
        results.push({
          ticket_order_id: order.ticket_order_id,
          status: 'REFUND_FAILED',
          reason: order.refund_failure_reason,
        });
      }
    }

    return res.data(
      {
        marketplaceEvent: event,
        refunds: results,
        refunded_count: results.filter((item) => item.status === 'REFUNDED').length,
        failed_count: results.filter((item) => item.status === 'REFUND_FAILED').length,
      },
      "Refunds are due immediately upon cancellation."
    );
  } catch (error) {
    return next(error);
  }
};

exports.closeScanner = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOneAndUpdate(
      {
        event_id: req.params.eventId,
        customer_user_id: req.user._id,
        ticket_scanning_closed_at: null,
      },
      { $set: { ticket_scanning_closed_at: new Date() } },
      { new: true }
    );
    if (!event) throw buildError('Event not found or scanner already closed', 404);
    return res.data({ marketplaceEvent: event }, 'Ticket scanning closed');
  } catch (error) {
    return next(error);
  }
};

exports.closeTicketSales = async (req, res, next) => {
  try {
    const now = new Date();
    const event = await MarketplaceEventModel.findOneAndUpdate(
      {
        event_id: req.params.eventId,
        customer_user_id: req.user._id,
        ticket_sales_enabled: true,
        ticket_sales_closed_at: null,
        status: { $ne: 'CANCELLED' },
      },
      { $set: { ticket_sales_closed_at: now } },
      { new: true }
    );
    if (!event) throw buildError('Event not found or ticket sales already closed', 404);
    return res.data({ marketplaceEvent: event }, 'Ticket sales closed; check-in remains available');
  } catch (error) {
    return next(error);
  }
};

exports.createTicketShareLink = async (req, res, next) => {
  try {
    const { token, tokenHash } = createTicketToken();
    const event = await MarketplaceEventModel.findOneAndUpdate(
      {
        event_id: req.params.eventId,
        customer_user_id: req.user._id,
        ticket_sales_enabled: true,
        ticket_sales_closed_at: null,
        status: { $nin: ['DRAFT', 'CANCELLED'] },
      },
      [{
        $set: {
          ticket_share_token_hash: tokenHash,
          ticket_share_token_hashes: {
            $setUnion: [
              { $ifNull: ['$ticket_share_token_hashes', []] },
              [tokenHash],
              {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$ticket_share_token_hash', null] },
                      { $ne: ['$ticket_share_token_hash', ''] },
                    ],
                  },
                  ['$ticket_share_token_hash'],
                  [],
                ],
              },
            ],
          },
        },
      }],
      { new: true }
    );
    if (!event) throw buildError('Ticket sales are unavailable', 404);
    return res.data(
      { share_url: `${server.publicTicketBaseURL}/events/${encodeURIComponent(token)}` },
      'Private ticket invitation created'
    );
  } catch (error) {
    return next(error);
  }
};

exports.coordinatorTicketSummary = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({
      event_id: req.params.eventId,
      customer_user_id: req.user._id,
    }).lean();
    if (!event) throw buildError('Event not found', 404);
    const [summary] = await MarketplaceTicketOrderModel.aggregate([
      { $match: { event_id: event.event_id, status: { $in: ['PAID', 'REFUND_PENDING', 'REFUND_FAILED'] } } },
      { $group: {
        _id: null,
        orders: { $sum: 1 },
        tickets: { $sum: { $add: ['$ga_quantity', '$vip_quantity'] } },
        gross_ticket_sales: { $sum: '$ticket_subtotal' },
        rtc_processing_fee: { $sum: '$coordinator_processing_fee' },
        collected_sales_tax: { $sum: '$sales_tax' },
        estimated_net_payout: { $sum: '$net_coordinator_payout' },
      } },
      { $set: {
        rtc_processing_fee: 0,
        estimated_net_payout: '$gross_ticket_sales',
      } },
    ]);
    return res.data({
      summary: summary || {
        orders: 0, tickets: 0, gross_ticket_sales: 0, rtc_processing_fee: 0,
        collected_sales_tax: 0, estimated_net_payout: 0,
      },
      payout_notice: "Round Da' Corner holds standard ticket funds until 3 business days after your event ends; please allow an additional 5 business days for bank deposits.",
    }, 'Coordinator ticket summary');
  } catch (error) {
    return next(error);
  }
};

exports.publicTicketInvitation = async (req, res, next) => {
  try {
    const event = await getTicketInvitationEvent(req.params.shareToken)
      .select('event_id event_name event_date event_city event_state')
      .lean();
    if (!event) {
      res.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });
      return res.status(404).type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tickets Unavailable</title><style>body{align-items:center;background:#0f172a;color:#172033;display:flex;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;justify-content:center;margin:0;min-height:100vh;padding:24px}.card{background:#fff;border-radius:22px;box-sizing:border-box;max-width:520px;padding:36px 28px;text-align:center;width:100%}h1{font-size:30px;line-height:1.2;margin:0 0 14px}p{color:#526176;font-size:19px;line-height:1.45;margin:0}</style></head><body><main class="card"><h1>Tickets are no longer available to purchase.</h1><p>Ticket sales for this event have ended.</p></main></body></html>`);
    }
    const invitationURL = `${server.publicTicketBaseURL}/events/${encodeURIComponent(req.params.shareToken)}`;
    const appInvitationURL = `rtc-customer://invite/${encodeURIComponent(req.params.shareToken)}`;
    const iosAppStoreURL = server.customerIosAppStoreURL;
    const androidPlayStoreURL = buildAndroidTicketStoreURL(
      server.customerAndroidPlayStoreURL,
      req.params.shareToken
    );
    res.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });
    return res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="apple-itunes-app" content="app-id=6748915125, app-argument=${invitationURL}"><title>RTC Event Invitation</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#fff;padding:28px}.card{max-width:480px;margin:auto;background:#fff;color:#172033;padding:28px;border-radius:22px}.status{color:#526176;line-height:1.45}.store{display:block;text-align:center;background:#ea580c;color:#fff;padding:16px;border-radius:14px;text-decoration:none;font-weight:800;margin-top:12px}.secondary{background:#172033}.hidden{display:none}</style></head><body><main class="card"><p>ROUND DA' CORNER</p><h1>${String(event.event_name).replace(/[<>&]/g, '')}</h1><p>${String(event.event_city || '')}, ${String(event.event_state || '')}</p><p id="status" class="status">Tickets are purchased in the Round Da' Corner customer app.</p><a id="open-app" class="store secondary" href="${appInvitationURL}">I already have the app — Open this event</a><a id="ios-store" class="store hidden" href="${iosAppStoreURL}">Download the app to continue</a><a id="android-store" class="store hidden" href="${androidPlayStoreURL}">Download the app to continue</a><div id="both-stores" class="hidden"><a class="store" href="${iosAppStoreURL}">Download on the App Store</a><a class="store secondary" href="${androidPlayStoreURL}">Get it on Google Play</a></div><noscript><p class="status">After installing, return to this page and tap Open this event to continue.</p><a class="store" href="${iosAppStoreURL}">Download on the App Store</a><a class="store secondary" href="${androidPlayStoreURL}">Get it on Google Play</a></noscript></main><script>(()=>{const ua=navigator.userAgent||'';const ios=/iPad|iPhone|iPod/.test(ua);const android=/Android/.test(ua);const status=document.getElementById('status');const openApp=document.getElementById('open-app');const installKey='rtc_ticket_install_pending_${encodeURIComponent(req.params.shareToken)}';const markInstallPending=()=>{try{window.localStorage.setItem(installKey,'1')}catch(_){}};const showContinuation=()=>{status.textContent='Installation complete? Tap Continue to Event to finish buying tickets.';openApp.textContent='Continue to Event'};let installLink;if(ios){installLink=document.getElementById('ios-store');installLink.classList.remove('hidden');status.textContent='Already installed? Open this event. New here? Download the app to continue.'}else if(android){installLink=document.getElementById('android-store');installLink.classList.remove('hidden');status.textContent='Already installed? Open this event. New here? Download the app to continue.'}else{document.getElementById('both-stores').classList.remove('hidden');status.textContent='Open this link on your phone to download the app and buy tickets.'}try{if(window.localStorage.getItem(installKey)==='1'){showContinuation()}}catch(_){}if(installLink){installLink.addEventListener('click',markInstallPending)}})()</script></body></html>`);
  } catch (error) {
    return next(error);
  }
};

exports.getTicketInvitationEvent = async (req, res, next) => {
  try {
    const event = await getTicketInvitationEvent(req.params.shareToken).lean();
    if (!event) throw buildError('Ticket invitation is unavailable', 404);
    const eventWithImages = await attachActiveEventImages(event);
    return res.data(
      { marketplaceEvent: sanitizePublicMarketplaceEvent(eventWithImages) },
      'Private ticket invitation'
    );
  } catch (error) {
    return next(error);
  }
};

exports.createScannerSession = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({
      event_id: req.params.eventId,
      customer_user_id: req.user._id,
    }).lean();
    if (!event) throw buildError('Event not found', 404);
    if (
      !isScannerAvailable({
        eventDate: event.event_date,
        eventTime: event.event_time,
        timeZone: event.event_timezone,
        closedAt: event.ticket_scanning_closed_at,
      })
    ) {
      throw buildError('Ticket scanning is not currently available', 403);
    }
    const { token, tokenHash } = createTicketToken();
    await MarketplaceScannerSessionModel.create({
      session_token_hash: tokenHash,
      event_id: event.event_id,
      coordinator_user_id: req.user._id,
      expires_at: new Date(Date.now() + 36 * 60 * 60 * 1000),
    });
    return res.data(
      {
        scanner_url: `${server.publicTicketBaseURL}/check-in/${encodeURIComponent(token)}`,
      },
      'Scanner session created'
    );
  } catch (error) {
    return next(error);
  }
};

exports.publicTicketPage = async (req, res, next) => {
  try {
    const ticket = await MarketplaceTicketModel.findOne({
      token_hash: hashTicketToken(req.params.token),
    })
      .select('+token_hash')
      .lean();
    if (!ticket) return res.status(404).send('Ticket not found');
    const event = await MarketplaceEventModel.findOne({ event_id: ticket.event_id }).lean();
    if (!event) return res.status(404).send('Event not found');
    const ticketUrl = `${server.publicTicketBaseURL}/t/${encodeURIComponent(req.params.token)}`;
    const qrDataUrl = ticket.status === 'ACTIVE'
      ? await buildTicketQrDataUrl(ticketUrl)
      : null;
    res.set({
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.type('html').send(
      renderTicketPage({
        ticket,
        event,
        qrDataUrl,
      })
    );
  } catch (error) {
    return next(error);
  }
};

exports.publicScannerPage = async (req, res, next) => {
  try {
    const session = await MarketplaceScannerSessionModel.findOne({
      session_token_hash: hashTicketToken(req.params.sessionToken),
      revoked_at: null,
      expires_at: { $gt: new Date() },
    })
      .select('+session_token_hash')
      .lean();
    if (!session) return res.status(404).send('Scanner session expired');
    const event = await MarketplaceEventModel.findOne({ event_id: session.event_id }).lean();
    if (!event) return res.status(404).send('Event not found');
    res.set({
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'self'",
      'Permissions-Policy': 'camera=(self)',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.type('html').send(
      renderScannerPage({ event, sessionToken: req.params.sessionToken })
    );
  } catch (error) {
    return next(error);
  }
};

exports.publicValidateTicket = async (req, res, next) => {
  try {
    const session = await MarketplaceScannerSessionModel.findOneAndUpdate(
      {
        session_token_hash: hashTicketToken(req.body.scanner_session_token),
        event_id: req.body.event_id,
        revoked_at: null,
        expires_at: { $gt: new Date() },
      },
      { $set: { last_used_at: new Date() } },
      { new: true }
    ).select('+session_token_hash');
    if (!session) throw buildError('Scanner session expired', 401);
    const event = await MarketplaceEventModel.findOne({ event_id: session.event_id }).lean();
    if (
      !event ||
      !isScannerAvailable({
        eventDate: event.event_date,
        eventTime: event.event_time,
        timeZone: event.event_timezone,
        closedAt: event.ticket_scanning_closed_at,
      })
    ) {
      throw buildError('Ticket scanning is closed', 403);
    }

    const tokenHash = hashTicketToken(req.body.ticket_token);
    const checkedInAt = new Date();
    const ticket = await MarketplaceTicketModel.findOneAndUpdate(
      { event_id: event.event_id, token_hash: tokenHash, status: 'ACTIVE' },
      {
        $set: {
          status: 'CHECKED_IN',
          checked_in_at: checkedInAt,
          checked_in_by_user_id: session.coordinator_user_id,
          checked_in_session_id: String(session._id),
        },
      },
      { new: true }
    );
    if (!ticket) {
      const existing = await MarketplaceTicketModel.findOne({ token_hash: tokenHash })
        .select('+token_hash')
        .lean();
      if (!existing) throw buildError('Invalid ticket', 404);
      if (existing.event_id !== event.event_id) throw buildError('Ticket belongs to another event', 409);
      throw buildError(
        existing.status === 'CHECKED_IN' ? 'Ticket already used' : `Ticket is ${existing.status.toLowerCase().replaceAll('_', ' ')}`,
        409
      );
    }
    return res.data(
      {
        valid: true,
        attendeeName: ticket.attendee_label,
        ticketType: ticket.ticket_type,
        checkedInAt,
      },
      'Ticket checked in'
    );
  } catch (error) {
    return next(error);
  }
};
