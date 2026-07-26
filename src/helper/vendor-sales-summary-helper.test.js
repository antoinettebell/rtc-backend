const assert = require('assert');
const { summarizeVendorSales } = require('./vendor-sales-summary-helper');

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
    orders: summary.orders,
    refundsCancels: summary.refundsCancels,
    averageTicket: summary.averageTicket,
  },
  { grossSales: 52, orders: 2, refundsCancels: 2, averageTicket: 26 }
);

assert.deepStrictEqual(
  summary.breakdown.map((truck) => ({
    label: truck.label,
    grossSales: truck.grossSales,
    orders: truck.orders,
    refundsCancels: truck.refundsCancels,
    averageTicket: truck.averageTicket,
  })),
  [
    {
      label: 'Pizza House',
      grossSales: 22,
      orders: 1,
      refundsCancels: 1,
      averageTicket: 22,
    },
    {
      label: 'Pizza House 2',
      grossSales: 30,
      orders: 1,
      refundsCancels: 1,
      averageTicket: 30,
    },
  ]
);

console.log('vendor sales summary helper tests passed');
