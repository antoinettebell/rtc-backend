const { UserModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class UserService extends BaseService {
  constructor() {
    super(Model);
  }

  async getVendorWithFoodTruck(
    limit = 10,
    page = 1,
    search,
    status,
    inactive,
    profileComplete
  ) {
    const skip = (+page - 1) * limit;
    let q = {};
    if (search && search.trim()) {
      q = {
        $or: [
          { email: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          { firstName: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          { lastName: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          {
            mobileNumber: {
              $regex: search.trim().toLowerCase(),
              $options: 'i',
            },
          },
          {
            'foodTruck.name': {
              $regex: search.trim().toLowerCase(),
              $options: 'i',
            },
          },
        ],
      };
    }
    q['$and'] = [
      { userType: 'VENDOR' },
      ...(status ? [{ requestStatus: status }] : []),
      ...(inactive === 'inactive' ? [{ inactive: true }] : []),
    ];
    if (profileComplete) {
      q['foodTruck.completed'] = profileComplete === 'COMPLETE';
    }
    const data = (
      await Model.aggregate([
        {
          $lookup: {
            from: 'food-trucks',
            localField: '_id',
            foreignField: 'userId',
            as: 'foodTruck',
          },
        },
        { $unwind: '$foodTruck' },
        {
          $lookup: {
            from: 'plans',
            localField: 'foodTruck.planId',
            foreignField: '_id',
            as: 'foodTruck.plan',
          },
        },
        {
          $unwind: {
            path: '$foodTruck.plan',
            preserveNullAndEmptyArrays: true,
          },
        },
        { $match: q },
        { $sort: { createdAt: -1 } },
        { $project: { password: 0, changePassToken: 0 } },
        {
          $facet: {
            metaData: [
              { $group: { _id: null, total: { $sum: 1 } } },
              {
                $project: {
                  _id: 0,
                  total: '$total',
                },
              },
            ],
            records: [{ $skip: skip }, { $limit: +limit }],
          },
        },
      ])
    )[0];

    return {
      data: data?.records || [],
      total: data?.metaData?.[0]?.total || 0,
    };
  }

  async getVendorCountWithFoodTruck(status, inactive) {
    let q = {};
    q['$and'] = [
      { userType: 'VENDOR' },
      ...(status ? [{ requestStatus: status }] : []),
      ...(inactive === 'inactive' ? [{ inactive: true }] : []),
    ];

    const data = await Model.aggregate([
      {
        $lookup: {
          from: 'food-trucks',
          localField: '_id',
          foreignField: 'userId',
          as: 'foodTruck',
        },
      },
      { $unwind: '$foodTruck' },
      {
        $lookup: {
          from: 'plans',
          localField: 'foodTruck.planId',
          foreignField: '_id',
          as: 'foodTruck.plan',
        },
      },
      {
        $unwind: {
          path: '$foodTruck.plan',
          preserveNullAndEmptyArrays: true,
        },
      },
      { $match: q },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
        },
      },
    ]);

    return data[0]?.total || 0;
  }
}

module.exports = new UserService();
