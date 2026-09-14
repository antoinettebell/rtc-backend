const { OrderModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');
const mongoose = require('mongoose');
const {
  getOrderNetEarningsAmount,
  isCompletedOrder,
  isRefundedOrder,
  isRevenueOrder,
  summarizeVendorSales,
} = require('../../helper/vendor-sales-summary-helper');
const {
  getOperationalDayKey,
  getOperationalDayQueryEnvelope,
  isOperationalDayInRange,
} = require('../../helper/employee-operational-day-helper');

const cashPaymentMethods = ['COD', 'CASH'];
const digitalPaymentMethods = ['APPLE_PAY', 'GOOGLE_PAY', 'TAP_TO_PAY'];

class OrderService extends BaseService {
  constructor() {
    super(Model);
  }

  async getOrdersForOperationalRange({
    foodTruck,
    startDayKey,
    endDayKey = startDayKey,
    truckUnitId = null,
    locationId = null,
    paymentMethod = null,
  }) {
    const timeZone = foodTruck.schedule_time_zone || 'America/New_York';
    const { start, end } = getOperationalDayQueryEnvelope(
      startDayKey,
      endDayKey
    );
    const query = {
      foodTruckId: new mongoose.Types.ObjectId(foodTruck._id),
      deletedAt: null,
      createdAt: { $gte: start, $lt: end },
      ...(truckUnitId
        ? { truck_unit_id: new mongoose.Types.ObjectId(truckUnitId) }
        : {}),
      ...(locationId
        ? { $or: [{ locationId }, { location_id: locationId }] }
        : {}),
      ...(paymentMethod
        ? {
            $and: [
              { $or: [{ paymentMethod }, { payment_method: paymentMethod }] },
            ],
          }
        : {}),
    };
    const orders = await Model.find(query).lean();
    return orders.filter((order) =>
      isOperationalDayInRange({
        value: order.created_at || order.createdAt,
        startDayKey,
        endDayKey,
        timeZone,
      })
    );
  }

  getVendorEarningsResult(orders, foodTruck) {
    const summary = summarizeVendorSales({ orders, foodTruck });
    const eligibleDessertOrders = orders.filter(
      (order) =>
        order.freeDessertApplied === true &&
        isCompletedOrder(order) &&
        !isRefundedOrder(order)
    );
    const totalFreeDessertAmount = eligibleDessertOrders.reduce(
      (sum, order) => sum + Number(order.freeDessertAmount || 0),
      0
    );
    return {
      totalOrders: summary.orders,
      paidOrders: summary.paidOrders,
      totalRevenue: summary.netEarnings,
      adminPayment: summary.netEarnings,
      grossSales: summary.grossSales,
      averageTicket: summary.averageTicket,
      totalFreeDessertAmount: Number(totalFreeDessertAmount.toFixed(2)),
      freeDessertOrders: eligibleDessertOrders.length,
    };
  }

  async getWithAllDetails(
    limit = 10,
    page,
    user,
    search,
    id,
    orderStatus = null,
    advance = undefined,
    orderView = null
  ) {
    const skip = (+page - 1) * limit;
    let q = {};
    if (user?.userType === 'CUSTOMER') {
      q.userId = new mongoose.Types.ObjectId(user._id);
    }
    if (user?.userType === 'VENDOR') {
      q['foodTruck.userId'] = new mongoose.Types.ObjectId(user._id);
    }
    if (user?.userType === 'EMPLOYEE') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);
      q.foodTruckId = new mongoose.Types.ObjectId(user.food_truck_id);
      q.locationId = user.assigned_location_id;
      q.created_by_type = 'EMPLOYEE';
      q.employee_internal_id = user.employee_internal_id;
      q.$or = [
        { created_at: { $gte: startOfToday, $lt: endOfToday } },
        {
          created_at: null,
          createdAt: { $gte: startOfToday, $lt: endOfToday },
        },
      ];
    }
    if (id) {
      q['_id'] = new mongoose.Types.ObjectId(id);
    }
    if (orderStatus && orderStatus.length) {
      if (orderView === 'past') {
        q.$and = q.$and || [];
        q.$and.push({
          $or: [
            { orderStatus: { $in: orderStatus } },
            { paymentStatus: 'REFUNDED' },
          ],
        });
      } else {
        q['orderStatus'] = { $in: orderStatus };
      }
    }
    if (orderView === 'active') {
      q.paymentStatus = { $ne: 'REFUNDED' };
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

  async getVendorEarningsWithFreeDessert(
    foodTruck,
    startDate,
    endDate,
    truckUnitId = null,
    fallbackVendorTierRate = 0
  ) {
    const currentKey = getOperationalDayKey(
      new Date(),
      foodTruck.schedule_time_zone || 'America/New_York'
    );
    const orders = await this.getOrdersForOperationalRange({
      foodTruck,
      startDayKey: startDate || currentKey,
      endDayKey: endDate || currentKey,
      truckUnitId,
    });
    return this.getVendorEarningsResult(orders, foodTruck);
  }

  async getVendorSalesSummary({
    foodTruck,
    startDate,
    endDate,
    locationId = null,
    truckUnitId = null,
    paymentMethod = null,
  }) {
    const currentKey = getOperationalDayKey(
      new Date(),
      foodTruck.schedule_time_zone || 'America/New_York'
    );
    const orders = await this.getOrdersForOperationalRange({
      foodTruck,
      startDayKey: startDate || currentKey,
      endDayKey: endDate || currentKey,
      locationId,
      truckUnitId,
      paymentMethod,
    });

    return summarizeVendorSales({ orders, foodTruck });
  }

  async getVendorEarningsWithFreeDessertTest(
    foodTruck,
    fallbackVendorTierRate = 0,
    truckUnitId = null
  ) {
    const timeZone = foodTruck.schedule_time_zone || 'America/New_York';
    const currentKey = getOperationalDayKey(new Date(), timeZone);
    const currentDate = new Date(`${currentKey}T00:00:00.000Z`);
    const weekStart = new Date(currentDate);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const weekStartKey = weekStart.toISOString().slice(0, 10);
    const monthStartKey = `${currentKey.slice(0, 7)}-01`;
    const yearStartKey = `${currentKey.slice(0, 4)}-01-01`;
    const allOrders = await Model.find({
      foodTruckId: new mongoose.Types.ObjectId(foodTruck._id),
      deletedAt: null,
      ...(truckUnitId
        ? { truck_unit_id: new mongoose.Types.ObjectId(truckUnitId) }
        : {}),
    }).lean();
    const getRangeResult = async (startDayKey) =>
      this.getVendorEarningsResult(
        await this.getOrdersForOperationalRange({
          foodTruck,
          startDayKey,
          endDayKey: currentKey,
          truckUnitId,
        }),
        foodTruck
      );
    const [yearToDateEarning, todayEarning, weeklyEarning, monthlyEarning] =
      await Promise.all([
        getRangeResult(yearStartKey),
        getRangeResult(currentKey),
        getRangeResult(weekStartKey),
        getRangeResult(monthStartKey),
      ]);
    const total = this.getVendorEarningsResult(allOrders, foodTruck);

    return {
      totalEarning: total.adminPayment,
      yearToDateEarning: yearToDateEarning.adminPayment,
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
    foodTruck,
    earning_list,
    is_list = 'normal',
    startDate = null,
    endDate = null,
    fallbackVendorTierRate = 0
  ) {
    const timeZone = foodTruck.schedule_time_zone || 'America/New_York';
    const currentKey = getOperationalDayKey(new Date(), timeZone);
    const currentDate = new Date(`${currentKey}T00:00:00.000Z`);
    const periodStart = new Date(currentDate);
    const requestedRange = String(earning_list || '').toLowerCase();
    if (!startDate || !endDate) {
      if (requestedRange === 'weekly') {
        periodStart.setUTCDate(periodStart.getUTCDate() - periodStart.getUTCDay());
      } else if (requestedRange === 'monthly') {
        periodStart.setUTCDate(1);
      } else if (requestedRange === 'yearly') {
        periodStart.setUTCMonth(0, 1);
      }
    }
    const startDayKey =
      startDate ||
      (requestedRange === 'daily' ? currentKey : periodStart.toISOString().slice(0, 10));
    const endDayKey = endDate || currentKey;
    let orders;
    if (!startDate && !endDate && !['daily', 'weekly', 'monthly', 'yearly'].includes(requestedRange)) {
      orders = await Model.find({
        foodTruckId: new mongoose.Types.ObjectId(foodTruck._id),
        deletedAt: null,
      }).lean();
    } else {
      orders = await this.getOrdersForOperationalRange({
        foodTruck,
        startDayKey,
        endDayKey,
      });
    }
    const earningOrders = orders
      .filter(isRevenueOrder)
      .filter((order) => is_list !== 'dessert' || order.freeDessertApplied === true)
      .sort(
        (left, right) =>
          new Date(right.created_at || right.createdAt) -
          new Date(left.created_at || left.createdAt)
      );
    const totalFreeDessertOrders = earningOrders.filter(
      (order) =>
        order.freeDessertApplied === true &&
        isCompletedOrder(order) &&
        !isRefundedOrder(order)
    );
    const totalFreeDessertAmount = totalFreeDessertOrders.reduce(
      (sum, order) => sum + Number(order.freeDessertAmount || 0),
      0
    );
    const isCash = (order) =>
      cashPaymentMethods.includes(
        String(order.paymentMethod || order.payment_method || '').toUpperCase()
      );
    const isDigital = (order) =>
      digitalPaymentMethods.includes(
        String(order.paymentMethod || order.payment_method || '').toUpperCase()
      );
    const totalRevenue = earningOrders.reduce(
      (sum, order) => sum + getOrderNetEarningsAmount(order),
      0
    );
    const skip = (Number(page) - 1) * Number(limit);

    return {
      data: earningOrders.slice(skip, skip + Number(limit)).map((order) => ({
        ...order,
        vendorEarning: getOrderNetEarningsAmount(order),
      })),
      total: earningOrders.length,
      earning_total:
        is_list === 'dessert'
          ? Number(totalFreeDessertAmount.toFixed(2))
          : Number(totalRevenue.toFixed(2)),
      totalFreeDessertAmount: Number(totalFreeDessertAmount.toFixed(2)),
      totalFreeDessertCount: totalFreeDessertOrders.length,
      cashEarning: Number(
        earningOrders
          .filter(isCash)
          .reduce((sum, order) => sum + getOrderNetEarningsAmount(order), 0)
          .toFixed(2)
      ),
      cashTotalOrder: earningOrders.filter(isCash).length,
      digitalEarning: Number(
        earningOrders
          .filter(isDigital)
          .reduce((sum, order) => sum + getOrderNetEarningsAmount(order), 0)
          .toFixed(2)
      ),
      digitalTotalOrder: earningOrders.filter(isDigital).length,
    };
  }

  async getVendorDashboardCountDetails(foodTruck) {
    const timeZone = foodTruck.schedule_time_zone || 'America/New_York';
    const currentKey = getOperationalDayKey(new Date(), timeZone);
    const currentDate = new Date(`${currentKey}T00:00:00.000Z`);
    const weekStart = new Date(currentDate);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const weekStartKey = weekStart.toISOString().slice(0, 10);
    const monthStartKey = `${currentKey.slice(0, 7)}-01`;
    const yearStartKey = `${currentKey.slice(0, 4)}-01-01`;
    const getRange = async (startDayKey) => {
      const orders = await this.getOrdersForOperationalRange({
        foodTruck,
        startDayKey,
        endDayKey: currentKey,
      });
      const summary = summarizeVendorSales({ orders, foodTruck });
      const deliveredDesserts = orders.filter(
        (order) =>
          order.freeDessertApplied === true &&
          isCompletedOrder(order) &&
          !isRefundedOrder(order)
      );
      return {
        ...summary,
        activeCustomerCount: new Set(
          orders.map((order) => order.userId?.toString()).filter(Boolean)
        ).size,
        deliveredDessertsCount: deliveredDesserts.length,
        deliveredDessertsSum: Number(
          deliveredDesserts
            .reduce((sum, order) => sum + Number(order.freeDessertAmount || 0), 0)
            .toFixed(2)
        ),
      };
    };
    const [todayData, weeklyData, monthlyData, yearToDateData] =
      await Promise.all([
        getRange(currentKey),
        getRange(weekStartKey),
        getRange(monthStartKey),
        getRange(yearStartKey),
      ]);

    return {
      todaySales: todayData.grossSales,
      todayTotalOrders: todayData.orders,
      todayActiveCustomers: todayData.activeCustomerCount,
      weeklyEarning: weeklyData.netEarnings,
      monthlyEarning: monthlyData.netEarnings,
      yearToDateEarning: yearToDateData.netEarnings,
      monthlyDeliveredDessertsCount: monthlyData.deliveredDessertsCount,
      monthlyDeliveredDessertsSum: monthlyData.deliveredDessertsSum,
      monthlyActiveCustomers: monthlyData.activeCustomerCount,
    };
  }


}

module.exports = new OrderService();
