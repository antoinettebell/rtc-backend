const findOrCreateEventVendorApplication = async ({ model, query, payload }) => {
  const existing = await model.findOne(query);
  if (existing) return { application: existing, alreadySubmitted: true };
  try {
    const application = await model.create(payload);
    return { application, alreadySubmitted: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const racedApplication = await model.findOne(query);
    if (!racedApplication) throw error;
    return { application: racedApplication, alreadySubmitted: true };
  }
};

module.exports = { findOrCreateEventVendorApplication };
