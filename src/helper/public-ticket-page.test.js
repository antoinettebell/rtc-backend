const assert = require('assert');
const { renderTicketPage, renderScannerPage } = require('./public-ticket-page');

const event = {
  event_id: 'event-1',
  event_name: '<Summer & Music>',
  event_address: '1 Main St',
  event_city: 'Buffalo',
  event_state: 'NY',
};
const ticketHtml = renderTicketPage({
  event,
  ticket: { ticket_type: 'GA', attendee_label: 'Guest 1', status: 'ACTIVE' },
  ticketUrl: 'https://tickets.roundthecornerapp.com/t/secret',
});
assert.match(ticketHtml, /&lt;Summer &amp; Music&gt;/);
assert.doesNotMatch(ticketHtml, /<Summer & Music>/);
assert.match(ticketHtml, /qrcodejs@1\.0\.0/);

const scannerHtml = renderScannerPage({ event, sessionToken: 'scanner-secret' });
assert.match(scannerHtml, /html5-qrcode@2\.3\.8/);
assert.match(scannerHtml, /facingMode:'environment'/);
assert.match(scannerHtml, /await stop\(\)/);
assert.match(scannerHtml, /success:before\{content:"✓"\}/);
assert.match(scannerHtml, /error:before\{content:"✕"\}/);

console.log('public ticket page tests passed');
