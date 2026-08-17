const assert = require('assert');
const publicRouter = require('./public');
const marketplaceRouter = require('./marketplace');
const { MarketplaceController } = require('../controllers');
const { MarketplaceEventService } = require('../services');

const findRoute = (router, path, method) => router.stack.find(
  (layer) => layer.route?.path === path && layer.route.methods?.[method]
);

const publicDetail = findRoute(publicRouter, '/marketplace/events/:eventId', 'get');
assert(publicDetail, 'Public event-detail route must exist');
assert.equal(publicDetail.route.stack.length, 1, 'Public event-detail GET must not authenticate');
assert.notEqual(publicDetail.route.stack[0].handle.name, 'Authenticate');

const ticketInvitation = findRoute(
  publicRouter,
  '/marketplace/ticket-invitations/:shareToken',
  'get'
);
const guestTicketQuote = findRoute(
  publicRouter,
  '/marketplace/ticket-invitations/:shareToken/quote',
  'post'
);
const guestTicketCheckout = findRoute(
  publicRouter,
  '/marketplace/ticket-invitations/:shareToken/checkout',
  'post'
);
const publicEventGuestTicketQuote = findRoute(
  publicRouter,
  '/marketplace/events/:eventId/tickets/quote',
  'post'
);
const publicEventGuestTicketCheckout = findRoute(
  publicRouter,
  '/marketplace/events/:eventId/tickets/checkout',
  'post'
);
assert(ticketInvitation && guestTicketQuote && guestTicketCheckout, 'Guest ticket routes must exist');
assert(
  publicEventGuestTicketQuote && publicEventGuestTicketCheckout,
  'Public-event guest checkout routes must exist'
);
assert.equal(ticketInvitation.route.stack.length, 1, 'Ticket invitation GET must not authenticate');
assert.notEqual(ticketInvitation.route.stack[0].handle.name, 'Authenticate');
assert.notEqual(guestTicketQuote.route.stack[0].handle.name, 'Authenticate');
assert.notEqual(guestTicketCheckout.route.stack[0].handle.name, 'Authenticate');
assert.notEqual(publicEventGuestTicketQuote.route.stack[0].handle.name, 'Authenticate');
assert.notEqual(publicEventGuestTicketCheckout.route.stack[0].handle.name, 'Authenticate');

const ticketClick = findRoute(publicRouter, '/marketplace/events/:eventId/ticket-click', 'post');
assert.equal(ticketClick.route.stack[0].handle.name, 'Authenticate');

const quote = findRoute(marketplaceRouter, '/events/:eventId/tickets/quote', 'post');
const checkout = findRoute(marketplaceRouter, '/events/:eventId/tickets/checkout', 'post');
assert(quote && checkout, 'Protected ticket routes must exist');

const exerciseCustomerGuard = (route, user) => new Promise((resolve) => {
  let nextCalled = false;
  const req = { user };
  const res = { error: (_error, status) => resolve({ nextCalled, status }) };
  route.route.stack[0].handle(req, res, () => {
    nextCalled = true;
    resolve({ nextCalled, status: null });
  });
});

(async () => {
  assert.deepEqual(await exerciseCustomerGuard(quote, undefined), { nextCalled: false, status: 403 });
  assert.deepEqual(await exerciseCustomerGuard(checkout, undefined), { nextCalled: false, status: 403 });
  assert.deepEqual(await exerciseCustomerGuard(quote, { userType: 'CUSTOMER' }), { nextCalled: true, status: null });
  assert.deepEqual(await exerciseCustomerGuard(checkout, { userType: 'CUSTOMER' }), { nextCalled: true, status: null });

  const originalGetByData = MarketplaceEventService.getByData;
  const originalGetWithImages = MarketplaceEventService.getWithImages;
  const originalUpdate = MarketplaceEventService.update;
  const eligibleEvent = {
    event_id: 'event-1', event_name: 'Public Festival', event_description: 'Public details',
    status: 'OPEN', event_visibility: 'PUBLIC', tax_exemption_status: 'APPROVED',
    event_date: new Date('2099-08-08T00:00:00.000Z'), event_time: '10:00',
    event_duration_hours: 4, event_duration_minutes: 0,
    event_timezone: 'America/New_York', ticket_sales_enabled: true,
    ga_ticket_price: 25, ga_ticket_quantity: 100, ga_tickets_sold: 10,
    tax_exemption_certificate_url: 'https://private/certificate.pdf',
    tax_exemption_certificate: { file_url: 'https://private/certificate.pdf' },
    coordinator_tax_id: 'private-tax-id', routing_number: 'private-routing',
    payment_handle: '$private', agreement_document_url: 'https://private/agreement.pdf',
    images: [{
      image_id: 'image-1', image_url: 'https://public/event.jpg',
      image_key: 'private-image-key', uploaded_by_user_id: 'private-user',
    }],
  };
  let scenario = eligibleEvent;
  MarketplaceEventService.getByData = async () => scenario;
  MarketplaceEventService.getWithImages = async () => scenario;
  MarketplaceEventService.update = async () => scenario;

  const callPublicController = () => new Promise((resolve) => {
    const req = { params: { eventId: 'event-1' } };
    const res = { data: (data, message) => resolve({ data, message, error: null }) };
    MarketplaceController.getPublicOpenEvent(req, res, (error) => resolve({ error }));
  });

  try {
    const publicResponse = await callPublicController();
    assert.ifError(publicResponse.error);
    const publicEvent = publicResponse.data.marketplaceEvent;
    assert.equal(publicEvent.event_name, 'Public Festival');
    assert.equal(publicEvent.ga_ticket_price, 25);
    assert.deepEqual(publicEvent.images, [{ image_url: 'https://public/event.jpg' }]);
    assert.equal(publicEvent.tax_exemption_certificate_url, undefined);
    assert.equal(publicEvent.tax_exemption_certificate, undefined);
    assert.equal(publicEvent.coordinator_tax_id, undefined);
    assert.equal(publicEvent.routing_number, undefined);
    assert.equal(publicEvent.payment_handle, undefined);
    assert.equal(publicEvent.agreement_document_url, undefined);
    assert.equal(publicEvent.images[0].image_key, undefined);

    for (const invalidEvent of [
      { ...eligibleEvent, event_visibility: 'PRIVATE' },
      { ...eligibleEvent, status: 'CLOSED' },
      { ...eligibleEvent, event_date: new Date('2020-01-01T00:00:00.000Z') },
      { ...eligibleEvent, tax_exemption_status: 'PENDING' },
      null,
    ]) {
      scenario = invalidEvent;
      const result = await callPublicController();
      assert.equal(result.error?.code, 404);
    }
  } finally {
    MarketplaceEventService.getByData = originalGetByData;
    MarketplaceEventService.getWithImages = originalGetWithImages;
    MarketplaceEventService.update = originalUpdate;
  }
  console.log('Public marketplace event route-access tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
