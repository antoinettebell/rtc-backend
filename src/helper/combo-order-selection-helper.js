const normalizeComboItemId = (value) => {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'object') {
    if (value._id && value._id !== value) {
      return normalizeComboItemId(value._id);
    }
    if (value.$oid) return String(value.$oid);
  }

  const normalized = value?.toString?.() || value;
  return normalized ? String(normalized) : null;
};

const getComboCandidateIds = (item) =>
  [
    item?.comboMenuItemId,
    item?.menuItemId,
    item?.menuItem?._id,
    typeof item?.menuItem === 'object' ? null : item?.menuItem,
    item?.itemId?._id,
    typeof item?.itemId === 'object' ? null : item?.itemId,
    item?._id,
  ]
    .map(normalizeComboItemId)
    .filter(Boolean);

const getComboChildId = (item) => getComboCandidateIds(item)[0] || null;

const findComboSubItem = (configuredItems = [], requestedItem) => {
  const requestedIds = new Set(getComboCandidateIds(requestedItem));
  return configuredItems.find((configuredItem) =>
    getComboCandidateIds(configuredItem).some((id) => requestedIds.has(id))
  );
};

/**
 * Classifies submitted combo selections from the server-owned menu config.
 * Older clients did not submit isAddOn, so a unique configured match remains
 * sufficient. Newer clients may submit the flag to disambiguate an item that
 * is configured in both groups, but the server still verifies that grouping.
 */
const resolveRequestedComboSelections = (configuredItems, requestedItems) => {
  const configured = Array.isArray(configuredItems) ? configuredItems : [];
  const requested = Array.isArray(requestedItems) ? requestedItems : [];
  const included = configured.filter((item) => !item?.isAddOn);
  const addOns = configured.filter((item) => item?.isAddOn);

  return requested.map((requestedItem) => {
    const hasExplicitType = typeof requestedItem?.isAddOn === 'boolean';
    const candidates = hasExplicitType
      ? requestedItem.isAddOn
        ? addOns
        : included
      : configured;
    const configuredItem = findComboSubItem(candidates, requestedItem);

    return {
      requestedItem,
      configuredItem: configuredItem || null,
      isAddOn: configuredItem ? !!configuredItem.isAddOn : null,
    };
  });
};

module.exports = {
  findComboSubItem,
  getComboCandidateIds,
  getComboChildId,
  resolveRequestedComboSelections,
};
