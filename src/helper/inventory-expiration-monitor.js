const OperationalComplianceFormService = require('../v1/services/operational-compliance-form-service');

const ONE_MINUTE = 60 * 1000;

const runInventoryExpirationMonitor = async () => {
  try {
    await OperationalComplianceFormService.processExpiredInventoryNotifications();
  } catch (error) {
    console.error('Inventory expiration monitor failed', { message: error.message });
  }
};

const startInventoryExpirationMonitor = () => {
  const initial = setTimeout(runInventoryExpirationMonitor, 10 * 1000);
  const timer = setInterval(runInventoryExpirationMonitor, ONE_MINUTE);
  initial.unref?.();
  timer.unref?.();
  return timer;
};

module.exports = {
  runInventoryExpirationMonitor,
  startInventoryExpirationMonitor,
};
