const { Joi } = require('express-validation');

const marketplaceEventBody = {
  event_name: Joi.string().trim().required(),
  event_description: Joi.string().allow(null, ''),
  event_type: Joi.string().trim().required(),
  event_style: Joi.string().allow(null, ''),
  service_type: Joi.string().allow(null, ''),
  primary_service_style: Joi.string().allow(null, ''),
  event_date: Joi.date().required(),
  event_time: Joi.string().allow(null, ''),
  event_address: Joi.string().trim().required(),
  event_city: Joi.string().trim().required(),
  event_state: Joi.string().trim().required(),
  event_zip: Joi.string().allow(null, ''),
  number_of_guests: Joi.number().integer().min(1).required(),
  number_of_vendors_needed: Joi.number().integer().min(1).required(),
  power_required: Joi.array().items(Joi.string()).default([]),
  permits_required: Joi.array().items(Joi.string()).default([]),
  insurance_required: Joi.boolean().default(false),
  alcohol_required: Joi.boolean().default(false),
  cuisine_preferences: Joi.array().items(Joi.string()).default([]),
  dietary_restrictions: Joi.array().items(Joi.string()).default([]),
  equipment_needed: Joi.array().items(Joi.string()).default([]),
  vendor_fee: Joi.number().min(0).default(0),
  budgeted_amount: Joi.number().min(0).default(0),
  event_close_date: Joi.date().required(),
  status: Joi.string().valid(
    'DRAFT',
    'OPEN',
    'CLOSED',
    'AWARDED',
    'REOPENED',
    'CANCELLED'
  ),
};

module.exports = {
  createEvent: {
    body: Joi.object(marketplaceEventBody),
  },

  openEvents: {
    query: Joi.object({
      limit: Joi.number().integer().min(1),
      page: Joi.number().integer().min(1),
    }),
  },

  submitBid: {
    body: Joi.object({
      price_per_guest: Joi.number().min(0).allow(null),
      full_bid_amount: Joi.number().min(0).required(),
      menu_description: Joi.string().allow(null, ''),
      notes: Joi.string().allow(null, ''),
      menu_pdf_url: Joi.string().uri().allow(null, ''),
      image_urls: Joi.array().items(Joi.string().uri()).default([]),
      insurance_confirmed: Joi.boolean().default(false),
      permits_confirmed: Joi.boolean().default(false),
      liquor_license_confirmed: Joi.boolean().default(false),
      nda_required: Joi.boolean().default(false),
      nda_acknowledged: Joi.boolean().default(false),
      bid_status: Joi.string().valid('DRAFT', 'SUBMITTED'),
    }),
  },

  uploadBidAttachment: {
    body: Joi.object({
      attachment_type: Joi.string()
        .valid(
          'BID_MENU_PDF',
          'BID_IMAGE',
          'PERMIT_LICENSE',
          'AGREEMENT_DOCUMENT'
        )
        .required(),
    }),
  },

  awardBids: {
    body: Joi.object({
      bid_ids: Joi.array().items(Joi.string().required()).min(1).required(),
    }),
  },

  updateEventStatus: {
    body: Joi.object({
      status: Joi.string()
        .valid('DRAFT', 'OPEN', 'CLOSED', 'AWARDED', 'REOPENED', 'CANCELLED')
        .required(),
    }),
  },

  repositoryFiles: {
    query: Joi.object({
      limit: Joi.number().integer().min(1),
      page: Joi.number().integer().min(1),
      status: Joi.string().valid('ACTIVE', 'ARCHIVED', 'DELETED', 'FLAGGED'),
      attachment_type: Joi.string().valid(
        'EVENT_IMAGE',
        'BID_MENU_PDF',
        'BID_IMAGE',
        'PERMIT_LICENSE',
        'AGREEMENT_DOCUMENT'
      ),
      event_id: Joi.string().allow(null, ''),
      bid_id: Joi.string().allow(null, ''),
      search: Joi.string().allow(null, ''),
    }),
  },

  updateRepositoryFileStatus: {
    body: Joi.object({
      status: Joi.string()
        .valid('ARCHIVED', 'DELETED', 'FLAGGED')
        .required(),
      reason: Joi.string().trim().required(),
    }),
  },

  checkoutPayment: {
    body: Joi.object({
      payment_method: Joi.string().valid('APPLE_PAY', 'GOOGLE_PAY').required(),
      payment_data: Joi.alternatives()
        .try(Joi.object().unknown(true), Joi.string())
        .required(),
    }),
  },

  adminMarketplacePayments: {
    query: Joi.object({
      limit: Joi.number().integer().min(1),
      page: Joi.number().integer().min(1),
      payment_status: Joi.string().valid(
        'PENDING',
        'PAID',
        'FAILED',
        'CANCELLED',
        'REFUNDED'
      ),
      payment_type: Joi.string().valid(
        'COORDINATOR_AWARD_FEE',
        'VENDOR_EVENT_FEE',
        'REOPEN_BIDDING_FEE'
      ),
    }),
  },

  adminMarkPaymentPaid: {
    body: Joi.object({
      manual_payment_reference: Joi.string().trim().allow(null, ''),
      manual_payment_note: Joi.string().trim().required(),
    }),
  },
};
