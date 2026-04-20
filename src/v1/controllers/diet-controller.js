const { DietService: Service,UserRestictDietService } = require('../services');
const entityName = 'Diet';

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
        $or: [{ name: { $regex: search.trim().toLowerCase(), $options: 'i' } }],
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
      body: { name },
    } = req;

    const existRecord = await Service.getByData(
      { name: { $regex: `\\b${name}\\b`, $options: 'i' }, deletedAt: null },
      { singleResult: true }
    );

    if (existRecord) {
      return res.error(
        new Error('Diet with this name is already exists.'),
        409
      );
    }

    const data = await Service.create({ name });

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
      body: { name },
      params: { id },
    } = req;

    const existRecord = await Service.getByData(
      {
        name: { $regex: `\\b${name}\\b`, $options: 'i' },
        _id: { $ne: id },
        deletedAt: null,
      },
      { singleResult: true }
    );
    if (existRecord) {
      return res.error(
        new Error('Diet with this name is already exists.'),
        409
      );
    }

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No Diet found'), 409);
    }

    if (name) {
      item.name = name;
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
      return res.error(new Error('No Diet found'), 409);
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

exports.addOrUpdateUserRestrictDiet = async (req, res, next) => {
  try {
    const {
      body: { diet = [] },
      user,
    } = req;

    let record = await UserRestictDietService.getByData(
      { userId: user._id, deletedAt: null },
      { singleResult: true, lean: false }
    );

    let data;

    if (record) {

      record.diet = diet;

      data = await record.save();

    } else {
      data = await UserRestictDietService.create({
        userId: user._id,
        diet,
      });
    }

    return res.data(
      { "user-restrict-diet": data },
      `User Restrict Diet ${record ? "updated" : "added"} successfully`
    );
  } catch (e) {
    return next(e);
  }
};

exports.userRestrictDietList = async (req, res, next) => {
  try {
    const { user } = req;
    // Fetch restricted diet record for this user
    const record = await UserRestictDietService.getByData(
      { userId: user._id, deletedAt: null },
      {
        singleResult: true,
        lean: false,
        populate: ['diet'],
      }
    );

    return res.data(
      {
        userRestrictDietList: record ? record.diet || [] : [],
      },
      "User restrict diet list"
    );
  } catch (e) {
    return next(e);
  }
};

exports.listss = async (req, res, next) => {
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
        $or: [{ name: { $regex: search.trim().toLowerCase(), $options: 'i' } }],
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
