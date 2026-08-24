const getFoodVendorProfileSupportCode = (profileId) =>
  String(profileId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase();

const getFoodVendorDisplayId = (profileId) => {
  const supportCode = getFoodVendorProfileSupportCode(profileId);
  return `Vendor RTC - ${supportCode || 'MASKED'}`;
};

const getFoodVendorDisplayIdsByProfileId = (profiles = []) =>
  profiles.reduce((result, profile) => {
    const profileId = profile?._id;
    if (profileId) result.set(String(profileId), getFoodVendorDisplayId(profileId));
    return result;
  }, new Map());

module.exports = {
  getFoodVendorProfileSupportCode,
  getFoodVendorDisplayId,
  getFoodVendorDisplayIdsByProfileId,
};
