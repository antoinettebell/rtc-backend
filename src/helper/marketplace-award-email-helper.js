const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const hasValue = (value) =>
  value !== null && value !== undefined && String(value).trim() !== '';

const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : 'Not provided');
const list = (value) =>
  Array.isArray(value) && value.length ? value.filter(hasValue).join(', ') : 'Not provided';
const row = (label, value) =>
  `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(hasValue(value) ? value : 'Not provided')}</p>`;

const getVendorPhone = (vendor = {}, submission = {}) =>
  submission.contact_number ||
  submission.phone ||
  vendor.phone ||
  vendor.phoneNumber ||
  `${vendor.countryCode || ''}${vendor.mobileNumber || ''}` ||
  null;

const buildFoodVendorAwardDetailsHtml = ({
  bid = null,
  application = null,
  event = {},
  vendor = {},
}) => {
  const submission = bid || application || {};
  const details = [
    row('Vendor type', 'Food Vendor'),
    row('Vendor email', submission.email || vendor.email),
    row('Vendor phone', getVendorPhone(vendor, submission)),
  ];

  if (bid) {
    details.push(
      row('Awarded price', money(bid.full_bid_amount)),
      row('Price per guest', hasValue(bid.price_per_guest) ? money(bid.price_per_guest) : null),
      row('Average price per meal', hasValue(bid.average_price_per_meal) ? money(bid.average_price_per_meal) : null),
      row('Menu description', bid.menu_description),
      row('Additional notes', bid.notes),
      row('Insurance confirmed', yesNo(bid.insurance_confirmed)),
      row('Permits confirmed', yesNo(bid.permits_confirmed)),
      row('Liquor license confirmed', yesNo(bid.liquor_license_confirmed))
    );
  } else {
    details.push(
      row('Awarded price', money(event.vendor_fee)),
      row('Business name', application?.business_name),
      row('Contact name', application?.contact_name),
      row('Cuisine / food type', application?.food_type_cuisine),
      row('Menu description', application?.menu_description),
      row('Additional notes', application?.notes),
      row('Insurance confirmed', yesNo(application?.insurance_confirmed)),
      row('Permits confirmed', yesNo(application?.permits_confirmed)),
      row('Liquor license confirmed', yesNo(application?.liquor_license_confirmed))
    );
  }

  details.push(
    row('Electricity required', 'Covered by the food-vendor event requirements'),
    row('Electricity fee', 'Not applicable to food vendors')
  );
  return details.join('\n');
};

const buildEventVendorAwardDetailsHtml = ({ application = {}, vendor = {} }) => [
  row('Vendor type', list(application.vendor_types)),
  row('Business name', application.business_name),
  row('Contact name', application.contact_name),
  row('Vendor email', vendor.email),
  row('Vendor phone', getVendorPhone(vendor, application)),
  row('Awarded attendance fee', money(application.category_fee)),
  row('Electricity required', yesNo(application.electricity_required)),
  row(
    'Electricity fee',
    application.electricity_required ? money(application.electricity_fee) : 'Not applicable'
  ),
  row('Checkout subtotal', money(application.checkout_subtotal)),
  row('Products / services offered', list(application.offering_bullets)),
  row('Average price per item / service', money(application.average_price)),
  row('Additional notes', application.additional_notes),
].join('\n');

module.exports = {
  buildEventVendorAwardDetailsHtml,
  buildFoodVendorAwardDetailsHtml,
};
