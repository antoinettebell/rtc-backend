/**
 * Mongoose model for user collection
 */
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { JWT } = require('../config');
const bcrypt = require('bcrypt');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    email: {
      type: String,
      default: null,
    },
    profilePic: {
      type: String,
      default: null,
    },
    password: {
      type: String,
      default: null,
    },
    firstName: {
      type: String,
      default: null,
    },
    lastName: {
      type: String,
      default: null,
    },
    countryCode: {
      type: String,
      default: null,
    },
    mobileNumber: {
      type: String,
      default: null,
    },
    userType: {
      type: String,
      enum: ['SUPER_ADMIN', 'VENDOR', 'CUSTOMER'],
      default: 'CUSTOMER',
    },
    requestStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    changePassToken: {
      type: String,
      required: false,
    },
    reasonForRejection: {
      type: String,
      default: null,
    },
    inactive: {
      type: Boolean,
      required: false,
      default: false,
    },
    verified: {
      type: Boolean,
      default: false,
      required: false,
    },
    subscribedForOffGrid: {
      type: Boolean,
      default: false,
      required: false,
    },
      addressLine1: {
        type: String,
        default: 'NA',
      },
       addressLine2: {
        type: String,
        default: '',
      },
      addressCity: {
        type: String,
        default: 'NA',
      },
      addressState: {
        type: String,
        default: 'NA',
      },
      addressCountry: {
        type: String,
        default: 'NA',
      },
      addressPostal: {
        type: String,
        default: 'NA',
      },
    fcmTokens: [
      {
        token: {
          type: String,
          default: null,
        },
        deviceId: {
          type: String,
          default: null,
        },
      },
    ],
    // mailing: {  
    //   address: {
    //     type: String,
    //     default: null,
    //   },
    //   city: {
    //     type: String,
    //     default: null,
    //   },
    //   state: {
    //     type: String,
    //     default: null,
    //   },
    //   country: {
    //     type: String,
    //     default: null,
    //   },
    //   zipcode: {
    //     type: String,
    //     default: null,
    //   },
    // },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-insert hook of collection
 * [NOTE]: DO NOT CONVERT IT TO ES6 FORMAT
 */
mSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

/**
 * Custom function injection to model
 * [NOTE]: DO NOT CONVERT IT TO ES6 FORMAT
 *
 * @returns {Promise<undefined|*>}
 */
mSchema.methods.generateAuthToken = async function () {
  return jwt.sign({ _id: this._id, userType: this.userType }, JWT.secret, {
    expiresIn: '168h',
  });
};

module.exports = new mongoose.model('users', mSchema);
