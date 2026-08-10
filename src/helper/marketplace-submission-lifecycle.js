const ACTIVE_FOOD_BID_STATUSES = [
  'DRAFT', 'PENDING_SIGNATURE', 'SUBMITTED', 'UNDER_REVIEW', 'AWARDED',
];
const ACTIVE_FOOD_APPLICATION_STATUSES = [
  'DRAFT', 'PENDING_SIGNATURE', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED',
  'PAYMENT_DUE', 'PAID', 'CONFIRMED',
];
const ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES = [
  'SUBMITTED', 'UNDER_REVIEW', 'AWARDED', 'PAYMENT_DUE', 'PAID',
];
const EDITABLE_EVENT_VENDOR_APPLICATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'];
const WITHDRAWABLE_EVENT_VENDOR_APPLICATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'];

const isEventVendorApplicationEditable = (status) =>
  EDITABLE_EVENT_VENDOR_APPLICATION_STATUSES.includes(String(status || '').toUpperCase());

const isEventVendorApplicationWithdrawable = (status) =>
  WITHDRAWABLE_EVENT_VENDOR_APPLICATION_STATUSES.includes(String(status || '').toUpperCase());

const isEventOpenForOrdinaryWithdrawal = (event, now = new Date()) =>
  !!event
  && ['OPEN', 'REOPENED'].includes(String(event.status || '').toUpperCase())
  && !event.vendor_applications_closed_at
  && (!event.event_close_date || new Date(event.event_close_date) > now);

const resolveSelectedApplicationPhotos = ({ photoIds = [], activePhotos = [], priorSnapshots = [] }) => {
  const active = new Map(activePhotos.map((photo) => [photo.photo_id, photo]));
  const prior = new Map(priorSnapshots.map((photo) => [photo.photo_id, photo]));
  return photoIds.map((photoId) => active.get(photoId) || prior.get(photoId)).filter(Boolean);
};

module.exports = {
  ACTIVE_FOOD_BID_STATUSES,
  ACTIVE_FOOD_APPLICATION_STATUSES,
  ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES,
  EDITABLE_EVENT_VENDOR_APPLICATION_STATUSES,
  WITHDRAWABLE_EVENT_VENDOR_APPLICATION_STATUSES,
  isEventVendorApplicationEditable,
  isEventVendorApplicationWithdrawable,
  isEventOpenForOrdinaryWithdrawal,
  resolveSelectedApplicationPhotos,
};
