const assert = require('assert');
const { buildCoordinatorAddressUpdate } = require('./coordinator-address-helper');
const AuthValidation = require('../v1/validations/auth-validation');
const UserValidation = require('../v1/validations/user-validation');
const UserModel = require('../models/user');
const { sanitizeCoordinatorProfile } = require('./event-coordinator-profile');

const address = {
  eventCoordinatorAddressCountry: 'US',
  eventCoordinatorAddressLatitude: '40.724',
  eventCoordinatorAddressLongitude: '-74.231',
};
const registration = AuthValidation.register.body.validate({
  firstName: 'Test', email: 'test@example.com', countryCode: '+1',
  mobileNumber: '5555555555', password: 'Password1', ...address,
});
assert.ifError(registration.error);
assert.ifError(UserValidation.update.body.validate(address).error);
assert.equal(buildCoordinatorAddressUpdate(address).eventCoordinatorAddressLatitude, 40.724);
assert.deepEqual(buildCoordinatorAddressUpdate({ eventCoordinatorAddressCountry: 'CA' }, { partial: true }), {
  eventCoordinatorAddressCountry: 'CA',
});
assert(UserModel.schema.path('eventCoordinatorAddressCountry'));
assert(UserModel.schema.path('eventCoordinatorAddressLatitude'));
assert(UserModel.schema.path('eventCoordinatorAddressLongitude'));
assert.equal(sanitizeCoordinatorProfile({ ...address }).eventCoordinatorAddressCountry, 'US');
assert(AuthValidation.register.body.validate({
  firstName: 'Test', email: 'test@example.com', countryCode: '+1',
  mobileNumber: '5555555555', password: 'Password1',
  eventCoordinatorAddressLatitude: 91,
}).error);
console.log('Coordinator address contract tests passed.');
