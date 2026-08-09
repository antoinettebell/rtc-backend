const ADDRESS_FIELDS = [
  'eventCoordinatorAddressLine1', 'eventCoordinatorAddressLine2',
  'eventCoordinatorAddressCity', 'eventCoordinatorAddressState',
  'eventCoordinatorAddressZip', 'eventCoordinatorAddressCountry',
  'eventCoordinatorAddressLatitude', 'eventCoordinatorAddressLongitude',
  'eventCoordinatorFormattedAddress', 'eventCoordinatorPlaceId',
];
const COORDINATE_FIELDS = new Set([
  'eventCoordinatorAddressLatitude', 'eventCoordinatorAddressLongitude',
]);
const normalizeValue = (field, value) => {
  if (value === '' || value === null || value === undefined) return null;
  return COORDINATE_FIELDS.has(field) ? Number(value) : value;
};
const buildCoordinatorAddressUpdate = (input = {}, { partial = false } = {}) =>
  ADDRESS_FIELDS.reduce((update, field) => {
    if (!partial || Object.prototype.hasOwnProperty.call(input, field)) {
      update[field] = normalizeValue(field, input[field]);
    }
    return update;
  }, {});
module.exports = { ADDRESS_FIELDS, buildCoordinatorAddressUpdate };
