const { MarketplaceEventModel, MarketplaceTicketModel } = require('../models');
const {
  getMarketplaceEventTiming,
} = require('./marketplace-event-close-helper');

const ONE_MINUTE = 60 * 1000;
const SCANNER_WINDOW_MS = 24 * 60 * 60 * 1000;
const NON_TICKETED_CLOSE_DELAY_MS = 24 * 60 * 60 * 1000;
const CLOSABLE_EVENT_STATUSES = ['OPEN', 'REOPENED', 'AWARDED'];

const shouldRevokeActiveTickets = (event = {}, update = {}) =>
  event.ticket_sales_enabled === true &&
  (
    !!update.ticket_scanning_closed_at ||
    (update.status === 'CLOSED' && !!event.ticket_scanning_closed_at)
  );

const getMarketplaceLifecycleUpdate = (event = {}, now = new Date()) => {
  const timing = getMarketplaceEventTiming(event);
  if (!timing) return null;

  const currentTime = new Date(now).getTime();
  const update = {};

  const eventEndTime = timing.end_at.getTime();
  const scannerDeadline = timing.start_at.getTime() + SCANNER_WINDOW_MS;

  if (currentTime >= eventEndTime && event.ticket_sales_enabled && !event.ticket_sales_closed_at) {
    update.ticket_sales_closed_at = now;
  }

  if (
    event.ticket_sales_enabled &&
    !event.ticket_scanning_closed_at &&
    currentTime >= scannerDeadline
  ) {
    update.ticket_scanning_closed_at = now;
  }

  const manuallyClosedScannerAt = event.ticket_scanning_closed_at
    ? new Date(event.ticket_scanning_closed_at).getTime()
    : NaN;
  const ticketedCloseTime = Number.isFinite(manuallyClosedScannerAt)
    ? Math.max(eventEndTime, manuallyClosedScannerAt)
    : Math.max(eventEndTime, scannerDeadline);
  const eventCloseTime = event.ticket_sales_enabled
    ? ticketedCloseTime
    : eventEndTime + NON_TICKETED_CLOSE_DELAY_MS;

  if (
    currentTime >= eventCloseTime &&
    CLOSABLE_EVENT_STATUSES.includes(event.status)
  ) {
    update.status = 'CLOSED';
    update.closed_at = event.closed_at || now;
    update.vendor_applications_closed_at =
      event.vendor_applications_closed_at || now;
  }

  return Object.keys(update).length ? update : null;
};

const reconcileMarketplaceEventLifecycles = async (now = new Date()) => {
  const candidates = await MarketplaceEventModel.find({
    $or: [
      { status: { $in: CLOSABLE_EVENT_STATUSES } },
      {
        ticket_sales_enabled: true,
        $or: [
          { ticket_sales_closed_at: null },
          { ticket_scanning_closed_at: null },
        ],
      },
    ],
  }).lean();

  const results = [];
  for (const event of candidates) {
    const update = getMarketplaceLifecycleUpdate(event, now);
    if (!update) continue;
    const result = await MarketplaceEventModel.updateOne(
      { _id: event._id },
      { $set: update }
    );
    if (result.modifiedCount || result.nModified) {
      let revokedTicketCount = 0;
      if (shouldRevokeActiveTickets(event, update)) {
        const ticketResult = await MarketplaceTicketModel.updateMany(
          { event_id: event.event_id, status: 'ACTIVE' },
          { $set: { status: 'REVOKED', revoked_at: now } }
        );
        revokedTicketCount = ticketResult.modifiedCount || ticketResult.nModified || 0;
      }
      results.push({
        event_id: event.event_id,
        fields: Object.keys(update),
        revokedTicketCount,
      });
    }
  }
  return results;
};

const runMarketplaceEventLifecycleMonitor = async () => {
  try {
    const results = await reconcileMarketplaceEventLifecycles();
    if (results.length) {
      console.info('Marketplace event lifecycle reconciled.', {
        eventCount: results.length,
        eventIds: results.map((item) => item.event_id),
      });
    }
  } catch (error) {
    console.error('Marketplace event lifecycle monitor failed.', {
      message: error?.message || 'Unknown error',
    });
  }
};

const startMarketplaceEventLifecycleMonitor = () => {
  const initial = setTimeout(runMarketplaceEventLifecycleMonitor, 10 * 1000);
  const timer = setInterval(runMarketplaceEventLifecycleMonitor, ONE_MINUTE);
  initial.unref?.();
  timer.unref?.();
  return timer;
};

module.exports = {
  CLOSABLE_EVENT_STATUSES,
  NON_TICKETED_CLOSE_DELAY_MS,
  SCANNER_WINDOW_MS,
  getMarketplaceLifecycleUpdate,
  shouldRevokeActiveTickets,
  reconcileMarketplaceEventLifecycles,
  runMarketplaceEventLifecycleMonitor,
  startMarketplaceEventLifecycleMonitor,
};
