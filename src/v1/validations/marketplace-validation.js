const { Joi } = require('express-validation');

const marketplaceEventBody = {
  event_name: Joi.string().trim().allow(null, ''),
  event_description: Joi.string().allow(null, ''),
  event_vendor_needs: Joi.array().items(Joi.object({
    vendor_type: Joi.string().valid('MERCHANDISE', 'SERVICE', 'OTHER').required(),
    type_description: Joi.string().trim().max(250).allow(null, ''),
    quantity: Joi.number().integer().min(1).required(),
    fee: Joi.number().min(0).required(),
  })).default([]),
  event_vendor_electricity_fee: Joi.number().min(0).default(0),
  ticket_sales_enabled: Joi.boolean().default(false),
  ticket_url: Joi.string().uri().allow(null, ''),
  ga_ticket_quantity: Joi.number().integer().min(0).default(0),
  ga_ticket_price: Joi.number().min(0).default(0),
  vip_ticket_quantity: Joi.number().integer().min(0).default(0),
  vip_ticket_price: Joi.number().min(0).default(0),
  charitable_event: Joi.boolean().default(false),
  religious_organization: Joi.boolean().default(false),
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
  event_timezone: Joi.string().trim().default('America/New_York'),
  event_duration_hours: Joi.number().integer().min(0).allow(null, ''),
  event_duration_minutes: Joi.number().integer().min(0).allow(null, ''),
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
  number_of_guests: Joi.number().integer().min(0).allow(null, ''),
  number_of_vendors_needed: Joi.number().integer().min(1).allow(null, ''),
  power_required: Joi.array().items(Joi.string()).default([]),
  permits_required: Joi.array().items(Joi.string()).default([]),
  insurance_required: Joi.boolean().default(false),
  alcohol_required: Joi.boolean().default(false),
  free_food_offered: Joi.boolean().allow(null),
  free_food_provider: Joi.string().trim().allow(null, ''),
  vendors_required_to_giveaway_food: Joi.boolean().allow(null),
  catered_vip_section_enabled: Joi.boolean().default(false),
  vip_section_enabled: Joi.boolean().default(false),
  vip_section_details: Joi.string().trim().max(1000).allow(null, ''),
  fully_catered_event: Joi.boolean().default(false),
  ga_food_sales_allowed: Joi.boolean().allow(null),
  waive_vendor_fee_for_combined_award: Joi.boolean().allow(null),
  vendor_fee_payment_deadline: Joi.date().allow(null, ''),
  separate_vip_vendor_required: Joi.boolean().default(false),
  dessert_caterer_required: Joi.boolean().default(false),
  drinks_caterer_required: Joi.boolean().default(false),
  vip_guest_count: Joi.number().integer().min(0).allow(null, ''),
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

const adminSubmissionParams = Joi.object({
  eventId: Joi.string().trim().required(),
  submissionType: Joi.string()
    .valid('FOOD_BID', 'FOOD_APPLICATION', 'MARKETPLACE_APPLICATION')
    .required(),
  submissionId: Joi.string().trim().required(),
});

const adminSubmissionEditableBody = {
  price_per_guest: Joi.number().min(0).allow(null),
  average_price_per_meal: Joi.number().min(0).allow(null),
  full_bid_amount: Joi.number().min(0).allow(null),
  guest_coverage: Joi.string().valid('REGULAR', 'VIP', 'BOTH').allow(null, ''),
  regular_guest_amount: Joi.number().min(0).allow(null),
  vip_catering_amount: Joi.number().min(0).allow(null),
  business_name: Joi.string().trim().max(250).allow(null, ''),
  contact_name: Joi.string().trim().max(250).allow(null, ''),
  phone: Joi.string().trim().max(50).allow(null, ''),
  contact_number: Joi.string().trim().max(50).allow(null, ''),
  email: Joi.string().trim().email().allow(null, ''),
  food_type_cuisine: Joi.string().trim().max(1000).allow(null, ''),
  menu_description: Joi.string().max(5000).allow(null, ''),
  notes: Joi.string().max(5000).allow(null, ''),
  additional_notes: Joi.string().max(5000).allow(null, ''),
  insurance_confirmed: Joi.boolean(),
  permits_confirmed: Joi.boolean(),
  liquor_license_confirmed: Joi.boolean(),
  vendor_types: Joi.array()
    .items(Joi.string().valid('MERCHANDISE', 'SERVICE', 'OTHER')),
  offering_bullets: Joi.array().items(Joi.string().trim().max(500)),
  average_price: Joi.number().min(0).allow(null),
  electricity_required: Joi.boolean(),
  admin_reason: Joi.string().trim().max(1000).required(),
};

module.exports = {
  createEvent: {
    body: Joi.object(marketplaceEventBody),
  },

  adminCreateEvent: {
    body: Joi.object({
      customer_user_id: Joi.string().allow(null, ''),
      admin_reason: Joi.string().trim().max(1000).required(),
      save_mode: Joi.string().valid('DRAFT', 'PUBLISH').default('PUBLISH'),
      ...marketplaceEventBody,
    }).prefs({ noDefaults: true }),
  },

  updateEvent: {
    body: Joi.object(marketplaceEventBody).min(1).prefs({ noDefaults: true }),
  },

  reopenEvent: {
    body: Joi.object({
      ...marketplaceEventBody,
      reopen_mode: Joi.string().valid('ARCHIVE', 'KEEP').default('ARCHIVE'),
    }),
  },

  closeEvent: {
    body: Joi.object({
      close_comment: Joi.string().trim().max(1000).allow('').default(''),
    }),
  },

  openEvents: {
    query: Joi.object({
      limit: Joi.number().integer().min(1),
      page: Joi.number().integer().min(1),
    }),
  },

  submitBid: {
    body: Joi.object({
      price_per_guest: Joi.when('bid_status', {
        is: Joi.valid('PENDING_SIGNATURE', 'SUBMITTED'),
        then: Joi.number().greater(0).required(),
        otherwise: Joi.number().min(0).allow(null),
      }),
      average_price_per_meal: Joi.number().min(0).allow(null),
      full_bid_amount: Joi.number().min(0).allow(null),
      guest_coverage: Joi.string().valid('REGULAR', 'VIP', 'BOTH', 'SPECIALTY').default('REGULAR'),
      specialty_services: Joi.array().items(Joi.string().valid('DESSERTS', 'DRINKS')).unique().default([]),
      regular_guest_amount: Joi.number().min(0).allow(null),
      vip_catering_amount: Joi.number().min(0).allow(null),
      menu_description: Joi.string().allow(null, ''),
      notes: Joi.string().allow(null, ''),
      menu_pdf_url: Joi.string().uri().allow(null, ''),
      image_urls: Joi.array().items(Joi.string().uri()).default([]),
      insurance_confirmed: Joi.boolean().default(false),
      permits_confirmed: Joi.boolean().default(false),
      liquor_license_confirmed: Joi.boolean().default(false),
      nda_required: Joi.boolean().default(false),
      nda_acknowledged: Joi.boolean().default(false),
      bid_status: Joi.string().valid('DRAFT', 'PENDING_SIGNATURE', 'SUBMITTED'),
    }),
  },

  uploadBidAttachment: {
    body: Joi.object({
      attachment_type: Joi.string()
        .valid(
          'BID_MENU_PDF',
          'BID_IMAGE',
          'PERMIT_LICENSE',
          'AGREEMENT_DOCUMENT',
          'REQUIREMENT_DOCUMENT',
          'HEALTH_PERMIT',
          'BUSINESS_LICENSE',
          'COI',
          'LIQUOR_LICENSE',
          'EIN',
          'W9',
          'Insurance',
          'Certificate of Insurance',
          'Sanitation Grade',
          'Business License/Permit',
          'Liquor License',
          'W-9'
        )
        .required(),
      requirement_label: Joi.string().trim().max(100).allow(null, ''),
    }),
  },

  submitApplication: {
    body: Joi.object({
      business_name: Joi.string().trim().allow(null, ''),
      contact_name: Joi.string().trim().allow(null, ''),
      phone: Joi.string().trim().allow(null, ''),
      email: Joi.string().trim().email().allow(null, ''),
      food_type_cuisine: Joi.string().trim().allow(null, ''),
      menu_description: Joi.string().allow(null, ''),
      notes: Joi.string().allow(null, ''),
      insurance_confirmed: Joi.boolean().default(false),
      permits_confirmed: Joi.boolean().default(false),
      liquor_license_confirmed: Joi.boolean().default(false),
      nda_required: Joi.boolean().default(false),
      nda_acknowledged: Joi.boolean().default(false),
      application_status: Joi.string().valid('DRAFT', 'PENDING_SIGNATURE', 'SUBMITTED'),
    }),
  },

  uploadApplicationAttachment: {
    body: Joi.object({
      attachment_type: Joi.string()
        .valid(
          'APPLICATION_MENU_PDF',
          'APPLICATION_IMAGE',
          'PERMIT_LICENSE',
          'AGREEMENT_DOCUMENT',
          'REQUIREMENT_DOCUMENT',
          'HEALTH_PERMIT',
          'BUSINESS_LICENSE',
          'COI',
          'LIQUOR_LICENSE',
          'EIN',
          'W9',
          'Insurance',
          'Certificate of Insurance',
          'Sanitation Grade',
          'Business License/Permit',
          'Liquor License',
          'W-9'
        )
        .required(),
      requirement_label: Joi.string().trim().max(100).allow(null, ''),
    }),
  },

  awardBids: {
    body: Joi.object({
      bid_ids: Joi.array().items(Joi.string()).default([]),
      food_application_ids: Joi.array().items(Joi.string()).default([]),
      event_vendor_application_ids: Joi.array().items(Joi.string()).default([]),
      award_selections: Joi.array().items(Joi.object({
        bid_id: Joi.string().required(),
        award_coverage: Joi.string().valid('REGULAR', 'VIP', 'BOTH', 'SPECIALTY').required(),
        award_specialty_services: Joi.array().items(Joi.string().valid('DESSERTS', 'DRINKS')).unique().default([]),
      })).default([]),
    }).custom((value, helpers) => {
      if (
        !value.bid_ids.length &&
        !value.food_application_ids.length &&
        !value.event_vendor_application_ids.length
      ) {
        return helpers.error('any.custom', {
          message: 'Select at least one vendor submission to complete booking',
        });
      }
      return value;
    }).messages({
      'any.custom': '{{#message}}',
    }),
  },

  acceptApplication: {
    body: Joi.object({}),
  },

  revokeAward: {
    body: Joi.object({
      reason: Joi.string().trim().max(500).allow(null, ''),
    }),
  },

  createFinalEventPayment: {
    body: Joi.object({
      bid_id: Joi.string().trim().allow(null, ''),
      application_id: Joi.string().trim().allow(null, ''),
      tip_amount: Joi.number().min(0).default(0),
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
      vendor_user_id: Joi.alternatives().try(
        Joi.string().allow(null, ''),
        Joi.object().unknown(true).allow(null)
      ),
      bid_id: Joi.string().allow(null, ''),
      application_id: Joi.string().allow(null, ''),
    }),
  },

  answerEventQuestion: {
    body: Joi.object({
      answer_text: Joi.string().trim().min(3).max(1500).required(),
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
        'AGREEMENT_DOCUMENT',
        'REQUIREMENT_DOCUMENT',
        'HEALTH_PERMIT',
        'BUSINESS_LICENSE',
        'COI',
        'LIQUOR_LICENSE',
        'EIN',
        'W9',
        'Insurance',
        'Certificate of Insurance',
        'Sanitation Grade',
        'Business License/Permit',
        'Liquor License',
        'W-9'
      ),
      event_id: Joi.string().allow(null, ''),
      bid_id: Joi.string().allow(null, ''),
      search: Joi.string().allow(null, ''),
    }),
  },

  adminMarketplaceEvents: {
    query: Joi.object({
      limit: Joi.number().integer().min(1),
      page: Joi.number().integer().min(1),
      status: Joi.string().valid(
        'DRAFT',
        'OPEN',
        'CLOSED',
        'AWARDED',
        'REOPENED',
        'CANCELLED'
      ),
      search: Joi.string().allow(null, ''),
    }),
  },

  adminUpdateEvent: {
    body: Joi.object({
      ...marketplaceEventBody,
      admin_reason: Joi.string().trim().max(1000).required(),
      save_mode: Joi.string().valid('DRAFT', 'PUBLISH').default('PUBLISH'),
    }).min(1).prefs({ noDefaults: true }),
  },

  adminMarketplaceSubmission: {
    params: adminSubmissionParams,
  },

  adminUpdateMarketplaceSubmission: {
    params: adminSubmissionParams,
    body: Joi.object({
      ...adminSubmissionEditableBody,
      admin_reason: Joi.string().trim().max(1000).required(),
      save_mode: Joi.string().valid('DRAFT', 'PUBLISH').default('PUBLISH'),
    }).min(1).prefs({ noDefaults: true }),
  },

  adminMarketplaceSubmissionAction: {
    params: adminSubmissionParams,
    body: Joi.object({
      action: Joi.string().valid('WITHDRAW', 'ARCHIVE', 'DELETE', 'REVOKE').required(),
      reason: Joi.string().trim().max(1000).required(),
    }),
  },

  adminReplaceMarketplaceSubmissionAttachment: {
    params: adminSubmissionParams.append({
      attachmentId: Joi.string().trim().required(),
    }),
    body: Joi.object({
      admin_reason: Joi.string().trim().max(1000).required(),
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
      payment_method: Joi.string()
        .valid('APPLE_PAY', 'GOOGLE_PAY', 'TAP_TO_PAY', 'CASH')
        .required(),
      expected_total: Joi.number().min(0).required(),
      payment_data: Joi.alternatives()
        .try(Joi.object().unknown(true), Joi.string())
        .when('payment_method', {
          is: 'CASH',
          then: Joi.optional(),
          otherwise: Joi.required(),
        }),
    }),
  },

  updateFinalPaymentTip: {
    body: Joi.object({
      tip_amount: Joi.number().min(0).max(100000).required(),
    }),
  },

  checkoutTickets: {
    body: Joi.object({
      ga_quantity: Joi.number().integer().min(0).default(0),
      vip_quantity: Joi.number().integer().min(0).default(0),
      payment_method: Joi.string().valid('APPLE_PAY', 'GOOGLE_PAY').required(),
      payment_data: Joi.alternatives().try(Joi.object().unknown(true), Joi.string()).required(),
      idempotency_key: Joi.string().guid({ version: ['uuidv4'] }).required(),
      billing_address: Joi.object({
        line1: Joi.string().trim().required(),
        city: Joi.string().trim().required(),
        region: Joi.string().trim().length(2).required(),
        postalCode: Joi.string().trim().required(),
        country: Joi.string().trim().default('US'),
      }).required(),
    }).custom((value, helpers) =>
      value.ga_quantity + value.vip_quantity > 0
        ? value
        : helpers.message({ custom: 'At least one ticket is required' })
    ),
  },

  quoteTickets: {
    body: Joi.object({
      ga_quantity: Joi.number().integer().min(0).default(0),
      vip_quantity: Joi.number().integer().min(0).default(0),
      billing_address: Joi.object({
        line1: Joi.string().trim().required(),
        city: Joi.string().trim().required(),
        region: Joi.string().trim().length(2).required(),
        postalCode: Joi.string().trim().required(),
        country: Joi.string().trim().default('US'),
      }).required(),
    }).custom((value, helpers) =>
      value.ga_quantity + value.vip_quantity > 0
        ? value
        : helpers.message({ custom: 'At least one ticket is required' })
    ),
  },

  guestCheckoutTickets: {
    body: Joi.object({
      ga_quantity: Joi.number().integer().min(0).default(0),
      vip_quantity: Joi.number().integer().min(0).default(0),
      payment_method: Joi.string().valid('APPLE_PAY', 'GOOGLE_PAY').required(),
      payment_data: Joi.alternatives().try(Joi.object().unknown(true), Joi.string()).required(),
      idempotency_key: Joi.string().guid({ version: ['uuidv4'] }).required(),
      purchaser: Joi.object({
        first_name: Joi.string().trim().min(1).max(100).required(),
        last_name: Joi.string().trim().min(1).max(100).required(),
        email: Joi.string().trim().email().max(254).required(),
        phone: Joi.string().trim().pattern(/^\+?[0-9() .-]{7,25}$/).required(),
      }).required(),
      billing_address: Joi.object({
        line1: Joi.string().trim().required(),
        city: Joi.string().trim().required(),
        region: Joi.string().trim().length(2).required(),
        postalCode: Joi.string().trim().required(),
        country: Joi.string().trim().default('US'),
      }).required(),
    }).custom((value, helpers) =>
      value.ga_quantity + value.vip_quantity > 0
        ? value
        : helpers.message({ custom: 'At least one ticket is required' })
    ),
  },

  guestQuoteTickets: {
    body: Joi.object({
      ga_quantity: Joi.number().integer().min(0).default(0),
      vip_quantity: Joi.number().integer().min(0).default(0),
      purchaser: Joi.object({
        first_name: Joi.string().trim().min(1).max(100).required(),
        last_name: Joi.string().trim().min(1).max(100).required(),
        email: Joi.string().trim().email().max(254).required(),
        phone: Joi.string().trim().pattern(/^\+?[0-9() .-]{7,25}$/).required(),
      }).required(),
      billing_address: Joi.object({
        line1: Joi.string().trim().required(),
        city: Joi.string().trim().required(),
        region: Joi.string().trim().length(2).required(),
        postalCode: Joi.string().trim().required(),
        country: Joi.string().trim().default('US'),
      }).required(),
    }).custom((value, helpers) =>
      value.ga_quantity + value.vip_quantity > 0
        ? value
        : helpers.message({ custom: 'At least one ticket is required' })
    ),
  },

  validateTicket: {
    body: Joi.object({
      ticket_token: Joi.string().trim().min(20).required(),
      scanner_session_id: Joi.string().trim().max(100).allow(null, ''),
    }),
  },

  cancelTicketedEvent: {
    body: Joi.object({
      confirm_cancellation: Joi.boolean().valid(true).required(),
    }),
  },

  reviewTaxExemption: {
    body: Joi.object({
      status: Joi.string().valid('APPROVED', 'REJECTED').required(),
      expiration_date: Joi.date().allow(null, ''),
      review_notes: Joi.string().trim().max(1000).allow(null, ''),
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
        'FINAL_EVENT_PAYMENT'
      ),
    }),
  },

  adminMarkPaymentPaid: {
    body: Joi.object({
      manual_payment_reference: Joi.string().trim().allow(null, ''),
      manual_payment_note: Joi.string().trim().required(),
    }),
  },

  startVendorAgreementSigning: {
    body: Joi.object({
      event_id: Joi.string().trim().required(),
      bid_id: Joi.string().trim().allow(null, ''),
      application_id: Joi.string().trim().allow(null, ''),
      application_draft_id: Joi.string().trim().max(160).allow(null, '').strict(),
      return_url: Joi.string().trim().allow(null, ''),
      reconcile_only: Joi.boolean().default(false),
    }),
  },

  acknowledgeVendorNotifications: {
    body: Joi.object({
      notification_ids: Joi.array().items(Joi.string().trim()).min(1).required(),
    }),
  },

  vendorAgreementReturn: {
    body: Joi.object({
      status: Joi.string()
        .valid('completed', 'cancelled', 'declined', 'error')
        .required(),
    }),
  },
};
