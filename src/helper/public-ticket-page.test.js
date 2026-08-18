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
assert.match(scannerHtml, /scanner\.pause\(true\)/);
assert.match(scannerHtml, /scanner\.resume\(\)/);
assert.doesNotMatch(scannerHtml, /async function scan\(decoded\).*await stop\(\)/s);
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
const timers = [];
const scannerCalls = { start: 0, stop: 0, pause: 0, resume: 0 };
let scanHandler;
class FakeScanner {
  async start(_camera, _options, handler) {
    scannerCalls.start += 1;
    scanHandler = handler;
  }
  async stop() { scannerCalls.stop += 1; }
  pause() { scannerCalls.pause += 1; }
  resume() { scannerCalls.resume += 1; }
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
  setTimeout: (handler) => timers.push(handler),
};
vm.runInNewContext(script, context);

(async () => {
  await elements.toggle.handler();
  assert.equal(scannerCalls.start, 1);

  await scanHandler('https://tickets.roundthecornerapp.com/tickets/first-ticket');
  assert.equal(scannerCalls.pause, 1);
  assert.match(elements.result.textContent, /CHECKED IN: Guest 1/);
  timers.shift()();
  assert.equal(scannerCalls.resume, 1);

  await scanHandler('https://tickets.roundthecornerapp.com/tickets/used-ticket');
  assert.equal(scannerCalls.pause, 2);
  assert.equal(elements.result.textContent, 'Ticket already used');
  timers.shift()();
  assert.equal(scannerCalls.resume, 2);
  assert.equal(scannerCalls.start, 1, 'the same live camera session should scan the next ticket');
  assert.equal(scannerCalls.stop, 0, 'validation should not tear down the live camera session');

  console.log('public ticket page tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
