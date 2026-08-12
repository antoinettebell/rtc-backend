const PATHS = { BID: 'BID', APPLICATION: 'APPLICATION' };

// Merchandise, Service, and Other accounts always participate through an
// application. Event payment responsibility controls settlement, not whether
// these vendors become Food Vendor catering bidders.
const resolveEventVendorParticipationPath = () => PATHS.APPLICATION;

module.exports = { EVENT_VENDOR_PARTICIPATION_PATHS: PATHS, resolveEventVendorParticipationPath };
