const {
  EmployeeRefundCancelRequestModel: Model,
} = require('../../models');
const { BaseService } = require('../../common-services');
const FoodTruckService = require('./food-truck-service');
const OrderService = require('./order-service');
const PaymentsLogService = require('./payments-log');
const PaymentHelper = require('../../helper/payment-helper');
const CustomNotification = require('../../helper/custom-notification');

const buildError = (message, code = 409) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const toMoney = (value, fallback = 0) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : fallback;
};

const isCashPaymentMethod = (paymentMethod) =>
  ['COD', 'CASH'].includes(String(paymentMethod || '').toUpperCase());

const isGatewayPaymentMethod = (paymentMethod) =>
  !isCashPaymentMethod(paymentMethod);

const PAID_PAYMENT_STATUSES = ['PAID', 'COMPLETED', 'CAPTURED'];
const POST_PICKUP_STATUSES = ['DRIVER_PICKED_UP', 'DELIVERED', 'COMPLETED'];
const REFUNDABLE_STATUSES = [
  'PREPARING',
  'READY_FOR_PICKUP',
  'DRIVER_PICKED_UP',
  'DELIVERED',
  'COMPLETED',
];
const TEN_MINUTES_MS = 10 * 60 * 1000;

const getCompletedAt = (order) =>
  order.completed_at || order.statusTime?.completedAt || null;

const isPastCompletedRefundWindow = (order) => {
  if (order.orderStatus !== 'COMPLETED') {
    return false;
  }

  const completedAt = getCompletedAt(order);
  if (!completedAt) {
    return false;
  }

  const completedDate = new Date(completedAt);
  if (Number.isNaN(completedDate.getTime())) {
    return false;
  }

  return Date.now() - completedDate.getTime() > TEN_MINUTES_MS;
};

const isPaidOrPickedUp = (order) =>
  PAID_PAYMENT_STATUSES.includes(String(order.paymentStatus || '').toUpperCase()) ||
  POST_PICKUP_STATUSES.includes(String(order.orderStatus || '').toUpperCase());

const assertRefundCancelAllowed = ({
  order,
  request_type,
  reason_code,
  employee_notes,
}) => {
  if (reason_code === 'other' && !String(employee_notes || '').trim()) {
    throw buildError('Notes are required when reason is other.');
  }

  if (order.paymentStatus === 'REFUNDED') {
    throw buildError('Order has already been refunded.');
  }

  if (isPaidOrPickedUp(order) && request_type !== 'REFUND') {
    throw buildError('Only a refund can be requested after payment or pickup.');
  }

  if (
    request_type === 'REFUND' &&
    isCashPaymentMethod(order.paymentMethod || order.payment_method) &&
    reason_code === 'payment issue'
  ) {
    throw buildError('Payment issue is not available for cash refunds.');
  }

  if (request_type === 'CANCEL' && isPaidOrPickedUp(order)) {
    throw buildError('Cancel is only available before payment.');
  }

  if (request_type === 'REFUND' && !REFUNDABLE_STATUSES.includes(order.orderStatus)) {
    throw buildError('Refund requests are not available for this order status.');
  }

  if (request_type === 'CANCEL' && !['PREPARING', 'READY_FOR_PICKUP'].includes(order.orderStatus)) {
    throw buildError('Cancel requests are only available before pickup.');
  }

  if (isPastCompletedRefundWindow(order)) {
    throw buildError(
      'Refund requests are only available for 10 minutes after completion.'
    );
  }
};

class EmployeeRefundCancelRequestService extends BaseService {
  constructor() {
    super(Model);
  }

