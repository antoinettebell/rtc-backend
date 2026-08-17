const { getMarketplaceEventTiming } = require('./marketplace-event-close-helper');

const isMarketplaceEventExpired = (event = {}, now = new Date()) => {
  const timing = getMarketplaceEventTiming(event);
  if (!timing) return false;
  return timing.end_at.getTime() < new Date(now).getTime();
};

const getRemainingTicketInventory = (event = {}) => {
  const remainingGa = Math.max(
    0,
    Number(event.ga_ticket_quantity || 0) -
      Number(event.ga_tickets_sold || 0) -
      Number(event.ga_tickets_reserved || 0)
  );
  const remainingVip = event.vip_section_enabled
    ? Math.max(
      0,
      Number(event.vip_ticket_quantity || 0) -
        Number(event.vip_tickets_sold || 0) -
        Number(event.vip_tickets_reserved || 0)
    )
    : 0;
  return remainingGa + remainingVip;
};

const isPublicTicketPurchaseAvailable = (event = {}) =>
  event.ticket_sales_enabled === true &&
  !event.ticket_sales_closed_at &&
  !['DRAFT', 'CANCELLED'].includes(event.status) &&
  getRemainingTicketInventory(event) > 0;

const hasPublicEventAccess = (event = {}, now = new Date()) =>
  (event.status === 'OPEN' && !isMarketplaceEventExpired(event, now)) ||
  (event.status === 'CLOSED' && isPublicTicketPurchaseAvailable(event));

const filterActivePublicMarketplaceEvents = (events = [], now = new Date()) =>
  events.filter((event) => isPublicMarketplaceEventEligible(event, now));

const getPublicMarketplaceEventQuery = (eventId) => ({
  event_id: eventId,
  status: { $in: ['OPEN', 'CLOSED'] },
  event_visibility: 'PUBLIC',
  tax_exemption_status: { $in: ['NOT_REQUESTED', 'APPROVED'] },
});

const isPublicMarketplaceEventEligible = (event = {}, now = new Date()) =>
  event.event_visibility === 'PUBLIC' &&
  ['NOT_REQUESTED', 'APPROVED'].includes(event.tax_exemption_status) &&
  hasPublicEventAccess(event, now);

const PUBLIC_MARKETPLACE_EVENT_FIELDS = [
  'event_id', 'event_name', 'event_description', 'event_type', 'status',
  'event_date', 'event_time', 'event_timezone',
  'event_duration_hours', 'event_duration_minutes',
  'event_address', 'formatted_address', 'geocoded_address', 'event_city',
  'event_state', 'event_zip', 'latitude', 'longitude', 'primary_service_style',
  'service_styles', 'alcohol_required', 'ticket_sales_enabled',
  'ticket_sales_closed_at', 'ga_ticket_price', 'ga_ticket_quantity',
  'ga_tickets_sold', 'ga_tickets_reserved', 'vip_section_enabled',
  'vip_ticket_price', 'vip_ticket_quantity', 'vip_tickets_sold',
  'vip_tickets_reserved',
];

const sanitizePublicEventImage = (image = {}) => ({ image_url: image.image_url });

const sanitizePublicMarketplaceEvent = (event = {}) => {
  const sanitized = PUBLIC_MARKETPLACE_EVENT_FIELDS.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(event, field)) result[field] = event[field];
    return result;
  }, {});
  sanitized.images = (event.images || [])
    .filter((image) => image?.image_url)
    .map(sanitizePublicEventImage);
  return sanitized;
};

module.exports = {
  filterActivePublicMarketplaceEvents,
  getRemainingTicketInventory,
  getPublicMarketplaceEventQuery,
  isMarketplaceEventExpired,
  isPublicMarketplaceEventEligible,
  isPublicTicketPurchaseAvailable,
  sanitizePublicMarketplaceEvent,
};
