const {
  MenuItemService: Service,
  CommonDataListService,
  MenuCsvImportService,
} = require('../services');
const mongoose = require('mongoose');
const entityName = 'Menu';

/**
 * Helper to process BOGO items and handle isSameItem logic
 * @param {Object} item - Menu item object
 * @returns {Object} - Processed menu item
 */
const processBogoItems = (item) => {
  if (item && item.bogoItems && Array.isArray(item.bogoItems)) {
    item.bogoItems = item.bogoItems.map((bogo) => {
      if (bogo.isSameItem) {
        // Use parent item details for same-item reward
        return {
          ...bogo,
          itemId: {
            _id: item._id,
            name: item.name,
            description: item.description,
            imgUrls: item.imgUrls,
            price: item.strikePrice || item.price,
            strikePrice: item.strikePrice,
            discountType: item.discountType,
            hasDiscount: item.hasDiscount,
            discountRules: item.discountRules,
            available: item.available,
            itemType: item.itemType,
            categoryId: item.categoryId,
            meatId: item.meatId,
            diet: item.diet,
            predefinedDiscountId: item.predefinedDiscountId,
            minQty: item.minQty,
            maxQty: item.maxQty,
          },
        };
      }
      return bogo;
    });
  }
  return item;
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
exports.list = async (req, res, next) => {
  try {
    let {
      query: { limit = 10, page = 1, search, categoryId, userId },
      params: { id: _id },
      user,
    } = req;

    if (_id) {
      console.log('list call', _id);

      let item = await Service.getByData(
        { _id, userId: user._id },
        {
          singleResult: true,
          populate: [
            {
              path: 'categoryId',
              populate: {
                path: 'categoriesId',
                model: 'categories',
                select: { _id: 1, name: 1 },
              },
            },
            'meatId',
            'predefinedDiscountId',
            'diet',
            {
              path: 'bogoItems.itemId',
              select: {
                _id: 1,
                name: 1,
                description: 1,
                imgUrls: 1,
                price: 1,
                strikePrice: 1,
                discountType: 1,
                hasDiscount: 1,
                discountRules: 1,
                available: 1,
                itemType: 1,
                categoryId: 1,
                meatId: 1,
                diet: 1,
                predefinedDiscountId: 1,
                minQty: 1,
                maxQty: 1,
              },
            },
            {
              path: 'subItem.menuItem',
              select: {
                _id: 1,
                name: 1,
                description: 1,
                imgUrls: 1,
                price: 1,
                strikePrice: 1,
                discountType: 1,
                hasDiscount: 1,
                discountRules: 1,
                available: 1,
                itemType: 1,
                categoryId: 1,
                meatId: 1,
                diet: 1,
                predefinedDiscountId: 1,
                minQty: 1,
                maxQty: 1,
              },
            },
          ],
        }
      );

      if (item) {
        item = item.toObject();
        console.log(
          'Single item subItem:',
          JSON.stringify(item.subItem, null, 2)
        );
      }
      if (item && item.categoryId && typeof item.categoryId === 'object') {
        item.category = item.categoryId;
        if (item.categoryId?.categoriesId?.name) {
          item.category.name = item.categoryId.categoriesId.name;
        }
        item.categoryId = item.category._id;
      }

      if (
        item &&
        item.predefinedDiscountId &&
        typeof item.predefinedDiscountId === 'object'
      ) {
        item.predefinedDiscount = item.predefinedDiscountId;
        item.predefinedDiscountId = item.predefinedDiscountId._id;
      }

      if (item && item.meatId && typeof item.meatId === 'object') {
        item.meat = item.meatId;
        item.meatId = item.meat._id;
      }

      // Handle isSameItem logic
      item = processBogoItems(item);

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
    if (categoryId) {
      q.categoryId = categoryId;
    }
    if (user && user.userType !== 'SUPER_ADMIN') {
      q.userId = user._id;
    }
    if (user && user.userType === 'SUPER_ADMIN' && userId) {
      q.userId = new mongoose.Types.ObjectId(userId);
    }
    const data = (
      await Service.getByData(
        { ...q, deletedAt: null },
        {
          paging: { limit, page },
          lean: true,
          populate: [
            {
              path: 'categoryId',
              // match: { categoriesId: { $ne: null } },
              populate: {
                path: 'categoriesId',
                model: 'categories',
                select: { _id: 1, name: 1 },
              },
            },
            'meatId',
            'predefinedDiscountId',
            'diet',
            {
              path: 'bogoItems.itemId',
              select: {
                _id: 1,
                name: 1,
                description: 1,
                imgUrls: 1,
                price: 1,
                strikePrice: 1,
                discountType: 1,
                hasDiscount: 1,
                discountRules: 1,
                available: 1,
                itemType: 1,
                categoryId: 1,
                meatId: 1,
                diet: 1,
                predefinedDiscountId: 1,
                minQty: 1,
                maxQty: 1,
              },
            },
            {
              path: 'subItem.menuItem',
              select: {
                _id: 1,
                name: 1,
                description: 1,
                imgUrls: 1,
                price: 1,
                strikePrice: 1,
                discountType: 1,
                hasDiscount: 1,
                discountRules: 1,
                available: 1,
                itemType: 1,
                categoryId: 1,
                meatId: 1,
                diet: 1,
                predefinedDiscountId: 1,
                minQty: 1,
                maxQty: 1,
              },
            },
          ],
        }
      )
    ).map((item) => {
      if (item && item.categoryId && typeof item.categoryId === 'object') {
        item.category = item.categoryId;
        if (item.categoryId?.categoriesId?.name) {
          item.category.name = item.categoryId.categoriesId.name;
        }
        item.categoryId = item.category._id;
      }
      if (
        item &&
        item.predefinedDiscountId &&
        typeof item.predefinedDiscountId === 'object'
      ) {
        item.predefinedDiscount = item.predefinedDiscountId;
        item.predefinedDiscountId = item.predefinedDiscountId._id;
      }

      if (item && item.meatId && typeof item.meatId === 'object') {
        item.meat = item.meatId;
        item.meatId = item.meat._id;
      }

      // Handle isSameItem logic
      item = processBogoItems(item);

      return item;
    });
    // console.log("call",data)

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

exports.checkItems = async (req, res, next) => {
  try {
    let {
      body: { ids },
    } = req;

    const data = (
      await Service.getByData(
        { _id: { $in: ids } },
        {
          lean: true,
          populate: [
            {
              path: 'categoryId',
              populate: {
                path: 'categoriesId',
                model: 'categories',
                select: { _id: 1, name: 1 },
              },
            },
            'meatId',
            'diet',
            'predefinedDiscountId',
            {
              path: 'bogoItems.itemId',
              select: {
                _id: 1,
                name: 1,
                description: 1,
                imgUrls: 1,
                price: 1,
                strikePrice: 1,
                discountType: 1,
                hasDiscount: 1,
                discountRules: 1,
                available: 1,
                itemType: 1,
                categoryId: 1,
                meatId: 1,
                diet: 1,
                predefinedDiscountId: 1,
                minQty: 1,
                maxQty: 1,
              },
            },
            {
              path: 'subItem.menuItem',
              select: {
                _id: 1,
                name: 1,
                description: 1,
                imgUrls: 1,
                price: 1,
                strikePrice: 1,
                discountType: 1,
                hasDiscount: 1,
                discountRules: 1,
                available: 1,
                itemType: 1,
                categoryId: 1,
                meatId: 1,
                diet: 1,
                predefinedDiscountId: 1,
                minQty: 1,
                maxQty: 1,
              },
            },
          ],
        }
      )
    ).map((item) => {
      if (item && item.categoryId && typeof item.categoryId === 'object') {
        item.category = item.categoryId;
        if (item.categoryId?.categoriesId?.name) {
          item.category.name = item.categoryId.categoriesId.name;
        }
        item.categoryId = item.category._id;
      }
      if (
        item &&
        item.predefinedDiscountId &&
        typeof item.predefinedDiscountId === 'object'
      ) {
        item.predefinedDiscount = item.predefinedDiscountId;
        item.predefinedDiscountId = item.predefinedDiscountId._id;
      }
      if (item && item.meatId && typeof item.meatId === 'object') {
        item.meat = item.meatId;
        item.meatId = item.meat._id;
      }

      if (item.discountType === 'BOGOHO' && item.price) {
        item.bogoHoPrice = Number((item.price * 1.5).toFixed(2));
      }

      // Handle isSameItem logic
      item = processBogoItems(item);

      return item;
    });
    return res.data(
      {
        [`${entityName.toLocaleLowerCase()}List`]: data,
      },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};

exports.importCsv = async (req, res, next) => {
  try {
    const { body, files, user } = req;
    const file = req.file || files?.file?.[0];
    const imageFiles = files?.images || [];

    if (!file?.buffer) {
      return res.error(new Error('Please upload a CSV file.'), 400);
    }

    const vendorUserId =
      user.userType === 'SUPER_ADMIN'
        ? String(body.vendorUserId || '').trim()
        : user._id.toString();

    if (!vendorUserId) {
      return res.error(
        new Error('vendorUserId is required for admin menu imports.'),
        400
      );
    }

    const importSummary = await MenuCsvImportService.importFromCsv({
      csvText: file.buffer.toString('utf8'),
      vendorUserId,
      imageFiles,
    });

    return res.data({ importSummary }, 'Menu CSV import completed');
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
        name,
        description,
        imgUrls,
        price,
        minQty,
        maxQty,
        itemType,
        categoryId,
        subItem,
        discount,
        allowCustomize,
        newDish,
        popularDish,
        preparationTime,
        diet,
        meatId,
        meatWellness,
        strikePrice,
        hasDiscount,
        discountMode,
        discountType,
        discountValue,
        predefinedDiscountId,
        bogoItems,
        discountRules,
      },
      user,
    } = req;
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
        new Error('menu with this name is already exists.'),
        409
      );
    }
    let finalDiscountType = discountType || 'FIXED';
    let finalDiscountValue = discount || 0;
    let finalDiscountMode = discountMode || 'CUSTOM';
    let finalPredefinedId = predefinedDiscountId || null;
    if (hasDiscount && discountMode === 'PREDEFINED' && predefinedDiscountId) {
      const discountData = await CommonDataListService.getById(
        predefinedDiscountId
      );
      if (discountData) {
        finalPredefinedId = discountData._id;

        switch (discountData.key) {
          case 'BOGO':
            finalDiscountType = 'BOGO';
            finalDiscountValue = 0;
            break;
          case 'BOGOHO':
            finalDiscountType = 'BOGOHO';
            finalDiscountValue = 0;
            break;
          case 'PERCENTAGE':
            finalDiscountType = 'PERCENTAGE';
            finalDiscountValue = Number(discountData.value);
            break;
          default:
            finalDiscountType = 'FIXED';
            finalDiscountValue = Number(discountData.value);
            break;
        }
      }
    }
    if (
      (finalDiscountType || 'FIXED') === 'FIXED' &&
      finalDiscountValue > (strikePrice || price)
    ) {
      return res.error(new Error('Discount must be less than the price.'), 409);
    }

    if (
      (finalDiscountType || 'FIXED') !== 'FIXED' &&
      finalDiscountValue > 100
    ) {
      return res.error(new Error('Discount must be less than 100%'), 409);
    }

    let data = await Service.create({
      name,
      description,
      imgUrls,
      price,
      minQty,
      maxQty,
      itemType,
      categoryId,
      preparationTime,
      subItem,
      discount: finalDiscountValue,
      strikePrice: strikePrice || null,
      meatId: meatId || null,
      meatWellness: meatWellness || null,
      allowCustomize: allowCustomize || false,
      newDish: newDish || false,
      popularDish: popularDish || false,
      // discountType: discountType || 'FIXED',
      diet: diet || [],
      userId: user._id,
      hasDiscount: hasDiscount || false,
      discountMode: finalDiscountMode,
      discountType: finalDiscountType,
      discountValue: finalDiscountValue,
      predefinedDiscountId: finalPredefinedId,
      bogoItems: bogoItems || [],
      discountRules: discountRules || undefined,
    });

    if (data) {
      data = data.toObject();
      data = processBogoItems(data);
    }

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
        name,
        description,
        imgUrls,
        price,
        strikePrice,
        available,
        minQty,
        maxQty,
        categoryId,
        subItem,
        allowCustomize,
        newDish,
        popularDish,
        preparationTime,
        diet,
        meatId,
        meatWellness,
        hasDiscount,
        discountMode,
        discountType,
        discount,
        itemType,
        predefinedDiscountId,
        bogoItems,
        discountRules,
      },
      params: { id },
      user,
    } = req;
    console.log('Ddd', req.body);

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
        new Error('Menu with this name is already exists.'),
        409
      );
    }

    const item = await Service.getById(id);
    if (!item || item.deletedAt) {
      return res.error(new Error('Menu not found.'), 404);
    }

    // ---------- Discount Logic ----------
    let finalDiscountType = hasDiscount ? discountType : 'FIXED';
    let finalDiscountValue = hasDiscount ? discount ?? item.discount : 0;
    let finalDiscountMode = hasDiscount
      ? discountMode || item.discountMode
      : 'CUSTOM';
    let finalPredefinedId = hasDiscount
      ? predefinedDiscountId || item.predefinedDiscountId
      : null;

    if (hasDiscount && discountMode === 'PREDEFINED' && predefinedDiscountId) {
      const discountData = await CommonDataListService.getById(
        predefinedDiscountId
      );
      if (discountData) {
        finalPredefinedId = discountData._id;

        switch (discountData.key) {
          case 'BOGO':
            finalDiscountType = 'BOGO';
            finalDiscountValue = 0;
            break;
          case 'BOGOHO':
            finalDiscountType = 'BOGOHO';
            finalDiscountValue = 0;
            break;
          case 'PERCENTAGE':
            finalDiscountType = 'PERCENTAGE';
            finalDiscountValue = Number(discountData.value);
            break;
          default:
            finalDiscountType = 'FIXED';
            finalDiscountValue = Number(discountData.value);
            break;
        }
      }
    }

    // ---------- Validation ----------
    if (
      hasDiscount &&
      finalDiscountType === 'FIXED' &&
      finalDiscountValue > (strikePrice || price || item.price)
    ) {
      return res.error(new Error('Discount must be less than the price.'), 409);
    }

    if (
      hasDiscount &&
      finalDiscountType !== 'FIXED' &&
      finalDiscountValue > 100
    ) {
      return res.error(new Error('Discount must be less than 100%'), 409);
    }
    //    let subItem=[ { menuItem: '6948d65cfb10fe3f1535f7a2', qty: 1 } ];

    // ---------- Update Fields ----------
    Object.assign(item, {
      name,
      description,
      imgUrls,
      price,
      strikePrice: strikePrice || null,
      minQty,
      maxQty,
      categoryId: categoryId || item.categoryId,
      subItem: itemType === 'COMBO' ? subItem || item.subItem : [],
      allowCustomize,
      newDish,
      popularDish,
      preparationTime,
      diet,
      itemType,
      meatId,
      meatWellness,
      available: available ? available : item.available,
      hasDiscount,
      discountMode: finalDiscountMode,
      discountType: finalDiscountType,
      discountValue: finalDiscountValue,
      discount: finalDiscountValue,
      predefinedDiscountId: finalPredefinedId,
      bogoItems: bogoItems || [],
      discountRules: discountRules || item.discountRules,
    });

    await item.save();

    let updatedItem = item.toObject();
    updatedItem = processBogoItems(updatedItem);

    return res.data(
      { [`${entityName.toLowerCase()}`]: updatedItem },
      `${entityName} updated successfully`
    );
  } catch (e) {
    console.error('Update Menu Error:', e);
    return next(e);
  }
};
// exports.update = async (req, res, next) => {
//   try {
//     const {
//       body: {
//         name,
//         description,
//         imgUrls,
//         price,
//         available,
//         minQty,
//         maxQty,
//         categoryId,
//         subItem,
//         discount,
//         preparationTime,
//         allowCustomize,
//         newDish,
//         popularDish,
//         diet,
//         meatId,
//         meatWellness,
//         discountType,
//         strikePrice,
//       },
//       params: { id },
//       user,
//     } = req;
//    console.log("d",req.body)
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
//         new Error('Menu with this name is already exists.'),
//         409
//       );
//     }