  async submitForEmployee({
    user,
    orderId,
    order_id,
    request_type,
    reason_code,
    employee_notes,
  }) {
    const orderLookupId = orderId || order_id;
    const order = await OrderService.getById(orderLookupId);
    if (!order) {
      throw buildError('Order not found.', 404);
    }

    if (
      order.foodTruckId?.toString() !== user.food_truck_id?.toString() ||
      order.locationId?.toString() !== user.assigned_location_id?.toString() ||
      order.created_by_type !== 'EMPLOYEE' ||
      order.employee_internal_id !== user.employee_internal_id
    ) {
      throw buildError('Order not found or access denied.', 403);
    }

    if (!['VENDOR_POS', 'WALK_UP_EMPLOYEE'].includes(order.orderSource)) {
      throw buildError('Only walk-up orders can use this workflow.');
    }

    assertRefundCancelAllowed({
      order,
      request_type,
      reason_code,
      employee_notes,
    });

    const existing = await Model.findOne({
      order_id: order._id,
      request_status: { $in: ['PENDING', 'REJECTED'] },
    }).lean();

    if (existing) {
      if (request_type === 'REFUND' && order.refundStatus !== 'PENDING') {
        order.refundStatus = 'PENDING';
        order.refundReason = reason_code || null;
        await order.save();
      }
      return { request: existing, existing: true };
    }

    const request = await this.create({
      order_id: order._id,
      employee_internal_id: user.employee_internal_id,
      employee_login_id: user.employee_login_id,
      employee_session_id: user.employee_session_id || null,
      vendor_user_id: user.vendor_user_id,
      food_truck_id: user.food_truck_id,
      location_id: user.assigned_location_id,
      request_type,
      reason_code,
      employee_notes: employee_notes || null,
      original_payment_method: order.paymentMethod || order.payment_method || null,
      original_order_status: order.orderStatus || null,
      original_payment_status: order.paymentStatus || null,
    });

    await CustomNotification.sendEmployeeRefundCancelRequestNotification(
      { _id: user.vendor_user_id },
      request,
      order
    );

    if (request_type === 'REFUND') {
      order.refundStatus = 'PENDING';
      order.refundReason = reason_code || null;
      order.refundErrorMessage = null;
      await order.save();
    }
    // TODO: Add employee push notification when employee notification routing exists.

    return { request, existing: false };
  }

  async listForVendor({
    vendorUserId,
    foodTruckId,
    status,
    employeeInternalId,
    locationId,
    truckUnitId,
    limit = 50,
  }) {
    const foodTruck = await FoodTruckService.getByData(
      { _id: foodTruckId, userId: vendorUserId },
      { singleResult: true }
    );

    if (!foodTruck) {
      throw buildError('Food truck not found or access denied.', 404);
    }

    const requests = await Model.find({
      vendor_user_id: vendorUserId,
      food_truck_id: foodTruckId,
      ...(status ? { request_status: status } : {}),
      ...(employeeInternalId ? { employee_internal_id: employeeInternalId } : {}),
      ...(locationId ? { location_id: locationId } : {}),
    })
      .sort({ requested_at: -1 })
      .limit(Number(limit) || 50)
      .populate('order_id')
      .lean();

    if (!truckUnitId) {
      return requests;
    }

    return requests.filter(
      (request) =>
        request.order_id?.truck_unit_id?.toString() === truckUnitId?.toString()
    );
  }

  async listForEmployee({ user, orderId }) {
    return Model.find({
      employee_internal_id: user.employee_internal_id,
      food_truck_id: user.food_truck_id,
      location_id: user.assigned_location_id,
      ...(orderId ? { order_id: orderId } : {}),
    })
      .sort({ requested_at: -1 })
      .lean();
  }

  async reviewForVendor({ vendorUserId, requestId, request_status, vendor_response_notes }) {
    const request = await Model.findOne({ request_id: requestId });
    if (!request) {
      throw buildError('Request not found.', 404);
    }

    if (request.vendor_user_id?.toString() !== vendorUserId?.toString()) {
      throw buildError('Request not found or access denied.', 404);
    }

    if (request.request_status !== 'PENDING') {
      throw buildError('Only pending requests can be reviewed.');
    }

    const foodTruck = await FoodTruckService.getByData(
      { _id: request.food_truck_id, userId: vendorUserId },
      { singleResult: true }
    );

    if (!foodTruck) {
      throw buildError('Food truck not found or access denied.', 404);
    }

    if (request_status === 'REJECTED') {
      if (!String(vendor_response_notes || '').trim()) {
        throw buildError('Vendor notes are required when rejecting a request.');
      }
      request.request_status = 'REJECTED';
      request.reviewed_at = new Date();
      request.reviewed_by_vendor_user_id = vendorUserId;
      request.vendor_response_notes = vendor_response_notes || null;
      const order = await OrderService.getById(request.order_id);
      if (order && request.request_type === 'REFUND') {
        order.refundStatus = null;
        order.refundErrorMessage = null;
        await order.save();
      }
      await request.save();
      return { request, order: null, refund: null };
    }

    const { order, refund } = await this.processApprovedRequest({
      request,
      vendorUserId,
    });

    request.request_status = 'APPROVED';
    request.reviewed_at = new Date();
    request.reviewed_by_vendor_user_id = vendorUserId;
    request.vendor_response_notes = vendor_response_notes || null;
    await request.save();

    return { request, order, refund };
  }

