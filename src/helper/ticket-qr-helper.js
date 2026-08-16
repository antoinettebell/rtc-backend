const QRCode = require('qrcode');

const QR_OPTIONS = {
  errorCorrectionLevel: 'H',
  margin: 2,
  width: 320,
};

const buildTicketQrDataUrl = (ticketUrl) =>
  QRCode.toDataURL(String(ticketUrl), QR_OPTIONS);

const buildTicketQrEmailAttachment = async ({ ticketId, ticketUrl }) => {
  const contentId = `rtc-ticket-${String(ticketId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const image = await QRCode.toBuffer(String(ticketUrl), {
    ...QR_OPTIONS,
    type: 'png',
  });
  return {
    contentId,
    attachment: {
      content: image.toString('base64'),
      filename: `${contentId}.png`,
      type: 'image/png',
      disposition: 'inline',
      content_id: contentId,
    },
  };
};

module.exports = {
  buildTicketQrDataUrl,
  buildTicketQrEmailAttachment,
};
