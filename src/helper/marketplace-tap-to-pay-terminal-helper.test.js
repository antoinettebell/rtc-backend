const assert = require('node:assert/strict');
const {
  normalizeActivationStatus,
  resolveMarketplaceTerminalState,
} = require('./marketplace-tap-to-pay-terminal-helper');

assert.equal(normalizeActivationStatus('succeeded'), 'SUCCEEDED');
assert.equal(normalizeActivationStatus('not-a-status'), 'UNKNOWN');

assert.deepEqual(
  resolveMarketplaceTerminalState({ activationStatus: 'SUCCEEDED' }),
  { status: 'ACTIVE', activationStatus: 'SUCCEEDED', activated: true }
);

assert.deepEqual(
  resolveMarketplaceTerminalState({ activationStatus: 'PENDING' }),
  { status: 'PENDING_ACTIVATION', activationStatus: 'PENDING', activated: false }
);

assert.deepEqual(
  resolveMarketplaceTerminalState({ activationStatus: 'FAILED' }),
  { status: 'PENDING_ACTIVATION', activationStatus: 'FAILED', activated: false }
);

assert.deepEqual(
  resolveMarketplaceTerminalState({
    activationStatus: 'UNKNOWN',
    existingStatus: 'ACTIVE',
    existingActivationStatus: 'SUCCEEDED',
  }),
  { status: 'ACTIVE', activationStatus: 'SUCCEEDED', activated: true }
);

assert.deepEqual(
  resolveMarketplaceTerminalState({
    activationStatus: 'PENDING',
    existingStatus: 'HISTORICAL',
  }),
  { status: 'HISTORICAL', activationStatus: 'PENDING', activated: false }
);

console.log('Marketplace Tap to Pay terminal state tests passed');
