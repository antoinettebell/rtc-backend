/**
 * Mongoose model for food-truck collection
 */
const mongoose = require('mongoose');

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
    photos: [
      {
        type: String,
        default: null,
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
