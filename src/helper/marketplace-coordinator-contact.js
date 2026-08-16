const buildMarketplaceCoordinatorContact = (coordinator) => {
  if (!coordinator) return null;
  const name = [coordinator.firstName, coordinator.lastName].filter(Boolean).join(' ').trim();
  const phone = [coordinator.countryCode, coordinator.mobileNumber].filter(Boolean).join(' ').trim();
  return {
    name: name || null,
    phone: phone || null,
    email: coordinator.email || null,
  };
};

const getUnlockedMarketplaceCoordinatorContact = ({ coordinator, detailsUnlocked }) =>
  detailsUnlocked ? buildMarketplaceCoordinatorContact(coordinator) : null;

module.exports = {
  buildMarketplaceCoordinatorContact,
  getUnlockedMarketplaceCoordinatorContact,
};
