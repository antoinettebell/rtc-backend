const { PaymentsLogModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');
const mongoose = require('mongoose');

class PaymentsLogService extends BaseService {
  constructor() {
    super(Model);
  }

async getTransactionAllDetails(
  limit = 10,
  page = 1,
  user,
  search,
  id,
  status=null,
  transactionsType=null,
  startDate = null,
  endDate = null
) {
  const skip = (+page - 1) * limit;
  let q = {};

  // USER TYPE FILTER
  if (user?.userType === "CUSTOMER") {
    q.userId = new mongoose.Types.ObjectId(user._id);
  }

  if (user?.userType === "VENDOR") {
    q["foodTruck.userId"] = new mongoose.Types.ObjectId(user._id);
  }

  // ID FILTER
  if (id) {
    q["_id"] = new mongoose.Types.ObjectId(id);
  }

  // SEARCH FILTERS
  if (search?.trim()) {
    const s = search.trim().toLowerCase();

    q["$or"] = [
      { transactionId: { $regex: s, $options: "i" } },
      { paymentMethod: { $regex: s, $options: "i" } },
      { invoiceNumber: { $regex: s, $options: "i" } },
      { uniqueId: { $regex: s, $options: "i" } },
      { orderId: { $regex: s, $options: "i" } },
      { "user.email": { $regex: s, $options: "i" } },
      { "user.firstName": { $regex: s, $options: "i" } },
      { "user.lastName": { $regex: s, $options: "i" } }
    ];
  }

      // DATE RANGE FILTER
    if (startDate && endDate) {
    q.createdAt = {
      $gte: new Date(startDate + " 00:00:00"),
      $lte: new Date(endDate + " 23:59:59")
    };
  } else if (startDate) {
    q.createdAt = {
      $gte: new Date(startDate + " 00:00:00")
    };
  } else if (endDate) {
    q.createdAt = {
      $lte: new Date(endDate + " 23:59:59")
    };
  }

  // STATUS FILTER (true / false / null)
  if (status !== null) {
    q.success = status;
  }
  if (transactionsType !== null) {
    q.type = transactionsType;
  }

  const result = (
    await Model.aggregate([
      // JOIN USER
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      // { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      { $unwind: "$user"},

      // JOIN ORDER
      {
        $lookup: {
          from: "orders",
          localField: "orderId",
          foreignField: "_id",
          as: "orderData"
        }
      },
      { $unwind: { path: "$orderData", preserveNullAndEmptyArrays: true } },

      // APPLY FILTERS
      { $match: q },

      // SORTING LATEST FIRST
      { $sort: { createdAt: -1 } },

      // FACET FOR PAGINATION + STATS
      {
        $facet: {
          meta: [
            {
              $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                successCount: {
                  $sum: { $cond: [{ $eq: ["$success", true] }, 1, 0] }
                },
                failedCount: {
                  $sum: { $cond: [{ $eq: ["$success", false] }, 1, 0] }
                },
                totalSuccessAmount: {
                  $sum: {
                    $cond: [
                      { $eq: ["$success", true] },
                      "$amount",
                      0
                    ]
                  }
                }
              }
            },
            {
              $project: {
                _id: 0,
                totalTransactions: 1,
                successCount: 1,
                failedCount: 1,
                totalSuccessAmount: 1
              }
            }
          ],

          records: [{ $skip: skip }, { $limit: +limit },{
            $addFields: {
              responsePayload: 0,
              requestPayload:0
            }
          }]
        }
      }
    ])
  )[0];

  return {
    data: result.records || [],
    totalTransactions: result.meta?.[0]?.totalTransactions || 0,
    successCount: result.meta?.[0]?.successCount || 0,
    failedCount: result.meta?.[0]?.failedCount || 0,
    totalSuccessAmount: parseFloat((result.meta?.[0]?.totalSuccessAmount || 0).toFixed(2))
  };
}

}

module.exports = new PaymentsLogService();
