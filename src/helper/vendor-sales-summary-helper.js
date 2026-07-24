const toNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const roundMoney = (value) => Number(toNumber(value).toFixed(2));

const getOrderSubtotal = (order) =>
  toNumber(order?.subTotal ?? order?.subtotal ?? order?.sub_total);

const getOrderTax = (order) =>
  toNumber(order?.taxAmount ?? order?.tax ?? order?.tax_amount);

const getOrderVendorTip = (order) =>
  toNumber(order?.tipsAmount ?? order?.foodTruckTip ?? order?.vendorTip);

const isWalkUpOrder = (order) =>
  ['VENDOR_POS', 'WALK_UP_EMPLOYEE'].includes(
    String(order?.order_source || order?.orderSource || '').toUpperCase()
  );

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
    foodSubtotal +
      getOrderVendorTip(order) +
      (isWalkUpOrder(order) ? getOrderTax(order) : 0)
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
        orders: 0,
        refundsCancels: 0,
      },
    ])
  );

  const totals = orders.reduce(
    (summary, order) => {
      const refunded = isRefundedOrder(order);
      const cancelled = isCancelledOrder(order);
      const completedSale = isCompletedOrder(order) && !refunded && !cancelled;
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
        orders: 0,
        refundsCancels: 0,
      };

      if (completedSale) {
        const grossSales = getOrderFoodSalesAmount(order);
        summary.grossSales += grossSales;
        summary.orders += 1;
        existingTruck.grossSales += grossSales;
        existingTruck.orders += 1;
      }

      if (refunded || cancelled) {
        summary.refundsCancels += 1;
        existingTruck.refundsCancels += 1;
      }

      breakdownByTruck.set(truckKey, existingTruck);
      return summary;
    },
    { grossSales: 0, orders: 0, refundsCancels: 0 }
  );

  const formatSummary = (summary) => ({
    ...summary,
    grossSales: roundMoney(summary.grossSales),
    averageTicket: summary.orders
      ? roundMoney(summary.grossSales / summary.orders)
      : 0,
  });

  return {
    ...formatSummary(totals),
    breakdown: Array.from(breakdownByTruck.values()).map(formatSummary),
  };
};

module.exports = {
  getOrderFoodSalesAmount,
  isCancelledOrder,
  isCompletedOrder,
  isRefundedOrder,
  summarizeVendorSales,
};
