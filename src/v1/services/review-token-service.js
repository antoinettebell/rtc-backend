const crypto = require('crypto');
const { ReviewTokenModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

const TOKEN_TTL_DAYS = Number(process.env.WALKUP_REVIEW_TOKEN_TTL_DAYS || 14);

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');

const createRawToken = () => crypto.randomBytes(32).toString('hex');

class ReviewTokenService extends BaseService {
  constructor() {
    super(Model);
  }

  hashToken(token) {
    return hashToken(token);
  }

  async createForWalkUpOrder(order) {
    const now = new Date();
    const rawToken = createRawToken();
    const expiresAt = new Date(
      now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    );

    await Model.create({
      token_hash: hashToken(rawToken),
      orderId: order._id,
      foodTruckId: order.foodTruckId,
      guest_phone: order.guestCustomer?.phone || null,
      expires_at: expiresAt,
    });

    return rawToken;
  }

  async getValidByToken(rawToken) {
    if (!rawToken) {
      return null;
    }

    return Model.findOne({
      token_hash: hashToken(rawToken),
      used_at: null,
      expires_at: { $gt: new Date() },
    }).lean();
  }

  async consume(rawToken, reviewId) {
    if (!rawToken) {
      return null;
    }

    return Model.findOneAndUpdate(
      {
        token_hash: hashToken(rawToken),
        used_at: null,
        expires_at: { $gt: new Date() },
      },
      {
        $set: {
          used_at: new Date(),
          review_id: reviewId,
        },
      },
      { new: true }
    );
  }
}

module.exports = new ReviewTokenService();
