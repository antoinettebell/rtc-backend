const { ReviewModel: Model, FoodTruckModel } = require('../../models');
const { BaseService } = require('../../common-services');
const mongoose = require('mongoose');

class ReviewService extends BaseService {
  constructor() {
    super(Model);
  }

  async getStats(ftId) {
    return await Model.aggregate([
      {
        $match: {
          foodTruckId: new mongoose.Types.ObjectId(ftId),
          status: 'PUBLISHED',
          deletedAt: null,
          rate: { $in: [1, 2, 3, 4, 5] },
        },
      },
      {
        $group: {
          _id: null,
          avgRate: { $avg: '$rate' },
          totalReviews: { $sum: 1 },
          star1: { $sum: { $cond: [{ $eq: ['$rate', 1] }, 1, 0] } },
          star2: { $sum: { $cond: [{ $eq: ['$rate', 2] }, 1, 0] } },
          star3: { $sum: { $cond: [{ $eq: ['$rate', 3] }, 1, 0] } },
          star4: { $sum: { $cond: [{ $eq: ['$rate', 4] }, 1, 0] } },
          star5: { $sum: { $cond: [{ $eq: ['$rate', 5] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          avgRate: 1,
          totalReviews: 1,
          star1: 1,
          star2: 1,
          star3: 1,
          star4: 1,
          star5: 1,
        },
      },
    ]);
  }

  async recalculateVendorRating(foodTruckId) {
    if (!mongoose.Types.ObjectId.isValid(foodTruckId)) {
      throw new Error('Invalid food truck ID');
    }

    const [summary] = await Model.aggregate([
      {
        $match: {
          foodTruckId: new mongoose.Types.ObjectId(foodTruckId),
          status: 'PUBLISHED',
          deletedAt: null,
          rate: { $in: [1, 2, 3, 4, 5] },
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rate' },
          reviewCount: { $sum: 1 },
        },
      },
    ]);

    const vendorRating = {
      averageRating: summary?.averageRating ?? null,
      reviewCount: summary?.reviewCount || 0,
    };

    await FoodTruckModel.findByIdAndUpdate(foodTruckId, {
      $set: vendorRating,
    });

    return vendorRating;
  }
}

module.exports = new ReviewService();
