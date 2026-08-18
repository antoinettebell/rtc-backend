const assert = require('assert');
const vm = require('vm');
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
  qrDataUrl: 'data:image/png;base64,secure-ticket-qr',
});
assert.match(ticketHtml, /&lt;Summer &amp; Music&gt;/);
assert.doesNotMatch(ticketHtml, /<Summer & Music>/);
assert.match(ticketHtml, /<img src="data:image\/png;base64,secure-ticket-qr"/);
assert.doesNotMatch(ticketHtml, /qrcodejs|new QRCode/);

const scannerHtml = renderScannerPage({ event, sessionToken: 'scanner-secret' });
assert.match(scannerHtml, /html5-qrcode@2\.3\.8/);
assert.match(scannerHtml, /facingMode:'environment'/);
assert.doesNotMatch(scannerHtml, /scanner\.pause\(true\)/);
assert.doesNotMatch(scannerHtml, /scanner\.resume\(\)/);
assert.doesNotMatch(scannerHtml, /setTimeout\(rearm/);
assert(
  scannerHtml.indexOf('id="result"') < scannerHtml.indexOf('id="reader"'),
  'the scan result must appear above the camera preview'
);
assert.match(scannerHtml, /success:before\{content:"✓"\}/);
assert.match(scannerHtml, /error:before\{content:"✕"\}/);

const script = scannerHtml.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/)[1];
const elements = {
  result: { className: '', textContent: '' },
  toggle: {
    textContent: '',
    addEventListener(_event, handler) { this.handler = handler; },
  },
};
const scannerCalls = { start: 0, stop: 0, clear: 0 };
let scanHandler;
class FakeScanner {
  async start(_camera, _options, handler) {
    scannerCalls.start += 1;
    scanHandler = handler;
  }
  async stop() { scannerCalls.stop += 1; }
  async clear() { scannerCalls.clear += 1; }
}
const responses = [
  { ok: true, body: { success: true, data: { attendeeName: 'Guest 1', ticketType: 'GA' } } },
  { ok: false, body: { success: false, message: 'Ticket already used' } },
];
const context = {
  document: { getElementById: (id) => elements[id] },
  Html5Qrcode: FakeScanner,
  navigator: { vibrate() {} },
  URL,
  fetch: async () => {
    const response = responses.shift();
    return { ok: response.ok, json: async () => response.body };
  },
};
vm.runInNewContext(script, context);

(async () => {
  await elements.toggle.handler();
  assert.equal(scannerCalls.start, 1);

  await scanHandler('https://tickets.roundthecornerapp.com/tickets/first-ticket');
  assert.equal(scannerCalls.stop, 1);
  assert.equal(scannerCalls.clear, 1);
  assert.match(elements.result.textContent, /CHECKED IN: Guest 1/);
  assert.equal(elements.toggle.textContent, 'Scan Next Ticket');

  await elements.toggle.handler();
  assert.equal(scannerCalls.start, 2, 'Scan Next Ticket must start a fresh camera session');

  await scanHandler('https://tickets.roundthecornerapp.com/tickets/used-ticket');
  assert.equal(scannerCalls.stop, 2);
  assert.equal(scannerCalls.clear, 2);
  assert.equal(elements.result.textContent, 'Ticket already used');
  assert.equal(elements.toggle.textContent, 'Scan Next Ticket');

  console.log('public ticket page tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
