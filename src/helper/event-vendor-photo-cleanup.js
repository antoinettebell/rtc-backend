const {
  EventVendorApplicationModel,
  EventVendorObjectCleanupModel,
  EventVendorPhotoModel,
} = require('../models');
const { removeObject } = require('./aws');

const enqueueObjectCleanup = async ({ objectKey, reason, session = null, protectSnapshots = true }) => {
  if (!objectKey) return null;
  return EventVendorObjectCleanupModel.findOneAndUpdate(
    { object_key: objectKey },
    {
      $setOnInsert: {
        object_key: objectKey,
        reason,
        protect_application_snapshots: protectSnapshots,
        status: 'PENDING',
        next_attempt_at: new Date(),
      },
    },
    { upsert: true, new: true, session }
  );
};

const stageExpiredApplicationPhotos = async ({ now = new Date(), limit = 100 } = {}) => {
  const expired = await EventVendorPhotoModel.find({
    source: 'APPLICATION', status: 'ACTIVE', expires_at: { $lte: now },
  }).limit(limit);
  for (const photo of expired) {
    const session = await EventVendorPhotoModel.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await EventVendorPhotoModel.findOneAndUpdate(
          { _id: photo._id, source: 'APPLICATION', status: 'ACTIVE', expires_at: { $lte: now } },
          { $set: { status: 'ARCHIVED', archived_at: now, expires_at: null } },
          { new: true, session }
        );
        if (current?.file_key) {
          await enqueueObjectCleanup({ objectKey: current.file_key, reason: 'EXPIRED_APPLICATION_UPLOAD', session });
        }
      });
    } finally {
      await session.endSession();
    }
  }
  return expired.length;
};

const processCleanupOutbox = async ({
  now = new Date(),
  limit = 100,
  remove = removeObject,
  CleanupModel = EventVendorObjectCleanupModel,
  ApplicationModel = EventVendorApplicationModel,
} = {}) => {
  let processed = 0;
  while (processed < limit) {
    const task = await CleanupModel.findOneAndUpdate(
      {
        $or: [
          { status: 'PENDING', next_attempt_at: { $lte: now } },
          { status: 'PROCESSING', lease_until: { $lte: now } },
        ],
      },
      {
        $set: { status: 'PROCESSING', lease_until: new Date(now.getTime() + 5 * 60 * 1000) },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { next_attempt_at: 1 } }
    );
    if (!task) break;
    const protectedSnapshot = task.protect_application_snapshots
      ? await ApplicationModel.exists({ 'photos.file_key': task.object_key })
      : false;
    if (protectedSnapshot) {
      task.status = 'PROTECTED';
      task.completed_at = now;
      task.lease_until = null;
      await task.save();
      processed += 1;
      continue;
    }
    let removed = false;
    let deletionError = null;
    try {
      removed = await remove(task.object_key);
    } catch (error) {
      deletionError = error;
    }
    if (removed === true) {
      task.status = 'COMPLETED';
      task.completed_at = now;
      task.last_error = null;
    } else {
      task.status = 'PENDING';
      task.next_attempt_at = new Date(now.getTime() + Math.min(24, 2 ** task.attempts) * 60 * 60 * 1000);
      task.last_error = deletionError?.message || 'Object deletion failed';
    }
    task.lease_until = null;
    await task.save();
    processed += 1;
  }
  return processed;
};

const runEventVendorPhotoCleanup = async () => {
  await stageExpiredApplicationPhotos();
  await processCleanupOutbox();
};

const startEventVendorPhotoCleanup = () => {
  const run = () => runEventVendorPhotoCleanup().catch((cleanupError) => {
    console.error('Marketplace Vendor application photo cleanup failed', { message: cleanupError.message });
  });
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref?.();
  setTimeout(run, 30 * 1000).unref?.();
  return timer;
};

module.exports = {
  enqueueObjectCleanup,
  processCleanupOutbox,
  runEventVendorPhotoCleanup,
  stageExpiredApplicationPhotos,
  startEventVendorPhotoCleanup,
};