  async processApprovedRequest({ request, vendorUserId }) {
    const order = await OrderService.getById(request.order_id);
    if (!order) {
      throw buildError('Order not found.', 404);
    }

    if (order.foodTruckId?.toString() !== request.food_truck_id?.toString()) {
      throw buildError('Order not found or access denied.', 404);
    }

    assertRefundCancelAllowed({
      order,
      request_type: request.request_type,
      reason_code: request.reason_code,
      employee_notes: request.employee_notes,
    });

    const reason =
      request.vendor_response_notes ||
      request.employee_notes ||
      request.reason_code ||
      'Employee refund/cancel request';
    let refundResponse = null;

    if (
      request.request_type === 'REFUND' ||
      isGatewayPaymentMethod(order.paymentMethod)
    ) {
      refundResponse = {
        success: true,
        mode: isCashPaymentMethod(order.paymentMethod) ? 'cash' : null,
        amount: 0,
        message: 'Cash refund recorded',
      };

      if (isGatewayPaymentMethod(order.paymentMethod)) {
        if (!order.transactionId) {
          throw buildError('Order transaction is missing.');
        }

        const refundAmount = Math.max(
          0,
          toMoney((order.total || 0) - (order.tipsAmount || 0))
        );

        if (refundAmount <= 0) {
          throw buildError('Refund amount must be greater than zero.');
        }

        refundResponse = await PaymentHelper.processRefund({
          transactionId: order.transactionId,
          amount: refundAmount,
        });

        if (!refundResponse.skipLog) {
          await PaymentsLogService.create({
            userId: order.userId,
            orderId: order._id,
            type: 'REFUND',
            mode: refundResponse.env,
            level: refundResponse?.level || null,
            amount: Number(refundAmount),
            requestPayload: {
              orderId: order._id,
              requestId: request.request_id,
              transactionId: order.transactionId,
              amount: refundAmount,
              reason,
              excludedTip: toMoney(order.tipsAmount || 0),
            },
            responsePayload: refundResponse,
            transactionId: order.transactionId,
            uniqueId: refundResponse?.refundTransactionId || null,
            authCode: refundResponse?.authCode || null,
            response_type: refundResponse.success
              ? refundResponse?.mode === 'void'
                ? 'VOID'
                : 'REFUND'
              : 'REFUND',
            accountNumber: refundResponse.accountNumber || null,
            accountType: refundResponse.accountType || null,
            success: refundResponse.success,
            errorCode: refundResponse.success ? null : refundResponse.code,
            errorMessage: refundResponse.success ? null : refundResponse.message,
          });
        }

        if (!refundResponse.success) {
          order.refundStatus = 'FAILED';
          order.refundErrorMessage = refundResponse.message;
          await order.save();
          throw buildError(refundResponse.message || 'Refund/void failed.', 400);
        }
      }

      order.paymentStatus = 'REFUNDED';
      order.refundTransactionId = refundResponse?.refundTransactionId || null;
      order.refundDateTime = new Date();
      order.refundStatus = 'SUCCESS';
      order.refundReason = reason;
      order.refundMode = isGatewayPaymentMethod(order.paymentMethod)
        ? refundResponse?.mode === 'void'
          ? 'VOID'
          : 'REFUND'
        : null;
      order.refundErrorMessage = null;
    }

    if (request.request_type === 'CANCEL') {
      order.orderStatus = 'CANCEL';
      order.status = 'CANCEL';
      order.cancelReason = reason;
      order.statusTime = order.statusTime || {
        placedAt: order.createdAt,
        canceledAt: null,
        acceptedAt: null,
        rejectedAt: null,
        preparingAt: null,
        readyAt: null,
        driverPickedUpAt: null,
        deliveredAt: null,
        completedAt: null,
      };
      order.statusTime.canceledAt = new Date().toISOString();
    }
    await order.save();

    return { order, refund: refundResponse };
  }
}

module.exports = new EmployeeRefundCancelRequestService();
