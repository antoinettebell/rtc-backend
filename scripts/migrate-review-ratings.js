require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const {
  ReviewModel,
  ReviewTokenModel,
  FoodTruckModel,
} = require('../src/models');

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);

  const duplicates = await ReviewModel.aggregate([
    { $match: { orderId: { $type: 'objectId' }, deletedAt: null } },
    { $group: { _id: '$orderId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]);
  if (duplicates.length) {
    throw new Error(
      `Duplicate order reviews must be resolved before migration (${duplicates.length} found).`
    );
  }

  const statusResult = await ReviewModel.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'PUBLISHED' } }
  );

  const duplicateTokenOrders = await ReviewTokenModel.aggregate([
    { $match: { orderId: { $type: 'objectId' } } },
    {
      $group: {
        _id: '$orderId',
        tokenIds: { $push: { id: '$_id', createdAt: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  for (const duplicate of duplicateTokenOrders) {
    const newestFirst = duplicate.tokenIds.sort(
      (left, right) => new Date(right.createdAt) - new Date(left.createdAt)
    );
    await ReviewTokenModel.updateMany(
      { _id: { $in: newestFirst.slice(1).map((item) => item.id) } },
      {
        $set: {
          send_status: 'FAILED',
          send_error: 'Superseded duplicate token',
          send_active: false,
        },
      }
    );
  }
  await ReviewTokenModel.updateMany(
    { send_status: { $exists: false } },
    { $set: { send_status: 'SENT', send_active: true } }
  );
  await FoodTruckModel.updateMany({}, {
    $set: { averageRating: null, reviewCount: 0 },
  });

  const summaries = await ReviewModel.aggregate([
    {
      $match: {
        status: 'PUBLISHED',
        deletedAt: null,
        rate: { $in: [1, 2, 3, 4, 5] },
      },
    },
    {
      $group: {
        _id: '$foodTruckId',
        averageRating: { $avg: '$rate' },
        reviewCount: { $sum: 1 },
      },
    },
  ]);
  if (summaries.length) {
    await FoodTruckModel.bulkWrite(
      summaries.map((summary) => ({
        updateOne: {
          filter: { _id: summary._id },
          update: {
            $set: {
              averageRating: summary.averageRating,
              reviewCount: summary.reviewCount,
            },
          },
        },
      }))
    );
  }

  await ReviewModel.createIndexes();
  await ReviewTokenModel.createIndexes();
  console.log('Review migration complete', {
    reviewsBackfilled: statusResult.modifiedCount,
    vendorsRated: summaries.length,
  });
};

run()
  .catch((error) => {
    console.error('Review migration failed', { message: error.message });
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
