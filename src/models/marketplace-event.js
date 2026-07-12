const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    event_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    customer_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    event_name: {
      type: String,
      required: true,
    },
    event_description: {
      type: String,
      default: null,
    },
    ticket_sales_enabled: {
      type: Boolean,
      default: false,
    },
    ticket_url: {
      type: String,
      default: null,
    },
    event_impression_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    ticket_click_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    event_type: {
      type: String,
      required: true,
    },
    event_type_other: {
      type: String,
      default: null,
    },
    event_visibility: {
      type: String,
      enum: ['PUBLIC', 'PRIVATE'],
      default: 'PRIVATE',
      index: true,
    },
    event_style: {
      type: String,
      default: null,
    },
    service_type: {
      type: String,
      default: null,
    },
    service_types: {
      type: [String],
      default: [],
    },
    service_styles: {
      type: [String],
      default: [],
    },
    primary_service_style: {
      type: String,
      default: null,
    },
    plated_number_of_courses: {
      type: String,
      default: null,
    },
    plated_options: {
      type: [String],
      default: [],
    },
    plated_entree_selection: {
      type: String,
      default: null,
    },
    plated_included_items: {
      type: [String],
      default: [],
    },
    plated_single_entree: {
      type: Boolean,
      default: false,
    },
    plated_choice_entrees: {
      type: Boolean,
      default: false,
    },
    plated_tableside_choice: {
      type: Boolean,
      default: false,
    },
    plated_bread_salad_dessert: {
      type: Boolean,
      default: false,
    },
    buffet_options: {
      type: [String],
      default: [],
    },
    buffet_setup: {
      type: String,
      default: null,
    },
    buffet_included_items: {
      type: [String],
      default: [],
    },
    food_truck_options: {
      type: [String],
      default: [],
    },
    station_setup_type: {
      type: String,
      default: null,
    },
    station_included_items: {
      type: [String],
      default: [],
    },
    service_notes: {
      type: String,
      default: null,
    },
    event_date: {
      type: Date,
      required: function requiredEventDate() {
        return this.status !== 'DRAFT';
      },
      index: true,
    },
    event_time: {
      type: String,
      default: null,
    },
    event_duration_hours: {
      type: Number,
      min: 0,
      default: 0,
    },
    event_duration_minutes: {
      type: Number,
      min: 0,
      default: 0,
    },
    event_close_time: {
      type: String,
      default: null,
    },
    event_address: {
      type: String,
      required: function requiredEventAddress() {
        return this.status !== 'DRAFT';
      },
    },
    event_city: {
      type: String,
      required: function requiredEventCity() {
        return this.status !== 'DRAFT';
      },
    },
    event_state: {
      type: String,
      required: function requiredEventState() {
        return this.status !== 'DRAFT';
      },
    },
    event_zip: {
      type: String,
      default: null,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    formatted_address: {
      type: String,
      default: null,
    },
    geocoded_address: {
      type: String,
      default: null,
    },
    place_id: {
      type: String,
      default: null,
      index: true,
    },
    geocoding_provider: {
      type: String,
      enum: ['GOOGLE_PLACES', null],
      default: null,
    },
    geocoded_at: {
      type: Date,
      default: null,
    },
    number_of_guests: {
      type: Number,
      required: function requiredNumberOfGuests() {
        return this.status !== 'DRAFT';
      },
      min: 1,
    },
    number_of_vendors_needed: {
      type: Number,
      required: function requiredNumberOfVendorsNeeded() {
        return this.status !== 'DRAFT' && this.service_types?.includes('Food Truck');
      },
      min: 1,
    },
    power_required: {
      type: [String],
      default: [],
    },
    permits_required: {
      type: [String],
      default: [],
    },
    insurance_required: {
      type: Boolean,
      default: false,
    },
    alcohol_required: {
      type: Boolean,
      default: false,
    },
    cuisine_preferences: {
      type: [String],
      default: [],
    },
    dietary_restrictions: {
      type: [String],
      default: [],
    },
    equipment_needed: {
      type: [String],
      default: [],
    },
    vendor_fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    budgeted_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    payment_responsibility: {
      type: String,
      enum: ['COORDINATOR', 'VENDOR', 'BOTH', 'NONE'],
      default: 'NONE',
      index: true,
    },
    event_close_date: {
      type: Date,
      required: function requiredCloseDate() {
        return this.status !== 'DRAFT';
      },
      index: true,
    },
    closed_at: {
      type: Date,
      default: null,
      index: true,
    },
    close_comment: {
      type: String,
      maxlength: 1000,
      default: null,
    },
    closed_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    close_notification_sent_at: {
      type: Date,
      default: null,
    },
    submissions_seen_at: {
      type: Date,
      default: null,
      index: true,
    },
    draft_expires_at: {
      type: Date,
      default: null,
      index: true,
    },
    archived_at: {
      type: Date,
      default: null,
      index: true,
    },
    reopen_count: {
      type: Number,
      default: 0,
      min: 0,
      max: 2,
    },
    current_submission_round: {
      type: Number,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'OPEN', 'CLOSED', 'AWARDED', 'REOPENED', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },
    award_payment_id: {
      type: String,
      default: null,
      index: true,
    },
    award_payment_status: {
      type: String,
      enum: ['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'],
      default: 'NOT_REQUIRED',
      index: true,
    },
    agreement_provider: {
      type: String,
      enum: ['NONE', 'DOCUSIGN'],
      default: 'NONE',
    },
    agreement_envelope_id: {
      type: String,
      default: null,
      index: true,
    },
    agreement_status: {
      type: String,
      enum: [
        'NOT_REQUIRED',
        'ACKNOWLEDGED',
        'PENDING_SIGNATURE',
        'SENT',
        'VIEWED',
        'SIGNED',
        'DECLINED',
        'VOIDED',
        'ERROR',
      ],
      default: 'NOT_REQUIRED',
      index: true,
    },
    agreement_sent_at: {
      type: Date,
      default: null,
    },
    agreement_signed_at: {
      type: Date,
      default: null,
    },
    signed_document_url: {
      type: String,
      default: null,
    },
    signer_name: {
      type: String,
      default: null,
    },
    signer_email: {
      type: String,
      default: null,
    },
    agreement_error_message: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

module.exports = new mongoose.model('marketplace-events', mSchema);
