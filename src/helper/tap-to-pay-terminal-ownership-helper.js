const isSameVendor = (left, right) =>
  Boolean(left && right && String(left) === String(right));

const selectTerminalOwner = (records = []) => {
  const eligible = records
    .filter((record) => record?.status !== 'HISTORICAL')
    .sort((left, right) => {
      const leftTime = new Date(left?.registered_at || left?.createdAt || 0).getTime();
      const rightTime = new Date(right?.registered_at || right?.createdAt || 0).getTime();
      return leftTime - rightTime;
    });

  return eligible.find((record) => record.status === 'ACTIVE') || eligible[0] || null;
};

const getTerminalOwnershipConflict = ({ records, vendorUserId }) => {
  const owner = selectTerminalOwner(records);
  return owner && !isSameVendor(owner.vendor_user_id, vendorUserId) ? owner : null;
};

module.exports = {
  getTerminalOwnershipConflict,
  isSameVendor,
  selectTerminalOwner,
};
