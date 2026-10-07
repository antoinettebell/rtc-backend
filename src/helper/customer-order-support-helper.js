const SUPPORT_PHONE_NUMBER = '803-844-7600';
const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const REFUND_REQUEST_WINDOW_MS = 2 * 60 * 60 * 1000;

const getRefundWindowStartedAt = (order) => {
  const statusTime = order?.statusTime || {};
  const fulfillmentTime =
    String(order?.fulfillmentType || '').toUpperCase() === 'DELIVERY'
      ? statusTime.deliveredAt || statusTime.driverPickedUpAt
      : order?.completed_at || statusTime.completedAt || statusTime.readyAt;
  const parsed = fulfillmentTime ? new Date(fulfillmentTime) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const isWithinRefundRequestWindow = (order, now = new Date()) => {
  const startedAt = getRefundWindowStartedAt(order);
  if (!startedAt) return false;
  const elapsed = now.getTime() - startedAt.getTime();
  return elapsed >= 0 && elapsed <= REFUND_REQUEST_WINDOW_MS;
};

const getRefundDecision = (priorIssueCount) => {
  if (priorIssueCount === 0) {
    return { outcome: 'AUTO_REFUND', percentage: 100, message: 'A full refund will be issued to your original payment method.' };
  }
  if (priorIssueCount === 1) {
    return { outcome: 'AUTO_REFUND', percentage: 50, message: 'A 50% refund will be issued to your original payment method.' };
  }
  return { outcome: 'ESCALATED', percentage: 0, message: 'Support will be in touch to help with this order.' };
};

const buildSupportSmsBody = ({ order, customer, issueType, outcome }) => {
  const customerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || 'Unknown customer';
  const orderLabel = order?.orderNumber ? `#${order.orderNumber}` : String(order?._id || 'unknown');
  const truckName = order?.foodTruck?.name || order?.foodTruckName || 'Unknown vendor';
  return `RTC order support: ${issueType}. Order ${orderLabel}; customer ${customerName}; ${customer?.email || 'no email'}; ${customer?.phone || customer?.mobileNumber || 'no phone'}; vendor ${truckName}; outcome ${outcome}.`;
};

module.exports = {
  SUPPORT_PHONE_NUMBER,
  ROLLING_WINDOW_MS,
  REFUND_REQUEST_WINDOW_MS,
  getRefundWindowStartedAt,
  isWithinRefundRequestWindow,
  getRefundDecision,
  buildSupportSmsBody,
};
