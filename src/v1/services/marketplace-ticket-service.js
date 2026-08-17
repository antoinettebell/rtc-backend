const {
  MarketplaceEventModel,
  MarketplaceTicketOrderModel,
  MarketplaceTicketModel,
} = require('../../models');
const { createTicketToken, buildPublicTicketUrl } = require('../../helper/ticket-token-helper');
const { server } = require('../../config');
const EncryptionService = require('../../helper/encryption');

const RESERVATION_MINUTES = 10;

const inventoryExpression = (type, requested) => ({
  $lte: [
    {
      $add: [
        { $ifNull: [`$${type}_tickets_sold`, 0] },
        { $ifNull: [`$${type}_tickets_reserved`, 0] },
        requested,
      ],
    },
    `$${type}_ticket_quantity`,
  ],
});

const reserveEventInventory = async ({ eventId, gaQuantity = 0, vipQuantity = 0 }) => {
  if (gaQuantity + vipQuantity < 1) throw new Error('At least one ticket is required');

  const event = await MarketplaceEventModel.findOneAndUpdate(
    {
      event_id: eventId,
      ticket_sales_enabled: true,
      status: { $nin: ['DRAFT', 'CANCELLED'] },
      ticket_sales_closed_at: null,
      $and: [
        { $expr: inventoryExpression('ga', gaQuantity) },
        { $expr: inventoryExpression('vip', vipQuantity) },
      ],
    },
    {
      $inc: {
        ga_tickets_reserved: gaQuantity,
        vip_tickets_reserved: vipQuantity,
      },
    },
    { new: true }
  ).lean();

  if (!event) {
    const error = new Error('Requested tickets are no longer available');
    error.code = 'TICKET_INVENTORY_EXCEEDED';
    throw error;
  }
  return event;
};

const adjustInventory = ({ eventId, gaReserved, vipReserved, gaSold = 0, vipSold = 0 }) =>
  MarketplaceEventModel.updateOne(
    { event_id: eventId },
    {
      $inc: {
        ga_tickets_reserved: -gaReserved,
        vip_tickets_reserved: -vipReserved,
        ga_tickets_sold: gaSold,
        vip_tickets_sold: vipSold,
      },
    }
  );

const confirmReservation = (order) =>
  adjustInventory({
    eventId: order.event_id,
    gaReserved: order.ga_quantity,
    vipReserved: order.vip_quantity,
    gaSold: order.ga_quantity,
    vipSold: order.vip_quantity,
  });

const releaseReservation = (order) =>
  adjustInventory({
    eventId: order.event_id,
    gaReserved: order.ga_quantity,
    vipReserved: order.vip_quantity,
  });

const createTicketsForPaidOrder = async (order) => {
  const specs = [
    ...Array.from({ length: order.ga_quantity }, (_, index) => ({
      ticket_type: 'GA',
      attendee_label: `Guest ${index + 1}`,
    })),
    ...Array.from({ length: order.vip_quantity }, (_, index) => ({
      ticket_type: 'VIP',
      attendee_label: `Guest ${order.ga_quantity + index + 1}`,
    })),
  ];

  const ticketsWithTokens = specs.map((spec) => {
    const { token, tokenHash } = createTicketToken();
    return {
      token,
      url: buildPublicTicketUrl(server.publicTicketBaseURL, token),
      document: {
        ...spec,
        token_hash: tokenHash,
        token_encrypted: EncryptionService.encrypt(token),
        ticket_order_id: order.ticket_order_id,
        event_id: order.event_id,
        customer_user_id: order.customer_user_id,
      },
    };
  });

  const inserted = await MarketplaceTicketModel.insertMany(
    ticketsWithTokens.map(({ document }) => document)
  );
  return inserted.map((ticket, index) => ({
    ticket: ticket.toObject(),
    token: ticketsWithTokens[index].token,
    url: ticketsWithTokens[index].url,
  }));
};

const expireReservations = async (now = new Date()) => {
  const expiredOrders = await MarketplaceTicketOrderModel.find({
    status: 'RESERVED',
    reservation_expires_at: { $lte: now },
  });
  for (const order of expiredOrders) {
    const claimed = await MarketplaceTicketOrderModel.findOneAndUpdate(
      { _id: order._id, status: 'RESERVED' },
      { $set: { status: 'EXPIRED' } },
      { new: true }
    );
    if (claimed) await releaseReservation(claimed);
  }
  return expiredOrders.length;
};

const reservationExpiry = (now = new Date()) =>
  new Date(now.getTime() + RESERVATION_MINUTES * 60 * 1000);

module.exports = {
  RESERVATION_MINUTES,
  reserveEventInventory,
  confirmReservation,
  releaseReservation,
  createTicketsForPaidOrder,
  expireReservations,
  reservationExpiry,
};
