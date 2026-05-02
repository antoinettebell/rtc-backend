const { OrderModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');
const mongoose = require('mongoose');

class OrderService extends BaseService {
  constructor() {
    super(Model);
  }

  async getWithAllDetails(
    limit = 10,
    page,
    user,
    search,
    id,
    orderStatus = null,
    advance = undefined
  ) {
    const skip = (+page - 1) * limit;
    let q = {};
    if (user?.userType === 'CUSTOMER') {
      q.userId = new mongoose.Types.ObjectId(user._id);
    }
    if (user?.userType === 'VENDOR') {
      q['foodTruck.userId'] = new mongoose.Types.ObjectId(user._id);
    }
    if (id) {
      q['_id'] = new mongoose.Types.ObjectId(id);
    }
    if (orderStatus && orderStatus.length) {
      q['orderStatus'] = { $in: orderStatus };
    }
    if (
      !id &&
      user?.userType !== 'CUSTOMER' &&
      [true, 'true', 1, false, 'false', 0].includes(advance)
    ) {
      if ([true, 'true', 1].includes(advance)) {
        q['availabilityId'] = { $ne: null };
      } else {
        q['availabilityId'] = null;
      }
    }
    if (search?.trim()) {
      q['$or'] = [
        {
          'user.email': { $regex: search.trim().toLowerCase(), $options: 'i' },
        },
        {
          'user.firstName': {
            $regex: search.trim().toLowerCase(),
            $options: 'i',
          },
        },
        {
          'user.lastName': {
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
        {
          'menuItems.name': {
            $regex: search.trim().toLowerCase(),
            $options: 'i',
          },
        },
      ];
    }
    // const data = (
    //   await Model.aggregate([
    //     {
    //       $lookup: {
    //         from: 'food-trucks',
    //         localField: 'foodTruckId',
    //         foreignField: '_id',
    //         as: 'foodTruck',
    //       },
    //     },
    //     { $unwind: '$foodTruck' },
    //     {
    //       $lookup: {
    //         from: 'users',
    //         localField: 'foodTruck.userId',
    //         foreignField: '_id',
    //         as: 'vendor',
    //       },
    //     },
    //     { $unwind: '$vendor' },
    //     {
    //       $lookup: {
    //         from: 'users',
    //         localField: 'userId',
    //         foreignField: '_id',
    //         as: 'user',
    //       },
    //     },
    //     { $unwind: '$user' },
    //     {
    //       $lookup: {
    //         from: 'menu-items',
    //         localField: 'items.menuItemId',
    //         foreignField: '_id',
    //         as: 'menuItems',
    //       },
    //     },
    //     {
    //       $lookup: {
    //         from: 'reviews',
    //         let: { orderId: '$_id', userId: '$userId' },
    //         pipeline: [
    //           {
    //             $match: {
    //               $expr: {
    //                 $and: [
    //                   { $eq: ['$orderId', '$$orderId'] },
    //                   {
    //                     $eq: ['$userId', new mongoose.Types.ObjectId(user._id)],
    //                   },
    //                 ],
    //               },
    //             },
    //           },
    //         ],
    //         as: 'reviews',
    //       },
    //     },
    //     {
    //       $addFields: {
    //         hasReview: { $gt: [{ $size: '$reviews' }, 0] },
    //       },
    //     },
    //     { $match: { ...q } },
    //     { $sort: { createdAt: -1 } },
    //     {
    //       $project: {
    //         'user.password': 0,
    //         'user.requestStatus': 0,
    //         'user.verified': 0,
    //         'user.inactive': 0,
    //         'vendor.password': 0,
    //         'vendor.requestStatus': 0,
    //         'vendor.verified': 0,
    //         'vendor.inactive': 0,
    //         'foodTruck.inactive': 0,
    //         reviews: 0,
    //       },
    //     },
    //     {
    //       $facet: {
    //         metaData: [
    //           { $group: { _id: null, total: { $sum: 1 } } },
    //           {
    //             $project: {
    //               _id: 0,
    //               total: '$total',
    //             },
    //           },
    //         ],
    //         records: [{ $skip: skip }, { $limit: +limit }],
    //       },
    //     },
    //   ])
    // )[0];
    const data = (
  await Model.aggregate([
    {
      $lookup: {
        from: 'food-trucks',
        localField: 'foodTruckId',
        foreignField: '_id',
        as: 'foodTruck',
      },
    },
    { $unwind: '$foodTruck' },
    {
      $lookup: {
        from: 'users',
        localField: 'foodTruck.userId',
        foreignField: '_id',
        as: 'vendor',
      },
    },
    { $unwind: '$vendor' },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },

    // ✅ menu-items with nested bogoItems details
    // {
    //   $lookup: {
    //     from: 'menu-items',
    //     localField: 'items.menuItemId',
    //     foreignField: '_id',
    //     as: 'menuItems',
    //     pipeline: [
    //       {
    //         $lookup: {
    //           from: 'menu-items',
    //           localField: 'bogoItems.itemId',
    //           foreignField: '_id',
    //           as: 'bogoItemDetails',
    //           pipeline: [
    //             {
    //               $project: {
    //                 _id: 1,
    //                 name: 1,
    //                 imgUrls: 1,
    //               },
    //             },
    //           ],
    //         },
    //       },
    //       {
    //         $addFields: {
    //           bogoItems: {
    //             $map: {
    //               input: '$bogoItems',
    //               as: 'bogo',
    //               in: {
    //                 $mergeObjects: [
    //                   '$$bogo',
    //                   {
    //                     details: {
    //                       $filter: {
    //                         input: '$bogoItemDetails',
    //                         as: 'detail',
    //                         cond: { $eq: ['$$detail._id', '$$bogo.itemId'] },
    //                       },
    //                     },
    //                   },
    //                 ],
    //               },
    //             },
    //           },
    //         },
    //       },
    //       { $project: { bogoItemDetails: 0 } },
    //     ],
    //   },
    // },
{
      $lookup: {
        from: 'menu-items',
        localField: 'items.menuItemId',
        foreignField: '_id',
        as: 'menuItems',
        pipeline: [
          {
            $lookup: {
              from: 'menu-items',
              localField: 'bogoItems.itemId',
              foreignField: '_id',
              as: 'bogoItemDetails',
              pipeline: [
                {
                  $project: {
                    _id: 1,
                    name: 1,
                    price:1,
                    imgUrls: 1,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              bogoItems: {
                $map: {
                  input: '$bogoItems',
                  as: 'bogo',
                  in: {
                    $mergeObjects: [
                      '$$bogo',
                      {
                        // Flatten details from lookup
                        name: {
                          $arrayElemAt: [
                            {
                              $map: {
                                input: {
                                  $filter: {
                                    input: '$bogoItemDetails',
                                    as: 'detail',
                                    cond: { $eq: ['$$detail._id', '$$bogo.itemId'] },
                                  },
                                },
                                as: 'filtered',
                                in: '$$filtered.name',
                              },
                            },
                            0,
                          ],
                        },
                        imgUrls: {
                          $arrayElemAt: [
                            {
                              $map: {
                                input: {
                                  $filter: {
                                    input: '$bogoItemDetails',
                                    as: 'detail',
                                    cond: { $eq: ['$$detail._id', '$$bogo.itemId'] },
                                  },
                                },
                                as: 'filtered',
                                in: '$$filtered.imgUrls',
                              },
                            },
                            0,
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          { $project: { bogoItemDetails: 0 } },
        ],
      },
    },
    // ✅ lookup for reviews by current user
    {
      $lookup: {
        from: 'reviews',
        let: { orderId: '$_id', userId: '$userId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$orderId', '$$orderId'] },
                  { $eq: ['$userId', new mongoose.Types.ObjectId(user._id)] },
                ],
              },
            },
          },
        ],
        as: 'reviews',
      },
    },
    {
      $addFields: {
        hasReview: { $gt: [{ $size: '$reviews' }, 0] },
      },
    },

    { $match: { ...q } },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        'user.password': 0,
        'user.requestStatus': 0,
        'user.verified': 0,
        'user.inactive': 0,
        'vendor.password': 0,
        'vendor.requestStatus': 0,
        'vendor.verified': 0,
        'vendor.inactive': 0,
        'foodTruck.inactive': 0,
        reviews: 0,
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
      data: (data?.records || []).map((item) => {
        item.items = (item.items || []).map((it) => {
          it.menuItem =it.fullMenuItemData;
          // it.menuItem = (item.menuItems || []).find(
          //   (mi) => mi._id.toString() === it.menuItemId.toString()
          // );
          delete it.fullMenuItemData;

          return it;
        });

        delete item.menuItems;
        return item;
      }),
      total: data?.metaData?.[0]?.total || 0,
    };
  }

  async getVendorEarningsWithFreeDessert(foodTruckId, startDate, endDate) {
    const matchQuery = {
      foodTruckId: new mongoose.Types.ObjectId(foodTruckId),
      orderStatus: 'COMPLETED',
      deletedAt: null,
    };

    if (startDate && endDate) {
      matchQuery.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const earnings = await Model.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$total' },
          totalFreeDessertAmount: { 
            $sum: { 
              $cond: [
                { $eq: ['$freeDessertApplied', true] },
                '$freeDessertAmount',
                0
              ]
            }
          },
          freeDessertOrders: {
            $sum: {
              $cond: [
                { $eq: ['$freeDessertApplied', true] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const result = earnings[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      totalFreeDessertAmount: 0,
      freeDessertOrders: 0
    };

    // Calculate admin payment (total revenue + free dessert amounts)
    result.adminPayment = result.totalRevenue + result.totalFreeDessertAmount;

    return result;
  }

    async getVendorEarningsWithFreeDessertTest(foodTruckId) {
    const baseMatch = {
      foodTruckId: new mongoose.Types.ObjectId(foodTruckId),
      orderStatus: 'COMPLETED',
      deletedAt: null,
    };

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const startOfWeek = new Date();
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date();
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    // Helper function to get earnings for a range
    const getEarningsInRange = async (startDate, endDate) => {
      const matchQuery = {
        ...baseMatch,
        createdAt: { $gte: startDate, $lte: endDate }
      };

      const data = await Model.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: '$total' },
            totalFreeDessertAmount: {
              $sum: {
                $cond: [{ $eq: ['$freeDessertApplied', true] }, '$freeDessertAmount', 0]
              }
            },
            freeDessertOrders: {
              $sum: {
                $cond: [{ $eq: ['$freeDessertApplied', true] }, 1, 0]
              }
            }
          }
        }
      ]);

      const result = data[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        totalFreeDessertAmount: 0,
        freeDessertOrders: 0
      };

      result.adminPayment = result.totalRevenue + result.totalFreeDessertAmount;
      return result;  
    };

    // Calculate all periods
    const [total, todayEarning, weeklyEarning, monthlyEarning] = await Promise.all([
      getEarningsInRange(new Date(0), new Date()), // all time
      getEarningsInRange(startOfDay, endOfDay),
      getEarningsInRange(startOfWeek, endOfWeek),
      getEarningsInRange(startOfMonth, endOfMonth)
    ]);

    return {
      totalEarning: total.adminPayment,
      todayEarning: todayEarning.adminPayment,
      weeklyEarning: weeklyEarning.adminPayment,  
      monthlyEarning: monthlyEarning.adminPayment,
      desserts: {
        totalFreeDessertAmount: total.totalFreeDessertAmount,
        freeDessertOrders: total.freeDessertOrders,
      }
    };
  }

async getVendorEarningList(
  limit = 10,
  page = 1,
  user,
  search,
  foodTruckId,
  earning_list,
  is_list = 'normal',
  startDate = null,
  endDate = null
) {
  const today = new Date();

  // Define date ranges
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

  // Choose range based on earning_list
  // let startDate, endDate;
  // switch (earning_list?.toLowerCase()) {
  //   case 'daily':
  //     startDate = startOfDay;
  //     endDate = endOfDay;
  //     break;
  //   case 'weekly':
  //     startDate = startOfWeek;
  //     endDate = endOfWeek;
  //     break;
  //   case 'monthly':
  //     startDate = startOfMonth;
  //     endDate = endOfMonth;
  //     break;
  //   default:
  //     startDate = new Date(0);
  //     endDate = new Date();
  //     break;
  // }
if (startDate && endDate) {
    // startDate = new Date(startDate);
    // endDate = new Date(endDate);
    startDate = new Date(`${startDate}T00:00:00.000Z`); // Start of day UTC
    endDate = new Date(`${endDate}T23:59:59.999Z`);     // End of day UTC
  
  } else {
    // Otherwise use default logic based on earning_list
    switch (earning_list?.toLowerCase()) {
      case 'daily':
        startDate = startOfDay;
        endDate = endOfDay;
        break;
      case 'weekly':
        startDate = startOfWeek;
        endDate = endOfWeek;
        break;
      case 'monthly':
        startDate = startOfMonth;
        endDate = endOfMonth;
        break;
      default:
        startDate = new Date(0);
        endDate = new Date();
        break;
    }
  }

  // Query condition
  const q = {
    foodTruckId: new mongoose.Types.ObjectId(foodTruckId),
    orderStatus: 'COMPLETED',
    deletedAt: null,
    createdAt: { $gte: startDate, $lte: endDate },
  };

  // Filter only dessert orders if requested
  if (is_list === 'dessert') {
    q['freeDessertApplied'] = true;
  }

  const skip = (page - 1) * limit;

  // Aggregation pipeline
  const pipeline = [
    { $match: q },
    {
      $facet: {
        data: [
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: Number(limit) },
        ],
        totals: [
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalRevenue: { $sum: '$total' },
              totalFreeDessertAmount: {
                $sum: {
                  $cond: [
                    { $eq: ['$freeDessertApplied', true] },
                    '$freeDessertAmount',
                    0,
                  ],
                },
              },
               freeDessertOrders: {
              $sum: {
                $cond: [{ $eq: ['$freeDessertApplied', true] }, 1, 0]
              }
            },
            codRevenue: {
              $sum: {
                $cond: [
                  { $in: ['$paymentMethod', ['COD', 'CASH']] },
                  '$total',
                  0
                ]
              }
            },
            digitalRevenue: {
              $sum: {
                $cond: [
                  { $in: ['$paymentMethod', ['APPLE_PAY', 'GOOGLE_PAY', 'CARD', 'TAP_TO_PAY', 'STRIPE']] },
                  '$total',
                  0
                ]
              }
            },
            codOrders: {
              $sum: {
                $cond: [
                  { $in: ['$paymentMethod', ['COD', 'CASH']] },
                  1,
                  0
                ]
              }
            },
            digitalOrders: {
              $sum: {
                $cond: [
                  { $in: ['$paymentMethod', ['APPLE_PAY', 'GOOGLE_PAY', 'CARD', 'TAP_TO_PAY', 'STRIPE']] },
                  1,
                  0
                ]
              }
            }
            },
          },
        ],
      },
    },
    {
      $project: {
        data: 1,
        totalOrders: { $ifNull: [{ $arrayElemAt: ['$totals.totalOrders', 0] }, 0] },
        totalRevenue: { $ifNull: [{ $arrayElemAt: ['$totals.totalRevenue', 0] }, 0] },
        totalFreeDessertAmount: {
          $ifNull: [{ $arrayElemAt: ['$totals.totalFreeDessertAmount', 0] }, 0],
        },
        freeDessertOrders: { $ifNull: [{ $arrayElemAt: ['$totals.freeDessertOrders', 0] }, 0] },
        codRevenue: { $ifNull: [{ $arrayElemAt: ['$totals.codRevenue', 0] }, 0] },
        digitalRevenue: { $ifNull: [{ $arrayElemAt: ['$totals.digitalRevenue', 0] }, 0] },
        codOrders: { $ifNull: [{ $arrayElemAt: ['$totals.codOrders', 0] }, 0] },
        digitalOrders: { $ifNull: [{ $arrayElemAt: ['$totals.digitalOrders', 0] }, 0] },

      },
    },
  ];

  const result = await Model.aggregate(pipeline);
  const response =
    result[0] || { 
      data: [], 
      totalOrders: 0, 
      totalRevenue: 0, 
      totalFreeDessertAmount: 0,
      freeDessertOrders: 0,
      codRevenue: 0,
      digitalRevenue: 0,
      codOrders: 0,
      digitalOrders: 0
    };

  return {
    data: response.data,
    total: response.totalOrders,
    earning_total:
      is_list === 'dessert' ? response.totalFreeDessertAmount : response.totalRevenue,
    totalFreeDessertAmount: response.totalFreeDessertAmount,
    totalFreeDessertCount: response.freeDessertOrders,
    cashEarning: response.codRevenue,
    cashTotalOrder:response.codOrders,
    digitalEarning: response.digitalRevenue,
    digitalTotalOrder: response.digitalOrders
  };
}

  async getHomeCountInRange(foodTruckId, startDate, endDate) {
    const result = await Model.aggregate([
      {
        $match: {
          foodTruckId: new mongoose.Types.ObjectId(foodTruckId),
          deletedAt: null,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSales: {
            $sum: { $cond: [{ $eq: ['$orderStatus', 'COMPLETED'] }, '$total', 0] }
          },
          deliveredDessertsCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$orderStatus', 'COMPLETED'] }, { $eq: ['$freeDessertApplied', true] }] },
                1,
                0
              ]
            }
          },
          deliveredDessertsSum: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$orderStatus', 'COMPLETED'] }, { $eq: ['$freeDessertApplied', true] }] },
                '$freeDessertAmount',
                0
              ]
            }
          },
          activeCustomers: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          _id: 0,
          totalOrders: 1,
          totalSales: 1,
          deliveredDessertsCount: 1,
          deliveredDessertsSum: 1,
          activeCustomerCount: { $size: '$activeCustomers' }
        }
      }
    ]);

    return result[0] || {
      totalOrders: 0,
      totalSales: 0,
      deliveredDessertsCount: 0,
      deliveredDessertsSum: 0,
      activeCustomerCount: 0
    };
  }

  async getVendorDashboardCountDetails(foodTruckId) {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
     const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
     const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    const [todayData, monthlyData] = await Promise.all([
      this.getHomeCountInRange(foodTruckId, startOfDay, endOfDay),
      this.getHomeCountInRange(foodTruckId, startOfMonth, endOfMonth)
    ]);

    return {
      todaySales: todayData.totalSales,
      todayTotalOrders: todayData.totalOrders,
      todayActiveCustomers: todayData.activeCustomerCount,
      monthlyEarning: monthlyData.totalSales,
      monthlyDeliveredDessertsCount: monthlyData.deliveredDessertsCount,
      monthlyDeliveredDessertsSum: monthlyData.deliveredDessertsSum,
      monthlyActiveCustomers: monthlyData.activeCustomerCount
    };
  }


}

module.exports = new OrderService();
