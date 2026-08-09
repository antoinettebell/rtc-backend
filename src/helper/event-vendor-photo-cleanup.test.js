const assert = require('assert');
const { processCleanupOutbox } = require('./event-vendor-photo-cleanup');

const task = (key) => ({
  object_key: key,
  protect_application_snapshots: true,
  attempts: 1,
  status: 'PROCESSING',
  save: async function save() { return this; },
});

const run = async () => {
  const failed = task('retry-me');
  const protectedTask = task('keep-me');
  const completed = task('delete-me');
  const queue = [failed, protectedTask, completed];
  const CleanupModel = { findOneAndUpdate: async () => queue.shift() || null };
  const ApplicationModel = { exists: async (query) => query['photos.file_key'] === 'keep-me' };
  const removed = [];
  await processCleanupOutbox({
    CleanupModel,
    ApplicationModel,
    remove: async (key) => { removed.push(key); return key === 'delete-me'; },
    now: new Date('2026-08-09T12:00:00.000Z'),
  });
  assert.equal(failed.status, 'PENDING', 'failed deletion remains retryable');
  assert.ok(failed.next_attempt_at instanceof Date);
  assert.equal(protectedTask.status, 'PROTECTED', 'submitted snapshot object is retained');
  assert.equal(completed.status, 'COMPLETED');
  assert.deepStrictEqual(removed, ['retry-me', 'delete-me']);
  console.log('Marketplace Vendor object cleanup outbox tests passed');
};

run();
