const { AmbassadorCodeService: Service } = require('../services');

const normalizeCode = (value) => String(value || '').trim().toUpperCase();
const publicCode = (item) => ({
  code: item.code,
  firstName: item.firstName,
  lastName: item.lastName,
});

exports.validate = async (req, res, next) => {
  try {
    const code = normalizeCode(req.query.code || req.body?.code);
    if (!code) return res.error(new Error('Referral code is required.'), 422);
    const ambassadorCode = await Service.getByData(
      { code, isActive: true, deletedAt: null },
      { singleResult: true, lean: true }
    );
    if (!ambassadorCode) return res.error(new Error('Referral code is invalid or inactive.'), 409);
    return res.data({ valid: true, ambassador: publicCode(ambassadorCode) }, 'Referral code validation');
  } catch (error) {
    return next(error);
  }
};

exports.list = async (req, res, next) => {
  try {
    const { limit = 10, page = 1, search } = req.query;
    // Archived codes stay in the admin history so they can be re-enabled.
    // `deletedAt` was used by the first release of this feature; deliberately
    // do not filter it here so those already-archived records are recoverable.
    const query = {};
    if (String(search || '').trim()) {
      const pattern = String(search).trim();
      query.$or = [
        { code: { $regex: pattern, $options: 'i' } },
        { firstName: { $regex: pattern, $options: 'i' } },
        { lastName: { $regex: pattern, $options: 'i' } },
        { email: { $regex: pattern, $options: 'i' } },
      ];
    }
    const records = await Service.getByData(query, { paging: { limit, page }, lean: true, sort: { createdAt: -1 } });
    const total = await Service.getCount(query);
    return res.data({ ambassadorCodeList: records, total, page, totalPages: total < limit ? 1 : Math.ceil(total / limit) }, 'Ambassador codes');
  } catch (error) {
    return next(error);
  }
};

exports.add = async (req, res, next) => {
  try {
    const code = normalizeCode(req.body.code);
    const { firstName, lastName, email, phoneNumber } = req.body;
    if (!code || !firstName?.trim() || !lastName?.trim() || !email?.trim() || !phoneNumber?.trim()) {
      return res.error(new Error('Code, first name, last name, email, and phone number are required.'), 422);
    }
    const exists = await Service.getByData({ code }, { singleResult: true });
    if (exists) return res.error(new Error('An ambassador code with this value already exists.'), 409);
    const ambassadorCode = await Service.create({ code, firstName, lastName, email, phoneNumber, isActive: true });
    return res.data({ ambassadorCode }, 'Ambassador code added');
  } catch (error) {
    return next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const item = await Service.getById(req.params.id);
    if (!item) return res.error(new Error('Ambassador code not found.'), 404);
    const update = {};
    for (const key of ['firstName', 'lastName', 'email', 'phoneNumber', 'isActive']) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (req.body.code !== undefined) {
      const code = normalizeCode(req.body.code);
      const duplicate = await Service.getByData({ code, _id: { $ne: item._id } }, { singleResult: true });
      if (duplicate) return res.error(new Error('An ambassador code with this value already exists.'), 409);
      update.code = code;
    }
    Object.assign(item, update);
    if (update.isActive === true) item.deletedAt = null;
    await item.save();
    return res.data({ ambassadorCode: item }, 'Ambassador code updated');
  } catch (error) {
    return next(error);
  }
};

exports.archive = async (req, res, next) => {
  try {
    const item = await Service.getById(req.params.id);
    if (!item) return res.error(new Error('Ambassador code not found.'), 404);
    item.isActive = false;
    await item.save();
    return res.data({ ambassadorCode: item }, 'Ambassador code archived');
  } catch (error) {
    return next(error);
  }
};
