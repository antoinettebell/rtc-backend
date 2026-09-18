const {
  processPendingTapToPayAttempts,
} = require('./tap-to-pay-interruption-helper');

const MONITOR_INTERVAL = 15 * 1000;

const runTapToPayInterruptionMonitor = async () => {
  try {
    await processPendingTapToPayAttempts();
  } catch (error) {
    console.error('Tap to Pay interruption monitor failed', {
      message: error.message,
    });
  }
};

const startTapToPayInterruptionMonitor = () => {
  const initial = setTimeout(runTapToPayInterruptionMonitor, 15 * 1000);
  const timer = setInterval(runTapToPayInterruptionMonitor, MONITOR_INTERVAL);
  initial.unref?.();
  timer.unref?.();
  return timer;
};

module.exports = {
  runTapToPayInterruptionMonitor,
  startTapToPayInterruptionMonitor,
};
