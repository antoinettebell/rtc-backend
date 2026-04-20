const { CouponService: Service, CouponUsageService } = require('../services');
const entityName = 'Coupon';

/**
 * To list out or find data by id of given collection
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.list = async (req, res, next) => {
  try {
    let {
      query: { limit = 10, page = 1, search },
      params: { id: _id },
    } = req;
    if (_id) {
      let item = await Service.getById(_id);
      return res.data(
        { [`${entityName.toLocaleLowerCase()}`]: item },
        `${entityName} item`
      );
    }

    let q = {};
    if (search && search.trim()) {
      q = {
        $or: [{ code: { $regex: search.trim().toLowerCase(), $options: 'i' } }],
      };
    }
    const data = await Service.getByData(
      { ...q, deletedAt: null },
      { paging: { limit, page }, lean: true }
    );

    const total = await Service.getCount({
      ...q,
      deletedAt: null,
    });
    return res.data(
      {
        [`${entityName.toLocaleLowerCase()}List`]: data,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To list out or find data by id of given collection
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.validate = async (req, res, next) => {
  try {
    let {
      query: { code },
      user,
    } = req;
    const coupon = await Service.getByData(
      {
        code: { $regex: `\\b${code}\\b`, $options: 'i' },
        isActive: true,
        deletedAt: null,
      },
      { singleResult: true }
    );

    if (!coupon) {
      return res.error(new Error('Invalid or expired coupon'), 409);
    }

    if (user) {
      const usageCount = await CouponUsageService.getCount({
        couponId: coupon._id,
        deletedAt: null,
        userId: user._id,
      });

      if (
        (coupon.usageLimit === 'ONCE' && usageCount >= 1) ||
        (coupon.usageLimit === 'TWICE' && usageCount >= 2) ||
        (coupon.usageLimit === 'MONTHLY' && usageCount >= 1)
      ) {
        return res.data(
          {
            valid: false,
          },
          `validation`
        );
      }
    }

    return res.data(
      {
        valid: true,
        coupon,
      },
      `validation`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.add = async (req, res, next) => {
  try {
    const {
      body: {
        code,
        type,
        usageLimit,
        validFrom,
        validTill,
        value,
        maxDiscount,
      },
      user,
    } = req;

    const existRecord = await Service.getByData(
      { code: { $regex: `\\b${code}\\b`, $options: 'i' }, deletedAt: null },
      { singleResult: true }
    );

    if (existRecord) {
      return res.error(
        new Error('Coupon with this code is already exists.'),
        409
      );
    }

    const data = await Service.create({
      code,
      type,
      usageLimit,
      validFrom,
      validTill,
      value,
      maxDiscount,
      adminCreated: user.userType === 'SUPER_ADMIN',
      createdBy: user._id,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} added`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.update = async (req, res, next) => {
  try {
    const {
      body: {
        code,
        type,
        usageLimit,
        validFrom,
        validTill,
        value,
        maxDiscount,
        isActive,
      },
      params: { id },
    } = req;

    const existRecord = await Service.getByData(
      {
        code: { $regex: `\\b${code}\\b`, $options: 'i' },
        _id: { $ne: id },
        deletedAt: null,
      },
      { singleResult: true }
    );

    if (existRecord) {
      return res.error(
        new Error('Coupon with this code is already exists.'),
        409
      );
    }

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No Coupon found'), 409);
    }

    if (code) {
      item.code = code;
    }

    if (type) {
      item.type = type;
    }

    if (usageLimit !== undefined) {
      item.usageLimit = usageLimit;
    }

    if (validFrom !== undefined) {
      item.validFrom = validFrom;
    }

    if (validTill !== undefined) {
      item.validTill = validTill;
    }

    if (value !== undefined) {
      item.value = value;
    }

    if (maxDiscount !== undefined) {
      item.maxDiscount = maxDiscount;
    }

    if ([true, false].includes(isActive)) {
      item.isActive = isActive;
    }

    await item.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.destroy = async (req, res, next) => {
  try {
    const {
      params: { id },
    } = req;

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No Coupon found'), 409);
    }

    item.deletedAt = new Date().toISOString();

    await item.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} deleted`
    );
  } catch (e) {
    return next(e);
  }
};