//     const item = await Service.getById(id);
//     if (!item) {
//       return res.error(new Error('No Menu found'), 409);
//     }

//     if (name) {
//       item.name = name;
//     }

//     if (description) {
//       item.description = description;
//     }

//     if (imgUrls) {
//       item.imgUrls = imgUrls;
//     }

//     if (preparationTime) {
//       item.preparationTime = preparationTime;
//     }

//     if (strikePrice) {
//       item.strikePrice = strikePrice;
//     }

//     if (price) {
//       item.price = price;
//     }

//     if (discountType) {
//       item.discountType = discountType;
//     }

//     if (discount || discount === 0) {
//       item.discount = discount;
//     }

//     if (
//       (item.discountType || 'FIXED') === 'FIXED' &&
//       item.discount > (item.strikePrice || item.price)
//     ) {
//       return res.error(new Error('Discount must be less than the price.'), 409);
//     }

//     if ((item.discountType || 'FIXED') !== 'FIXED' && item.discount > 100) {
//       return res.error(new Error('Discount must be less than 100%'), 409);
//     }

//     if ([true, false].includes(available)) {
//       item.available = available;
//     }

//     if ([true, false].includes(allowCustomize)) {
//       item.allowCustomize = allowCustomize;
//     }

//     if ([true, false].includes(newDish)) {
//       item.newDish = newDish;
//     }

//     if ([true, false].includes(popularDish)) {
//       item.popularDish = popularDish;
//     }

//     if (diet) {
//       item.diet = diet;
//     }

//     if (minQty) {
//       item.minQty = minQty;
//     }

//     if (maxQty) {
//       item.maxQty = maxQty;
//     }

//     if (meatId) {
//       item.meatId = meatId;
//     }

//     if (meatWellness) {
//       item.meatWellness = meatWellness;
//     }

//     if (categoryId) {
//       item.categoryId = categoryId;
//     }

//     if (subItem && item.itemType === 'COMBO') {
//       item.subItem = subItem;
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
      return res.error(new Error('No Menu found'), 409);
    }

    if (item.userId.toString() !== user._id.toString()) {
      return res.error(new Error('No Menu found'), 409);
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

exports.updateaAvailability = async (req, res, next) => {
  try {
    const {
      body: { available },
      params: { id },
      user,
    } = req;
    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No Menu found'), 409);
    }

    if ([true, false].includes(available)) {
      item.available = available;
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
