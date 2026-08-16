const assert = require('assert');
const {
  getUnlockedMarketplaceCoordinatorContact,
} = require('./marketplace-coordinator-contact');

const coordinator = {
  firstName: 'Casey',
  lastName: 'Coordinator',
  countryCode: '+1',
  mobileNumber: '5555550123',
  email: 'casey@example.com',
};

assert.equal(
  getUnlockedMarketplaceCoordinatorContact({ coordinator, detailsUnlocked: false }),
  null,
  'selected or payment-pending records must not expose coordinator contact',
);
assert.deepEqual(
  getUnlockedMarketplaceCoordinatorContact({ coordinator, detailsUnlocked: true }),
  { name: 'Casey Coordinator', phone: '+1 5555550123', email: 'casey@example.com' },
  'payment-unlocked records expose the coordinator contact section',
);

console.log('marketplace coordinator contact tests passed');
