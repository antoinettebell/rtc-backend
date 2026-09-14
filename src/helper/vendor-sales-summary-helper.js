const toNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const roundMoney = (value) => Number(toNumber(value).toFixed(2));

const getOrderSubtotal = (order) =>
  toNumber(order?.subTotal ?? order?.subtotal ?? order?.sub_total);

const getOrderVendorTip = (order) =>
  toNumber(order?.tipsAmount ?? order?.foodTruckTip ?? order?.vendorTip);

const getOrderFoodSalesAmount = (order) => {
  const hasTotalAfterDiscount =
    order?.totalAfterDiscount !== undefined &&
    order?.totalAfterDiscount !== null;
  const foodSubtotal = hasTotalAfterDiscount
    ? toNumber(order.totalAfterDiscount)
    : Math.max(
        0,
        getOrderSubtotal(order) -
          toNumber(order?.discount || order?.discountAmount || order?.disAmount)
      );

  return roundMoney(
    foodSubtotal + getOrderVendorTip(order)
  );
};

const isRefundedOrder = (order) =>
  String(order?.paymentStatus || '').toUpperCase() === 'REFUNDED' ||
  String(order?.refundStatus || '').toUpperCase() === 'SUCCESS';

const isCancelledOrder = (order) =>
  ['CANCEL', 'REJECTED'].includes(
    String(order?.orderStatus || '').toUpperCase()
  );

const isCompletedOrder = (order) =>
  ['DELIVERED', 'COMPLETED'].includes(
    String(order?.orderStatus || '').toUpperCase()
  );

const isRevenueOrder = (order) => {
  if (isCancelledOrder(order) && !isRefundedOrder(order)) return false;
  const paymentStatus = String(order?.paymentStatus || '').toUpperCase();
  return (
    ['PAID', 'COMPLETED', 'CAPTURED', 'REFUNDED'].includes(paymentStatus) ||
    isRefundedOrder(order) ||
    isCompletedOrder(order)
  );
};

const getOrderGrossSalesAmount = (order) =>
  isRevenueOrder(order) ? getOrderFoodSalesAmount(order) : 0;

const getOrderNetEarningsAmount = (order) => {
  if (!isRevenueOrder(order)) return 0;
  if (isRefundedOrder(order)) return roundMoney(getOrderVendorTip(order));
  return getOrderFoodSalesAmount(order);
};

const getCashDrawerAmount = (order) => {
  const paymentMethod = String(
    order?.paymentMethod || order?.payment_method || ''
  ).toUpperCase();
  if (!['CASH', 'COD'].includes(paymentMethod) || !isRevenueOrder(order)) {
    return 0;
  }
  if (isRefundedOrder(order)) return roundMoney(getOrderVendorTip(order));
  return roundMoney(toNumber(order?.total));
};

const getTruckUnitKey = (order) =>
  order?.truck_unit_id?.toString() || `name:${order?.truck_unit_name || ''}`;

const summarizeVendorSales = ({ orders = [], foodTruck = {} } = {}) => {
  const activeTruckUnits = (foodTruck.truck_units || []).filter(
    (unit) => !unit.is_archived
  );
  const primaryTruckUnit =
    activeTruckUnits.find((unit) => unit.is_primary) || activeTruckUnits[0];
  const breakdownByTruck = new Map(
    activeTruckUnits.map((unit, index) => [
      unit._id?.toString() || `configured:${index}`,
      {
        truckUnitId: unit._id?.toString() || null,
        label: unit.name || `Food Truck ${index + 1}`,
        grossSales: 0,
        netEarnings: 0,
        orders: 0,
        paidOrders: 0,
        refundsCancels: 0,
      },
    ])
  );

  const totals = orders.reduce(
    (summary, order) => {
      const refunded = isRefundedOrder(order);
      const cancelled = isCancelledOrder(order);
      const configuredTruck = activeTruckUnits.find(
        (unit) => unit._id?.toString() === order?.truck_unit_id?.toString()
      );
      const fallbackTruck = configuredTruck || primaryTruckUnit;
      const truckKey =
        configuredTruck?._id?.toString() ||
        (!order?.truck_unit_id && fallbackTruck?._id?.toString()) ||
        getTruckUnitKey(order);
      const existingTruck = breakdownByTruck.get(truckKey) || {
        truckUnitId:
          order?.truck_unit_id?.toString() ||
          fallbackTruck?._id?.toString() ||
          null,
        label:
          order?.truck_unit_name ||
          fallbackTruck?.name ||
          foodTruck.name ||
          'Food Truck',
        grossSales: 0,
        netEarnings: 0,
        orders: 0,
        paidOrders: 0,
        refundsCancels: 0,
      };

      summary.orders += 1;
      existingTruck.orders += 1;

      if (isRevenueOrder(order)) {
        const grossSales = getOrderGrossSalesAmount(order);
        const netEarnings = getOrderNetEarningsAmount(order);
        summary.grossSales += grossSales;
        summary.netEarnings += netEarnings;
        summary.paidOrders += 1;
        existingTruck.grossSales += grossSales;
        existingTruck.netEarnings += netEarnings;
        existingTruck.paidOrders += 1;
      }

      if (refunded || cancelled) {
        summary.refundsCancels += 1;
        existingTruck.refundsCancels += 1;
      }

      breakdownByTruck.set(truckKey, existingTruck);
      return summary;
    },
    { grossSales: 0, netEarnings: 0, orders: 0, paidOrders: 0, refundsCancels: 0 }
  );

  const formatSummary = (summary) => ({
    ...summary,
    grossSales: roundMoney(summary.grossSales),
    netEarnings: roundMoney(summary.netEarnings),
    averageTicket: summary.paidOrders
      ? roundMoney(summary.grossSales / summary.paidOrders)
      : 0,
  });

  return {
    ...formatSummary(totals),
    breakdown: Array.from(breakdownByTruck.values()).map(formatSummary),
  };
};

module.exports = {
  getOrderFoodSalesAmount,
  getOrderGrossSalesAmount,
  getOrderNetEarningsAmount,
  getCashDrawerAmount,
  isCancelledOrder,
  isCompletedOrder,
  isRefundedOrder,
  isRevenueOrder,
  summarizeVendorSales,
};
