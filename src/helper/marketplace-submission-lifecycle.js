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

const EVENT_VENDOR_FILLED_STATUSES = ['AWARDED', 'PAYMENT_DUE', 'PAID'];
const buildEventVendorRequirementSummary = ({ needs = [], applications = [] }) =>
  ['MERCHANDISE', 'SERVICE', 'OTHER'].map((vendorType) => {
    const requested = needs
      .filter((item) => item?.vendor_type === vendorType)
      .reduce((total, item) => total + Math.max(0, Number(item.quantity || 0)), 0);
    const filledApplications = applications.filter(
      (application) =>
        EVENT_VENDOR_FILLED_STATUSES.includes(String(application?.status || '').toUpperCase()) &&
        (application.vendor_types || []).includes(vendorType)
    );
    const filled = new Set(
      filledApplications.map((application, index) =>
        String(application.application_id || application._id || `${vendorType}-${index}`)
      )
    ).size;
    return {
      vendor_type: vendorType,
      requested,
      filled,
      remaining: Math.max(0, requested - filled),
    };
  });

const getCoordinatorNotSelectTransition = (kind, status) => {
  const normalizedKind = String(kind || '').toUpperCase();
  const normalizedStatus = String(status || '').toUpperCase();
  const targetStatus = normalizedKind === 'BID' ? 'DECLINED' : 'NOT_SELECTED';
  if (normalizedStatus === targetStatus) return { idempotent: true, targetStatus };
  const eligible = normalizedKind === 'BID'
    ? ['SUBMITTED', 'UNDER_REVIEW'].includes(normalizedStatus)
    : ['SUBMITTED', 'UNDER_REVIEW'].includes(normalizedStatus);
  return { idempotent: false, targetStatus, eligible };
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
  buildEventVendorRequirementSummary,
  getCoordinatorNotSelectTransition,
};
