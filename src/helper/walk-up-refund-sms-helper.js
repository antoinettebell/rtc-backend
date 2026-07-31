const SmsHelper = require('./sms-helper');

const WALK_UP_ORDER_SOURCES = ['VENDOR_POS', 'WALK_UP_EMPLOYEE'];

const toMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const getRefundAmountExcludingTip = (order) =>
  Number(Math.max(0, toMoney(order?.total) - toMoney(order?.tipsAmount)).toFixed(2));

const buildRefundSmsBody = ({ order, amount }) => {
  const orderLabel = order?.orderNumber ? ` #${order.orderNumber}` : '';
  return `RTC: Refunded order${orderLabel}. Refund amount: $${toMoney(amount).toFixed(2)}. Tips are not refunded.`;
};

const sendWalkUpRefundSms = async ({ order, amount = null }) => {
  const phone = order?.guestCustomer?.phone;
  const orderSource = String(order?.orderSource || '').toUpperCase();
  if (!phone || !WALK_UP_ORDER_SOURCES.includes(orderSource)) {
    return { skipped: true, reason: 'not_walkup_guest_sms' };
  }

  const refundAmount =
    amount === null || amount === undefined
      ? getRefundAmountExcludingTip(order)
      : toMoney(amount);

  return SmsHelper.sendSms({
    to: phone,
    body: buildRefundSmsBody({ order, amount: refundAmount }),
    metadata: {
      orderId: order._id?.toString(),
      orderNumber: order.orderNumber,
      orderStatus: 'REFUNDED',
      orderSource,
      refundAmount,
      excludedTip: toMoney(order.tipsAmount),
    },
  });
};

exports.buildRefundSmsBody = buildRefundSmsBody;
exports.getRefundAmountExcludingTip = getRefundAmountExcludingTip;
exports.sendWalkUpRefundSms = sendWalkUpRefundSms;
