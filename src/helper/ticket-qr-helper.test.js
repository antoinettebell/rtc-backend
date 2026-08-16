const assert = require('node:assert/strict');
const {
  buildTicketQrDataUrl,
  buildTicketQrEmailAttachment,
} = require('./ticket-qr-helper');

(async () => {
  const ticketUrl = 'https://tickets.roundthecornerapp.com/t/secure-token';
  const dataUrl = await buildTicketQrDataUrl(ticketUrl);
  assert.match(dataUrl, /^data:image\/png;base64,/);

  const result = await buildTicketQrEmailAttachment({
    ticketId: 'ticket:123',
    ticketUrl,
  });
  assert.equal(result.contentId, 'rtc-ticket-ticket123');
  assert.equal(result.attachment.type, 'image/png');
  assert.equal(result.attachment.disposition, 'inline');
  assert.equal(result.attachment.content_id, result.contentId);
  assert.ok(Buffer.from(result.attachment.content, 'base64').length > 100);
  console.log('ticket QR helper tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
