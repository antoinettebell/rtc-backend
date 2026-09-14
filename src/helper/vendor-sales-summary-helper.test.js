const assert = require('assert');
const {
  getCashDrawerAmount,
  summarizeVendorSales,
} = require('./vendor-sales-summary-helper');

const foodTruck = {
  name: 'Pizza House',
  truck_units: [
    { _id: 'truck-1', name: 'Pizza House', is_primary: true },
    { _id: 'truck-2', name: 'Pizza House 2' },
  ],
};

const summary = summarizeVendorSales({
  foodTruck,
  orders: [
    {
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      totalAfterDiscount: 20,
      tipsAmount: 2,
      truck_unit_id: 'truck-1',
      truck_unit_name: 'Pizza House',
    },
    {
      orderStatus: 'DELIVERED',
      paymentStatus: 'PAID',
      totalAfterDiscount: 30,
      orderSource: 'VENDOR_POS',
      taxAmount: 3,
      truck_unit_id: 'truck-2',
      truck_unit_name: 'Pizza House 2',
    },
    {
      orderStatus: 'CANCEL',
      paymentStatus: 'REFUNDED',
      totalAfterDiscount: 50,
      truck_unit_id: 'truck-2',
      truck_unit_name: 'Pizza House 2',
    },
    {
      orderStatus: 'COMPLETED',
      paymentStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
      totalAfterDiscount: 10,
      tipsAmount: 1,
      truck_unit_id: 'truck-1',
      truck_unit_name: 'Pizza House',
    },
    {
      orderStatus: 'PLACED',
      paymentStatus: 'PENDING',
      totalAfterDiscount: 100,
      truck_unit_id: 'truck-1',
      truck_unit_name: 'Pizza House',
    },
  ],
});

assert.deepStrictEqual(
  {
    grossSales: summary.grossSales,
    netEarnings: summary.netEarnings,
    orders: summary.orders,
    paidOrders: summary.paidOrders,
    refundsCancels: summary.refundsCancels,
    averageTicket: summary.averageTicket,
  },
  {
    grossSales: 113,
    netEarnings: 53,
    orders: 5,
    paidOrders: 4,
    refundsCancels: 2,
    averageTicket: 28.25,
  }
);

assert.deepStrictEqual(
  summary.breakdown.map((truck) => ({
    label: truck.label,
    grossSales: truck.grossSales,
    netEarnings: truck.netEarnings,
    orders: truck.orders,
    paidOrders: truck.paidOrders,
    refundsCancels: truck.refundsCancels,
    averageTicket: truck.averageTicket,
  })),
  [
    {
      label: 'Pizza House',
      grossSales: 33,
      netEarnings: 23,
      orders: 3,
      paidOrders: 2,
      refundsCancels: 1,
      averageTicket: 16.5,
    },
    {
      label: 'Pizza House 2',
      grossSales: 80,
      netEarnings: 30,
      orders: 2,
      paidOrders: 2,
      refundsCancels: 1,
      averageTicket: 40,
    },
  ]
);

assert.strictEqual(
  getCashDrawerAmount({
    paymentMethod: 'CASH',
    paymentStatus: 'REFUNDED',
    refundStatus: 'SUCCESS',
    total: 14.01,
    tipsAmount: 1.2,
  }),
  1.2
);

const refundRegressionSummary = summarizeVendorSales({
  orders: [
    {
      orderNumber: 18,
      orderStatus: 'PREPARING',
      paymentStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
      totalAfterDiscount: 12,
      tipsAmount: 1.2,
      paymentMethod: 'CASH',
    },
    {
      orderNumber: 19,
      orderStatus: 'PREPARING',
      paymentStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
      totalAfterDiscount: 0.01,
      tipsAmount: 0.01,
      paymentMethod: 'CASH',
    },
    {
      orderNumber: 20,
      orderStatus: 'PREPARING',
      paymentStatus: 'PAID',
      totalAfterDiscount: 0.02,
      tipsAmount: 0.01,
      paymentMethod: 'CASH',
    },
  ],
});

assert.deepStrictEqual(
  {
    grossSales: refundRegressionSummary.grossSales,
    netEarnings: refundRegressionSummary.netEarnings,
    orders: refundRegressionSummary.orders,
    paidOrders: refundRegressionSummary.paidOrders,
    refundsCancels: refundRegressionSummary.refundsCancels,
    averageTicket: refundRegressionSummary.averageTicket,
  },
  {
    grossSales: 13.25,
    netEarnings: 1.24,
    orders: 3,
    paidOrders: 3,
    refundsCancels: 2,
    averageTicket: 4.42,
  }
);

console.log('vendor sales summary helper tests passed');
