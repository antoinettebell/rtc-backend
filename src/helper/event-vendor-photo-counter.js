const { EventVendorPhotoModel, EventVendorProfileModel } = require('../models');
const { MERCHANDISE_CATEGORIES } = require('./event-vendor-profile-lifecycle');

const buildCounts = (rows = []) => {
  const counts = Object.fromEntries(MERCHANDISE_CATEGORIES.map((category) => [category, 0]));
  rows.forEach((row) => {
    if (Object.hasOwn(counts, row._id)) counts[row._id] = Number(row.count || 0);
  });
  return counts;
};

const reconcileRepositoryPhotoCounters = async (profileId, { force = false } = {}) => {
  if (!force) {
    const complete = await EventVendorProfileModel.findOne({ profile_id: profileId, repository_counter_state: 'COMPLETE' }).lean();
    if (complete) return complete;
    const claimed = await EventVendorProfileModel.findOneAndUpdate(
      {
        profile_id: profileId,
        $or: [
          { repository_counter_state: 'PENDING' },
          { repository_counter_state: { $exists: false } },
        ],
      },
      { $set: { repository_counter_state: 'RUNNING' } },
      { new: true }
    );
    if (!claimed) {
      const error = new Error('Photo repository counters are being reconciled; retry shortly');
      error.code = 409;
      throw error;
    }
  }
  try {
    const rows = await EventVendorPhotoModel.aggregate([
      { $match: { profile_id: profileId, source: 'REPOSITORY', status: 'ACTIVE' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    const counts = buildCounts(rows);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return EventVendorProfileModel.findOneAndUpdate(
      { profile_id: profileId },
      {
        $set: {
          repository_photo_counts: counts,
          repository_photo_total: total,
          repository_counter_state: 'COMPLETE',
          repository_counter_reconciled_at: new Date(),
        },
      },
      { new: true }
    );
  } catch (reconciliationError) {
    await EventVendorProfileModel.updateOne(
      { profile_id: profileId, repository_counter_state: 'RUNNING' },
      { $set: { repository_counter_state: 'PENDING' } }
    );
    throw reconciliationError;
  }
};

module.exports = { buildCounts, reconcileRepositoryPhotoCounters };
