const assert = require('node:assert/strict');
const {
  getTerminalOwnershipConflict,
  selectTerminalOwner,
} = require('./tap-to-pay-terminal-ownership-helper');

const records = [
  {
    vendor_user_id: 'second-vendor',
    status: 'PENDING_ACTIVATION',
    registered_at: new Date('2026-09-28T12:00:00Z'),
  },
  {
    vendor_user_id: 'first-vendor',
    status: 'ACTIVE',
    registered_at: new Date('2026-09-27T12:00:00Z'),
  },
];

assert.equal(selectTerminalOwner(records).vendor_user_id, 'first-vendor');
assert.equal(
  getTerminalOwnershipConflict({ records, vendorUserId: 'first-vendor' }),
  null
);
assert.equal(
  getTerminalOwnershipConflict({ records, vendorUserId: 'second-vendor' }).vendor_user_id,
  'first-vendor'
);
assert.equal(
  selectTerminalOwner([
    { vendor_user_id: 'old', status: 'HISTORICAL' },
    { vendor_user_id: 'new', status: 'PENDING_ACTIVATION' },
  ]).vendor_user_id,
  'new'
);

console.log('Tap to Pay terminal ownership tests passed');
