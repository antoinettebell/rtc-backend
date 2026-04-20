const { MenuItemModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');

class MenuItemService extends BaseService {
  constructor() {
    super(Model);
  }

  /**
   * Unified BOGO Response Structure for Frontend:
   * --------------------------------------------
   * bogoItems: [
   *   {
   *     _id: string, (itemId or parent item'._id if isSameItem)
   *     name: string,
   *     description: string,
   *     imgUrls: string[],
   *     price: number,
   *     qty: number,
   *     isSameItem: boolean,
   *     // ... all other menu item fields are included
   *   }
   * ]
   */

  async getWithFoodTruck(match) {
    return await Model.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'food-trucks',
          localField: 'userId',
          foreignField: 'userId',
          as: 'foodTruck',
        }
      },
      { $unwind: { path: '$foodTruck', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'menu-items',
          localField: 'bogoItems.itemId',
          foreignField: '_id',
          as: 'bogoItemDetails',
        },
      },
      {
        $lookup: {
          from: 'menu-items',
          localField: 'subItem.menuItem',
          foreignField: '_id',
          as: 'subItemDetails',
        },
      },
      {
        $addFields: {
          bogoItems: {
            $filter: {
              input: "$bogoItems",
              as: "bogo",
              cond: {
                $or: [
                  { $eq: ["$$bogo.isSameItem", true] },
                  { $ne: ["$$bogo.itemId", null] },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          bogoItems: {
            $map: {
              input: "$bogoItems",
              as: "bogo",
              in: {
                $let: {
                  vars: {
                    matched: {
                      $cond: {
                        if: { $eq: ["$$bogo.isSameItem", true] },
                        then: {
                          name: "$name",
                          description: "$description",
                          imgUrls: "$imgUrls",
                          price: { $ifNull: ["$strikePrice", "$price"] },
                          strikePrice: "$strikePrice",
                          discountType: "$discountType",
                          hasDiscount: "$hasDiscount",
                          discountRules: "$discountRules",
                          available: "$available",
                          itemType: "$itemType",
                          categoryId: "$categoryId",
                          meatId: "$meatId",
                          diet: "$diet",
                          predefinedDiscountId: "$predefinedDiscountId",
                          minQty: "$minQty",
                          maxQty: "$maxQty",
                        },
                        else: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: "$bogoItemDetails",
                                as: "details",
                                cond: {
                                  $eq: ["$$details._id", "$$bogo.itemId"],
                                },
                              },
                            },
                            0,
                          ],
                        },
                      },
                    },
                  },
                  in: {
                    $mergeObjects: [
                      "$$matched",
                      {
                        _id: {
                          $cond: {
                            if: { $eq: ["$$bogo.isSameItem", true] },
                            then: "$_id",
                            else: "$$bogo.itemId",
                          },
                        },
                        qty: "$$bogo.qty",
                        isSameItem: { $ifNull: ["$$bogo.isSameItem", false] },
                      }
                    ]
                  },
                },
              },
            },
          },
          subItem: {
            $map: {
              input: '$subItem',
              as: 'sub',
              in: {
                $let: {
                  vars: {
                    matched: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$subItemDetails',
                            as: 'details',
                            cond: { $eq: ['$$details._id', '$$sub.menuItem'] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: {
                    $mergeObjects: [
                      "$$matched",
                      {
                        _id: '$$sub.menuItem',
                        qty: '$$sub.qty',
                      }
                    ]
                  },
                },
              },
            },
          },
        },
      },
      { $project: { bogoItemDetails: 0, subItemDetails: 0 } },
    ]);
  }

  async getLimitedDistinct(limit, search,restrictedDiets=[]) {
 
    let q = {};
    if (search) {
      q = { name: { $regex: search.trim().toLowerCase(), $options: 'i' } };
    }
    if (restrictedDiets.length > 0) {
      q.diet = { $not: { $elemMatch: { $in: restrictedDiets } } };
    }
    q['foodTruck.inactive'] = false;
    q['foodTruck.verified'] = true;
    q['available'] = true;
    return await Model.aggregate([
      {
        $lookup: {
          from: 'food-trucks',
          localField: 'userId',
          foreignField: 'userId',
          as: 'foodTruck',
        },
      },
      { $unwind: '$foodTruck' },
      { $match: { ...q } },
      {
        $group: {
          _id: '$name',
          doc: { $first: '$$ROOT' },
        },
      },
      {
        $replaceRoot: { newRoot: '$doc' },
      },
      {
        $project: {
          'foodTruck.cuisine': 0,
          'foodTruck.locations': 0,
          'foodTruck.availability': 0,
          'foodTruck.businessHours': 0,
        },
      },
      {
        $limit: +limit,
      },
      {
        $lookup: {
          from: 'menu-items',
          localField: 'bogoItems.itemId',
          foreignField: '_id',
          as: 'bogoItemDetails',
        },
      },
      {
        $addFields: {
          bogoItems: {
            $map: {
              input: "$bogoItems",
              as: "bogo",
              in: {
                $let: {
                  vars: {
                    matched: {
                      $cond: {
                        if: { $eq: ["$$bogo.isSameItem", true] },
                        then: {
                          name: "$name",
                          description: "$description",
                          imgUrls: "$imgUrls",
                          price: { $ifNull: ["$strikePrice", "$price"] },
                          strikePrice: "$strikePrice",
                          discountType: "$discountType",
                          hasDiscount: "$hasDiscount",
                          discountRules: "$discountRules",
                          available: "$available",
                          itemType: "$itemType",
                          categoryId: "$categoryId",
                          meatId: "$meatId",
                          diet: "$diet",
                          predefinedDiscountId: "$predefinedDiscountId",
                          minQty: "$minQty",
                          maxQty: "$maxQty",
                        },
                        else: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: "$bogoItemDetails",
                                as: "details",
                                cond: {
                                  $eq: ["$$details._id", "$$bogo.itemId"],
                                },
                              },
                            },
                            0,
                          ],
                        },
                      },
                    },
                  },
                  in: {
                    $mergeObjects: [
                      "$$matched",
                      {
                        _id: {
                          $cond: {
                            if: { $eq: ["$$bogo.isSameItem", true] },
                            then: "$_id",
                            else: "$$bogo.itemId",
                          },
                        },
                        qty: "$$bogo.qty",
                        isSameItem: { $ifNull: ["$$bogo.isSameItem", false] },
                      }
                    ]
                  },
                },
              },
            },
          },
        },
      },
      { $project: { bogoItemDetails: 0 } },
    ]);
  }
}

module.exports = new MenuItemService();
