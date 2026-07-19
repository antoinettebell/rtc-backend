/**
 * Mongoose model for food-truck collection
 */
const mongoose = require('mongoose');

const toPhoneDigits = (value) =>
  value === null || value === undefined ? value : String(value).replace(/\D/g, '');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'plans',
      default: null,
    },
    planUpdateDate: {
      type: Date,
      default: Date.now,
    },
    addOnPlanUpdateDate: {
      type: Date,
      default: Date.now,
    },
    name: {
      type: String,
      default: null,
    },
    socialMedia: [
      {
        mediaType: {
          type: String,
          enum: [
            'FACEBOOK',
            'INSTAGRAM',
            'TWITTER',
            'LINKEDIN',
            'TIKTOK',
            'YOUTUBE',
            'SNAPCHAT',
            'PINTEREST',
            'REDDIT',
            'WEB',
          ],
          default: 'FACEBOOK',
        },
        mediaUrl: {
          type: String,
          default: null,
        },
      },
    ],
    // facebookLink: {
    //   type: String,
    //   default: null,
    // },
    // instagramLink: {
    //   type: String,
    //   default: null,
    // },
    infoType: {
      type: String,
      enum: ['truck', 'caterer'],
    },
    logo: {
      type: String,
      default: null,
    },
    currentLocation: {
      type: String,
      default: null,
    },
    food_truck_count: {
      type: Number,
      default: 1,
      min: 1,
    },
    truck_units: [
      {
        name: {
          type: String,
          default: null,
        },
        phone: {
          type: String,
          default: null,
          set: toPhoneDigits,
        },
        display_order: {
          type: Number,
          default: 1,
        },
        is_primary: {
          type: Boolean,
          default: false,
        },
        is_archived: {
          type: Boolean,
          default: false,
          index: true,
        },
        archived_at: {
          type: Date,
          default: null,
        },
        open_locations: [
          {
            locationId: {
              type: String,
              required: true,
            },
            isOrderingOpen: {
              type: Boolean,
              default: false,
            },
            updated_at: {
              type: Date,
              default: Date.now,
            },
            status_source: {
              type: String,
              enum: ['MANUAL', 'SCHEDULE'],
              default: 'MANUAL',
            },
            schedule_override_until: {
              type: Date,
              default: null,
            },
            schedule_override_reason: {
              type: String,
              default: null,
            },
          },
        ],
      },
    ],
    photos: [
      {
        type: String,
        default: null,
      },
    ],
    documents: [
      {
        title: {
          type: String,
          default: null,
        },
        document_type: {
          type: String,
          enum: ['PERMIT', 'LICENSE', 'INSURANCE', 'EIN', 'W9', 'OTHER'],
          default: 'OTHER',
        },
        file_url: {
          type: String,
          required: true,
        },
        file_key: {
          type: String,
          default: null,
        },
        original_name: {
          type: String,
          default: null,
        },
        mime_type: {
          type: String,
          default: null,
        },
        size_bytes: {
          type: Number,
          default: null,
          min: 0,
        },
        uploaded_by_user_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'users',
          default: null,
        },
        uploaded_at: {
          type: Date,
          default: Date.now,
        },
        document_status: {
          type: String,
          enum: ['ACTIVE', 'ARCHIVED'],
          default: 'ACTIVE',
        },
        archived_at: {
          type: Date,
          default: null,
        },
        archived_reason: {
          type: String,
          default: null,
        },
        archived_by_user_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'users',
          default: null,
        },
        replaced_by_file_key: {
          type: String,
          default: null,
        },
      },
    ],
    cuisine: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'cuisines',
        required: true,
      },
    ],
    addOns: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'add-ons',
      },
    ],
    locations: [
      {
        title: {
          type: String,
          default: null,
        },
        address: {
          type: String,
          default: null,
        },
        lat: {
          type: String,
          default: null,
        },
        long: {
          type: String,
          default: null,
        },
        zipcode: {
          type: String,
          default: null,
        },
        isOrderingOpen: {
          type: Boolean,
          default: false,
        },
      },
    ],
	    availability: [
	      {
	        day: {
	          type: String,
          enum: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        },
        locationId: {
          type: String,
          default: null,
        },
        truckUnitId: {
          type: String,
          default: null,
        },
        startTime: {
          type: String,
          default: null,
        },
        endTime: {
          type: String,
          default: null,
        },
        available: {
          type: Boolean,
          default: true,
	        },
	      },
	    ],
	    availabilityHistory: [
	      {
	        archivedAt: {
	          type: Date,
	          default: Date.now,
	        },
	        changedByUserId: {
	          type: mongoose.Schema.Types.ObjectId,
	          ref: 'users',
	          default: null,
	        },
	        changedDay: {
	          type: String,
	          default: null,
	        },
	        previousAvailability: {
	          type: Array,
	          default: [],
	        },
	        newAvailability: {
	          type: Array,
	          default: [],
	        },
	      },
	    ],
    schedule_time_zone: {
      type: String,
      default: null,
    },
    schedule_time_zone_source: {
      type: String,
      enum: ['CITY_STATE', 'STATE', 'FALLBACK', 'GOOGLE', null],
      default: null,
    },
    schedule_address_signature: {
      type: String,
      default: null,
    },
    schedule_time_zone_updated_at: {
      type: Date,
      default: null,
    },
	    businessHours: [
      {
        locationId: {
          type: String,
          default: null,
        },
        startTime: {
          type: String,
          default: null,
        },
        endTime: {
          type: String,
          default: null,
        },
        available: {
          type: Boolean,
          default: true,
        },
      },
    ],
    ein: {
      type: String,
      default: null,
    },
    ssn: {
      type: String,
      default: null,
    },
    tax_identifier_type: {
      type: String,
      enum: ['EIN', 'SSN', null],
      default: null,
    },
    tax_identifier_encrypted: {
      type: String,
      default: null,
      select: false,
    },
    tax_identifier_masked: {
      type: String,
      default: null,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    inactive: {
      type: Boolean,
      required: false,
      default: true,
    },
    verified: {
      type: Boolean,
      default: true,
      required: false,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('food-trucks', mSchema);
