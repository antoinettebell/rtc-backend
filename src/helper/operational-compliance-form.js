const CHECKLISTS = {
  OPENING_CHECKLIST: [
    ['Power & Utilities', 'Turn on the generator, check fuel levels, and hook up LP gas lines.'],
    ['Water Systems', 'Fill the fresh water tank, turn on the water heater, and verify the wastewater tank is empty.'],
    ['Safety & Permits', 'Display all health permits, business licenses, and fire safety certificates.'],
    ['Station Setup', 'Stock the handwashing sink with soap and paper towels; set up sanitizer buckets.'],
    ['Temperature Checks', 'Turn on refrigeration units and use a calibrated thermometer to verify food and cold-storage temperatures are safe.'],
  ],
  CLOSING_CHECKLIST: [
    ['Food Storage', 'Safely pack, label, and move perishable ingredients from cold rails into main refrigerators or coolers.'],
    ['Equipment Shutdown', 'Turn off the griddle, fryers, grills, gas valves, and generator.'],
    ['Cleaning & Sanitization', 'Wash all prep surfaces, equipment, and floors; empty and sanitize sink basins.'],
    ['Waste & Water', 'Empty all trash cans into an approved outdoor dumpster and drain/flush the greywater tank.'],
    ['Security', 'Lock service windows, secure exterior doors, and turn off interior lights.'],
  ],
};

const clampQuantity = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const clampInputQuantity = (value) =>
  Math.max(1, Math.min(100, Number(value) || 1));

const normalizeInventoryItems = (items = []) =>
  items.map((item) => {
    const current = clampInputQuantity(item.current_quantity);
    const maximum = clampInputQuantity(item.max_quantity);
    return {
      ...item,
      beginning_quantity: clampInputQuantity(item.beginning_quantity),
      current_quantity: current,
      max_quantity: maximum,
      reorder_quantity: Math.max(0, maximum - current),
    };
  });

const buildChecklistItems = (type) =>
  (CHECKLISTS[type] || []).map(([area, task]) => ({
    area,
    task,
    completed: false,
    notes: '',
  }));

const buildNextInventoryItems = (items = []) =>
  normalizeInventoryItems(items).map((item) => {
    const beginning = clampQuantity(
      item.current_quantity + item.reorder_quantity
    );
    return {
      item_location: item.item_location,
      brand: item.brand,
      item_name: item.item_name,
      purchased_from: item.purchased_from,
      date_purchased: null,
      use_by_date: item.use_by_date || null,
      beginning_quantity: beginning,
      current_quantity: beginning,
      max_quantity: item.max_quantity,
      reorder_quantity: Math.max(0, item.max_quantity - beginning),
      notes: '',
    };
  });

module.exports = {
  CHECKLISTS,
  buildChecklistItems,
  buildNextInventoryItems,
  normalizeInventoryItems,
};
