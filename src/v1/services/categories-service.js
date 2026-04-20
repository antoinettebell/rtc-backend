const { categoriesModel: Model,MenuCategoryModel } = require('../../models');
const { BaseService } = require('../../common-services');
const mongoose = require('mongoose');

class CategoriesService extends BaseService {
  constructor() {
    super(Model);
  }

async getCategoriesCount({ categoriesId }) {
  const categoryObjectId = new mongoose.Types.ObjectId(categoriesId.toString());
  // Aggregate to directly count menu-categories with menu items
  const result = await MenuCategoryModel.aggregate([
    { $match: { categoriesId: categoryObjectId, deletedAt: null } },
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
                  { $eq: ['$deletedAt', null] },
                ],
              },
            },
          },
        ],
        as: 'menuItems',
      },
    },
    {
      $match: {
        'menuItems.0': { $exists: true },
      },
    },
    {
      $count: 'count',
    },
  ]);

  return result.length > 0 ? result[0].count : 0;
}


}

module.exports = new CategoriesService();
