const { MenuCategoryModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MenuCategoryService extends BaseService {
  constructor() {
    super(Model);
  }

  async getCategoryWithItemCount(limit = 10, page = 1, q) {
    const skip = (+page - 1) * limit;

    const data = (
      await Model.aggregate([
        {
          $lookup: {
            from: 'menu-items',
            let: { categoryId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$categoryId', '$$categoryId'] },
                      { $eq: ['$deletedAt', null] }, // Only include if deletedAt is null
                    ],
                  },
                },
              },
            ],
            as: 'menuItems',
          },
        },
        {
          $lookup: {
            from: 'categories',
            let: { categoriesId: '$categoriesId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$_id', '$$categoriesId'] },
                      { $eq: ['$deletedAt', null] },
                    ],
                  },
                },
              },
            ],
            as: 'categoryInfo',
          },
        },
        { $unwind: { path: '$categoryInfo'} },
        { $match: { ...q, deletedAt: null, categoriesId: { $ne: null } } },
        { $sort: { createdAt: -1 } },
        {
          $project: {
            _id: 1,
            createdAt: 1,
            updatedAt: 1,
            deletedAt: 1,
            userId: 1,
            categoriesId:1,
            name: '$categoryInfo.name',
            menuCount: { $size: '$menuItems' },
          },
        },
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
}

module.exports = new MenuCategoryService();
