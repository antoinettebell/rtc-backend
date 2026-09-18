const SmsHelper = require('./sms-helper');

const WALK_UP_ORDER_SOURCES = ['VENDOR_POS', 'WALK_UP_EMPLOYEE'];

const toMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount).toFixed(2) : '0.00';
};

const getFoodTruckName = (foodTruck) =>
  String(
    foodTruck?.truckName ||
      foodTruck?.name ||
      foodTruck?.businessName ||
      foodTruck?.companyName ||
      'your food vendor'
  )
    .trim()
    .slice(0, 60);

const buildTapToPayReceiptSmsBody = ({ order, foodTruck }) => {
  const orderLabel = order?.orderNumber ? ` #${order.orderNumber}` : '';
  return [
    `RDC receipt: Tap to Pay approved for order${orderLabel} from ${getFoodTruckName(foodTruck)}.`,
    `Items $${toMoney(order?.subTotal ?? order?.subtotal)},`,
    `tax $${toMoney(order?.taxAmount ?? order?.tax)},`,
    `processing fee $${toMoney(order?.paymentProcessingFee)},`,
    `tip $${toMoney(order?.tipsAmount)},`,
    `total $${toMoney(order?.totalOrderCost ?? order?.total)}.`,
    'Reply STOP to opt out.',
  ].join(' ');
};

const sendWalkUpTapToPayReceiptSms = async ({ order, foodTruck }) => {
  const phone = order?.guestCustomer?.phone;
  const orderSource = String(order?.orderSource || '').toUpperCase();
  const paymentMethod = String(order?.paymentMethod || '').toUpperCase();
  const paymentStatus = String(order?.paymentStatus || '').toUpperCase();

  if (
    !phone ||
    !WALK_UP_ORDER_SOURCES.includes(orderSource) ||
    paymentMethod !== 'TAP_TO_PAY' ||
    paymentStatus !== 'PAID'
  ) {
    return { skipped: true, reason: 'not_paid_walkup_tap_to_pay_with_phone' };
  }

  return SmsHelper.sendSms({
    to: phone,
    body: buildTapToPayReceiptSmsBody({ order, foodTruck }),
    metadata: {
      orderId: order._id?.toString(),
      orderNumber: order.orderNumber,
      orderSource,
      paymentMethod,
      paymentStatus,
      receiptType: 'TAP_TO_PAY_SMS',
    },
  });
};

exports.buildTapToPayReceiptSmsBody = buildTapToPayReceiptSmsBody;
exports.sendWalkUpTapToPayReceiptSms = sendWalkUpTapToPayReceiptSms;
