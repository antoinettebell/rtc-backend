const { FavoriteFoodTruckModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');
const mongoose = require('mongoose');

class FavoriteFoodTruckService extends BaseService {
  constructor() {
    super(Model);
  }

  async getWithDetail(limit, page, search, userId) {
    let q = {};

    if (search?.trim()) {
      q = {
        $or: [
          {
            'foodTruck.name': {
              $regex: search.trim().toLowerCase(),
              $options: 'i',
            },
          },
        ],
      };
    }

    q['userId'] = new mongoose.Types.ObjectId(userId.toString());

    return (
      await Model.aggregate([
        {
          $lookup: {
            from: 'food-trucks',
            localField: 'foodTruckId',
            foreignField: '_id',
            as: 'foodTruck',
          },
        },
        {
          $unwind: '$foodTruck',
        },
        {
          $lookup: {
            from: 'reviews',
            localField: 'foodTruck._id',
            foreignField: 'foodTruckId',
            as: 'reviews',
          },
        },
        {
          $addFields: {
            'foodTruck.avgRate': {
              $cond: [
                { $gt: [{ $size: '$reviews' }, 0] },
                { $round: [{ $avg: '$reviews.rate' }, 1] },
                0,
              ],
            },
            'foodTruck.totalReviews': { $size: '$reviews' },
          },
        },
        {
          $match: { ...q },
        },
        { $sort: { createdAt: -1 } },
        { $project: { reviews: 0 } },
        {
          $facet: {
            data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
        {
          $project: {
            data: 1,
            total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
          },
        },
      ])
    )[0];
  }
}

module.exports = new FavoriteFoodTruckService();
