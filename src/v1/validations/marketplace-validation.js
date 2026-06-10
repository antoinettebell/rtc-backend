const { Joi } = require('express-validation');

const marketplaceEventBody = {
  event_name: Joi.string().trim().allow(null, ''),
  event_description: Joi.string().allow(null, ''),
  ticket_sales_enabled: Joi.boolean().default(false),
  ticket_url: Joi.string().uri().allow(null, ''),
  event_type: Joi.string().trim().allow(null, ''),
  event_type_other: Joi.string().trim().allow(null, ''),
  event_visibility: Joi.string().valid('PUBLIC', 'PRIVATE').default('PRIVATE'),
  event_style: Joi.string().allow(null, ''),
  service_type: Joi.string().allow(null, ''),
  service_types: Joi.array().items(Joi.string()).default([]),
  service_styles: Joi.array().items(Joi.string()).default([]),
  primary_service_style: Joi.string().allow(null, ''),
  plated_number_of_courses: Joi.string()
    .valid(
      '1 Course',
      '2 Courses',
      '3 Courses',
      '4 Courses',
      '5 Courses',
      'Vendor Recommended'
    )
    .allow(null, ''),
  plated_options: Joi.array().items(Joi.string()).default([]),
  plated_entree_selection: Joi.string().allow(null, ''),
  plated_included_items: Joi.array().items(Joi.string()).default([]),
  plated_single_entree: Joi.boolean().default(false),
  plated_choice_entrees: Joi.boolean().default(false),
  plated_tableside_choice: Joi.boolean().default(false),
  plated_bread_salad_dessert: Joi.boolean().default(false),
  buffet_options: Joi.array()
    .items(Joi.string().valid('Full Menu', 'Self-Service', 'Staff-Service', 'Stations'))
    .default([]),
  buffet_setup: Joi.string().allow(null, ''),
  buffet_included_items: Joi.array().items(Joi.string()).default([]),
  food_truck_options: Joi.array()
    .items(
      Joi.string().valid(
        'Full Menu',
        'Limited event menu',
        'Vendor recommended'
      )
    )
    .default([]),
  station_setup_type: Joi.string().allow(null, ''),
  station_included_items: Joi.array().items(Joi.string()).default([]),
  service_notes: Joi.string().allow(null, ''),
  event_date: Joi.date().allow(null, ''),
  event_time: Joi.string().allow(null, ''),
  event_address: Joi.string().trim().allow(null, ''),
  event_city: Joi.string().trim().allow(null, ''),
  event_state: Joi.string().trim().allow(null, ''),
  event_zip: Joi.string().allow(null, ''),
  latitude: Joi.number().min(-90).max(90).allow(null, ''),
  longitude: Joi.number().min(-180).max(180).allow(null, ''),
  formatted_address: Joi.string().allow(null, ''),
  geocoded_address: Joi.string().allow(null, ''),
  place_id: Joi.string().allow(null, ''),
  geocoding_provider: Joi.string().valid('GOOGLE_PLACES').allow(null, ''),
  geocoded_at: Joi.date().allow(null, ''),
  number_of_guests: Joi.number().integer().min(1).allow(null, ''),
  number_of_vendors_needed: Joi.number().integer().min(1).allow(null, ''),
  power_required: Joi.array().items(Joi.string()).default([]),
  permits_required: Joi.array().items(Joi.string()).default([]),
  insurance_required: Joi.boolean().default(false),
  alcohol_required: Joi.boolean().default(false),
  cuisine_preferences: Joi.array().items(Joi.string()).default([]),
  dietary_restrictions: Joi.array().items(Joi.string()).default([]),
  equipment_needed: Joi.array().items(Joi.string()).default([]),
  vendor_fee: Joi.number().min(0).default(0),
  budgeted_amount: Joi.number().min(0).default(0),
  payment_responsibility: Joi.string()
    .valid('COORDINATOR', 'VENDOR', 'BOTH', 'NONE')
    .default('NONE'),
  event_close_date: Joi.date().allow(null, ''),
  event_close_time: Joi.string().allow(null, ''),
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

  updateEvent: {
    body: Joi.object(marketplaceEventBody),
  },

  reopenEvent: {
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
      average_price_per_meal: Joi.number().min(0).allow(null),
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

  submitApplication: {
    body: Joi.object({
      business_name: Joi.string().trim().required(),
      contact_name: Joi.string().trim().required(),
      phone: Joi.string().trim().required(),
      email: Joi.string().trim().email().required(),
      food_type_cuisine: Joi.string().trim().allow(null, ''),
      menu_description: Joi.string().allow(null, ''),
      notes: Joi.string().allow(null, ''),
      insurance_confirmed: Joi.boolean().default(false),
      permits_confirmed: Joi.boolean().default(false),
      liquor_license_confirmed: Joi.boolean().default(false),
      nda_required: Joi.boolean().default(false),
      nda_acknowledged: Joi.boolean().default(false),
      application_status: Joi.string().valid('DRAFT', 'SUBMITTED'),
    }),
  },

  uploadApplicationAttachment: {
    body: Joi.object({
      attachment_type: Joi.string()
        .valid(
          'APPLICATION_MENU_PDF',
          'APPLICATION_IMAGE',
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

  askEventQuestion: {
    body: Joi.object({
      question_text: Joi.string().trim().min(3).max(1000).required(),
    }),
  },

  answerEventQuestion: {
    body: Joi.object({
      answer_text: Joi.string().trim().min(1).max(1500).required(),
      proxy_action_reason: Joi.string().trim().max(500).allow(null, ''),
    }),
  },

  updateEventQuestionStatus: {
    body: Joi.object({
      status: Joi.string()
        .valid('PENDING', 'PUBLISHED', 'BLOCKED', 'ARCHIVED')
        .required(),
      proxy_action_reason: Joi.string().trim().max(500).allow(null, ''),
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
