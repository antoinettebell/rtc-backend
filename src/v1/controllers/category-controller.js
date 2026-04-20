const {
  MenuCategoryService: Service,
  MenuItemService,
} = require('../services');
const mongoose = require('mongoose');
const entityName = 'Category';

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
      query: { limit = 10, page = 1, search, userId },
      params: { id: _id },
      user,
    } = req;
    if (_id) {
      let item = await Service.getByData(
        { _id, userId: user._id },
        { singleResult: true }
      );
      if (item) {
        item = item.toObject();
        item.menuCount = await MenuItemService.getCount({
          categoryId: _id,
          deletedAt: null,
        });
      }

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
    if (user.userType !== 'SUPER_ADMIN') {
      q.userId = new mongoose.Types.ObjectId(user._id.toString());
    }

    if (user.userType === 'SUPER_ADMIN' && userId?.trim()) {
      q.userId = new mongoose.Types.ObjectId(userId);
    }

    const { data, total } = await Service.getCategoryWithItemCount(
      limit,
      page,
      {
        ...q,
        deletedAt: null,
      }
    );
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
      body: { name="-", categoriesId },
      user,
    } = req;

    if (name) {
      const existRecord = await Service.getByData(
        {
          name: { $regex: `\\b${name}\\b`, $options: 'i' },
          userId: user._id,
          deletedAt: null,
        },
        { singleResult: true }
      );

      if (existRecord) {
        return res.error(
          new Error('Category with this name already exists.'),
          409
        );
      }
    }

    if (categoriesId) {
      const existCategory = await Service.getByData(
        {
          categoriesId,
          userId: user._id,
          deletedAt: null,
        },
        { singleResult: true }
      );

      if (existCategory) {
        return res.error(
          new Error('This categoriesId is already assigned to another category.'),
          409
        );
      }
    }

    const data = await Service.create({
      name,
      categoriesId,
      userId: user._id,
    });

    return res.data(
      { [`${entityName.toLowerCase()}`]: data },
      `${entityName} added`
    );
  } catch (e) {
    return next(e);
  }
};

// exports.add = async (req, res, next) => {
//   try {
//     const {
//       body: { name },
//       user,
//     } = req;
//     console.log("dd",req.body)
//     const existRecord = await Service.getByData(
//       {
//         name: { $regex: `\\b${name}\\b`, $options: 'i' },
//         userId: user._id,
//         deletedAt: null,
//       },
//       { singleResult: true }
//     );

//     if (existRecord) {
//       return res.error(
//         new Error('Category with this name is already exists.'),
//         409
//       );
//     }

//     const data = await Service.create({ name, userId: user._id });

//     return res.data(
//       { [`${entityName.toLocaleLowerCase()}`]: data },
//       `${entityName} added`
//     );
//   } catch (e) {
//     return next(e);
//   }
// };

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
// exports.update = async (req, res, next) => {
//   try {
//     const {
//       body: { name ,categoriesId},
//       params: { id },
//       user,
//     } = req;
//     const existRecord = await Service.getByData(
//       {
//         name: { $regex: `\\b${name}\\b`, $options: 'i' },
//         userId: user._id,
//         _id: { $ne: id },
//         deletedAt: null,
//       },
//       { singleResult: true }
//     );

//     if (existRecord) {
//       return res.error(
//         new Error('Category with this name is already exists.'),
//         409
//       );
//     }

//     const item = await Service.getById(id);
//     if (!item) {
//       return res.error(new Error('No category found'), 409);
//     }

//     if (name) {
//       item.name = name;
//     }
//     if(categoriesId){
//       item.categoriesId=categoriesId;
//     }

//     await item.save();

//     return res.data(
//       { [`${entityName.toLocaleLowerCase()}`]: item },
//       `${entityName} updated`
//     );
//   } catch (e) {
//     return next(e);
//   }
// };
exports.update = async (req, res, next) => {
  try {
    const {
      body: { name, categoriesId },
      params: { id },
      user,
    } = req;

    if (name) {
      const existRecord = await Service.getByData(
        {
          name: { $regex: `\\b${name}\\b`, $options: 'i' },
          userId: user._id,
          _id: { $ne: id },
          deletedAt: null,
        },
        { singleResult: true }
      );

      if (existRecord) {
        return res.error(
          new Error('Category with this name already exists.'),
          409
        );
      }
    }

    if (categoriesId) {
      const existCategory = await Service.getByData(
        {
          categoriesId,
          userId: user._id,
          _id: { $ne: id },
          deletedAt: null,
        },
        { singleResult: true }
      );

      if (existCategory) {
        return res.error(
          new Error('This categoriesId is already assigned to another category.'),
          409
        );
      }
    }

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No category found'), 404);
    }

    if (name) {
      item.name = name;
    }
    if (categoriesId) {
      item.categoriesId = categoriesId;
    }

    await item.save();

    return res.data(
      { [`${entityName.toLowerCase()}`]: item },
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
      user,
    } = req;

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No category found'), 409);
    }

    if (item.userId.toString() !== user._id.toString()) {
      return res.error(new Error('No category found'), 409);
    }

    const count = await MenuItemService.getCount({
      categoryId: id,
      deletedAt: null,
    });
    if (count > 0) {
      return res.error(
        new Error('Please remove all the menu linked to this category first'),
        409
      );
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
