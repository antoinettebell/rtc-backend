const PATHS = { BID: 'BID', APPLICATION: 'APPLICATION' };

const resolveEventVendorParticipationPath = ({ paymentResponsibility, requestedPath = null, existingApplication = null }) => {
  const responsibility = String(paymentResponsibility || 'NONE').toUpperCase();
  const selected = String(requestedPath || existingApplication?.participation_path || '').toUpperCase();
  if (responsibility === 'COORDINATOR') return PATHS.BID;
  if (responsibility === 'VENDOR' || responsibility === 'NONE') return PATHS.APPLICATION;
  if (responsibility === 'BOTH') {
    if ([PATHS.BID, PATHS.APPLICATION].includes(selected)) return selected;
    if (existingApplication) {
      // Historical Event Vendor submissions were applications. Fees are not a
      // durable discriminator because a valid vendor-paid application may be free.
      return PATHS.APPLICATION;
    }
    throw Object.assign(new Error('Choose My Bid or My Application for this event.'), { code: 400 });
  }
  throw Object.assign(new Error('This event does not have a supported payment responsibility.'), { code: 400 });
};

module.exports = { EVENT_VENDOR_PARTICIPATION_PATHS: PATHS, resolveEventVendorParticipationPath };
