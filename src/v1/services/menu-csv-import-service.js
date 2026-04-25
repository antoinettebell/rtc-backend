const { Types } = require('mongoose');
const path = require('path');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const {
  MenuCategoryModel,
  MenuItemModel,
  UserModel,
  categoriesModel,
} = require('../../models');
const { addObjectFromBuffer } = require('../../helper/aws');

const URL_PATTERN = /^https?:\/\//i;

class MenuCsvImportService {
  parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        continue;
      }

      if (char === ',') {
        row.push(cell);
        cell = '';
        continue;
      }

      if (char === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }

      if (char !== '\r') {
        cell += char;
      }
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    return rows.filter((currentRow) =>
      currentRow.some((value) => String(value || '').trim() !== '')
    );
  }

  toRecords(csvText) {
    const sanitizedText = String(csvText || '').replace(/^\uFEFF/, '');
    const rows = this.parseCsv(sanitizedText);

    if (rows.length < 2) {
      throw new Error(
        'CSV file must include a header row and at least one data row.'
      );
    }

    const headers = rows[0].map((header) => String(header || '').trim());

    return rows.slice(1).map((row, index) => {
      const record = {};

      headers.forEach((header, headerIndex) => {
        record[header] = String(row[headerIndex] || '').trim();
      });

      record._rowNumber = index + 2;
      return record;
    });
  }

  parseRequiredObjectId(value, fieldName, rowNumber) {
    if (!value) {
      throw new Error(
        `Row ${rowNumber}: missing required ObjectId for ${fieldName}.`
      );
    }

    if (!Types.ObjectId.isValid(value)) {
      throw new Error(`Row ${rowNumber}: invalid ObjectId for ${fieldName}.`);
    }

    return new Types.ObjectId(value);
  }

  parseOptionalObjectId(value, fieldName, rowNumber) {
    if (!value) {
      return null;
    }

    if (!Types.ObjectId.isValid(value)) {
      throw new Error(`Row ${rowNumber}: invalid ObjectId for ${fieldName}.`);
    }

    return new Types.ObjectId(value);
  }

  parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }

    return String(value).trim().toLowerCase() === 'true';
  }

  parseRequiredString(value, fieldName, rowNumber) {
    const normalizedValue = String(value || '').trim();

    if (!normalizedValue) {
      throw new Error(
        `Row ${rowNumber}: missing required value for ${fieldName}.`
      );
    }

    return normalizedValue;
  }

  parseNumber(value, defaultValue = 0, fieldName, rowNumber) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }

    const parsedValue = Number(value);
    if (Number.isNaN(parsedValue)) {
      throw new Error(`Row ${rowNumber}: invalid number for ${fieldName}.`);
    }

    return parsedValue;
  }

  parseStringArray(value) {
    if (!value) {
      return [];
    }

    return String(value)
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  getImageLookupKey(value) {
    return String(value || '')
      .trim()
      .split(/[\\/]/)
      .pop()
      .toLowerCase();
  }

  buildImageFileMap(imageFiles = []) {
    return imageFiles.reduce((map, file) => {
      const key = this.getImageLookupKey(file.originalname);

      if (!key) {
        return map;
      }

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key).push(file);
      return map;
    }, new Map());
  }

  async normalizeImageFileForUpload(file) {
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (extension !== '.heic') {
      return file;
    }

    const pngBuffer = await heicConvert({
      buffer: file.buffer,
      format: 'PNG',
      quality: 1,
    });
    const jpgBuffer = await sharp(pngBuffer).jpeg({ quality: 75 }).toBuffer();

    return {
      ...file,
      buffer: jpgBuffer,
      originalname: String(file.originalname || '').replace(/\.heic$/i, '.jpg'),
      mimetype: 'image/jpeg',
    };
  }

  async uploadImageFile(file) {
    return addObjectFromBuffer(await this.normalizeImageFileForUpload(file));
  }

  async resolveImageUrls(row, imageFileMap, uploadedImageUrls) {
    const imageReferences = this.parseStringArray(row.imgUrls);
    const resolvedUrls = [];

    for (const imageReference of imageReferences) {
      if (URL_PATTERN.test(imageReference)) {
        resolvedUrls.push(imageReference);
        continue;
      }

      const imageKey = this.getImageLookupKey(imageReference);
      const matches = imageFileMap.get(imageKey) || [];

      if (matches.length === 0) {
        throw new Error(
          `Row ${row._rowNumber}: image file "${imageReference}" was not uploaded.`
        );
      }

      if (matches.length > 1) {
        throw new Error(
          `Row ${row._rowNumber}: image file "${imageReference}" matches more than one uploaded file. Rename duplicate files before importing.`
        );
      }

      if (!uploadedImageUrls.has(imageKey)) {
        uploadedImageUrls.set(imageKey, await this.uploadImageFile(matches[0]));
      }

      resolvedUrls.push(uploadedImageUrls.get(imageKey));
    }

    return resolvedUrls;
  }

  parseObjectIdArray(value, fieldName, rowNumber) {
    return this.parseStringArray(value).map((item) =>
      this.parseRequiredObjectId(item, fieldName, rowNumber)
    );
  }

  parseJsonArray(value, fieldName, rowNumber) {
    if (!value) {
      return [];
    }

    try {
      const parsedValue = JSON.parse(value);
      return Array.isArray(parsedValue) ? parsedValue : [];
    } catch (error) {
      throw new Error(`Row ${rowNumber}: invalid JSON for ${fieldName}.`);
    }
  }

  parseDietObjectIds(row) {
    const indexedDietKeys = Object.keys(row)
      .filter((key) => /^diet\[\d+\]$/i.test(key))
      .sort(
        (left, right) =>
          Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0])
      );

    const indexedDietValues = indexedDietKeys
      .map((key) => row[key])
      .filter((value) => value && value.trim() !== '');

    if (indexedDietValues.length > 0) {
      return indexedDietValues.map((value) =>
        this.parseRequiredObjectId(value.trim(), 'diet[]', row._rowNumber)
      );
    }

    return this.parseObjectIdArray(row.dietIds, 'dietIds', row._rowNumber);
  }

  resolveVendorUserId(row, vendorUserId) {
    const selectedUserId = String(vendorUserId || '').trim();
    const rowUserId = String(row.userId || '').trim();

    if (selectedUserId) {
      return this.parseRequiredObjectId(
        selectedUserId,
        'userId',
        row._rowNumber
      );
    }

    if (!rowUserId) {
      throw new Error(`Row ${row._rowNumber}: missing required vendor userId.`);
    }

    return this.parseRequiredObjectId(rowUserId, 'userId', row._rowNumber);
  }

  getGlobalCategorySourceValue(row) {
    return row.globalCategoryId || row.categoryId;
  }

  async resolveGlobalCategoryId(row) {
    const categorySourceValue = this.getGlobalCategorySourceValue(row);
    const categoryObjectId = this.parseRequiredObjectId(
      categorySourceValue,
      row.globalCategoryId ? 'globalCategoryId' : 'categoryId',
      row._rowNumber
    );

    const category = await categoriesModel.findOne({
      _id: categoryObjectId,
      deletedAt: null,
    });

    if (!category) {
      throw new Error(
        `Row ${
          row._rowNumber
        }: global category ${categoryObjectId.toString()} was not found.`
      );
    }

    return category._id;
  }

  async getOrCreateMenuCategory(userId, row) {
    const categoriesId = await this.resolveGlobalCategoryId(row);

    let menuCategory = await MenuCategoryModel.findOne({
      userId,
      categoriesId,
      deletedAt: null,
    });

    if (menuCategory) {
      return { categoryId: menuCategory._id, created: false };
    }

    const now = new Date();
    menuCategory = await MenuCategoryModel.create({
      name: row.menuCategoryName || '-',
      userId,
      categoriesId,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return { categoryId: menuCategory._id, created: true };
  }

  buildMenuItem(row, categoryId, userId, imgUrls) {
    return {
      name: this.parseRequiredString(row.name, 'name', row._rowNumber),
      description: row.description,
      imgUrls,
      strikePrice:
        row.strikePrice === '' || row.strikePrice === undefined
          ? null
          : this.parseNumber(row.strikePrice, 0, 'strikePrice', row._rowNumber),
      discountType: row.discountType || 'FIXED',
      hasDiscount: this.parseBoolean(row.hasDiscount, false),
      discountMode: row.discountMode || 'CUSTOM',
      predefinedDiscountId: this.parseOptionalObjectId(
        row.predefinedDiscountId,
        'predefinedDiscountId',
        row._rowNumber
      ),
      discountValue: this.parseNumber(
        row.discountValue,
        0,
        'discountValue',
        row._rowNumber
      ),
      bogoItems: this.parseObjectIdArray(
        row.bogoItemIds,
        'bogoItemIds',
        row._rowNumber
      ).map((itemId) => ({
        itemId,
        qty: 1,
        isSameItem: false,
      })),
      discount: this.parseNumber(row.discount, 0, 'discount', row._rowNumber),
      price: this.parseNumber(row.price, 0, 'price', row._rowNumber),
      minQty: this.parseNumber(row.minQty, 1, 'minQty', row._rowNumber),
      maxQty: this.parseNumber(row.maxQty, 99, 'maxQty', row._rowNumber),
      available: this.parseBoolean(row.available, true),
      itemType: row.itemType || 'INDIVIDUAL',
      meatWellness: row.meatWellness || 'NA',
      categoryId,
      meatId: this.parseOptionalObjectId(row.meatId, 'meatId', row._rowNumber),
      preparationTime: this.parseNumber(
        row.preparationTime,
        0,
        'preparationTime',
        row._rowNumber
      ),
      allowCustomize: this.parseBoolean(row.allowCustomize, true),
      newDish: this.parseBoolean(row.newDish, false),
      popularDish: this.parseBoolean(row.popularDish, false),
      diet: this.parseDietObjectIds(row),
      subItem: this.parseJsonArray(
        row.subItemJson,
        'subItemJson',
        row._rowNumber
      ),
      userId,
      deletedAt: null,
    };
  }

  async validateVendor(vendorUserId) {
    const vendor = await UserModel.findOne({
      _id: vendorUserId,
      userType: 'VENDOR',
      deletedAt: null,
    }).lean();

    if (!vendor) {
      throw new Error('Selected vendor was not found.');
    }

    return vendor;
  }

  async importFromCsv({ csvText, vendorUserId, imageFiles = [] }) {
    const records = this.toRecords(csvText);
    const normalizedVendorUserId = String(vendorUserId || '').trim();
    const imageFileMap = this.buildImageFileMap(imageFiles);
    const uploadedImageUrls = new Map();

    if (!normalizedVendorUserId) {
      throw new Error('vendorUserId is required for menu import.');
    }

    const vendorObjectId = this.parseRequiredObjectId(
      normalizedVendorUserId,
      'vendorUserId',
      0
    );

    await this.validateVendor(vendorObjectId);

    const summary = {
      totalRows: records.length,
      importedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      categoryCreatedCount: 0,
      uploadedImageCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const row of records) {
      try {
        const rowUserId = this.resolveVendorUserId(row, normalizedVendorUserId);
        const imgUrls = await this.resolveImageUrls(
          row,
          imageFileMap,
          uploadedImageUrls
        );
        const { categoryId, created } = await this.getOrCreateMenuCategory(
          rowUserId,
          row
        );
        const now = new Date();
        const menuItem = this.buildMenuItem(
          row,
          categoryId,
          rowUserId,
          imgUrls
        );
        const result = await MenuItemModel.updateOne(
          {
            name: menuItem.name,
            userId: rowUserId,
          },
          {
            $set: {
              ...menuItem,
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
              __v: 0,
            },
          },
          { upsert: true }
        );

        summary.importedCount += 1;

        if (created) {
          summary.categoryCreatedCount += 1;
        }

        if (result.upsertedCount > 0) {
          summary.createdCount += 1;
        } else {
          summary.updatedCount += 1;
        }
      } catch (error) {
        summary.failedCount += 1;
        summary.errors.push({
          rowNumber: row._rowNumber,
          menuItemName: row.name || '',
          message: error.message,
        });
      }
    }

    summary.uploadedImageCount = uploadedImageUrls.size;

    return summary;
  }
}

module.exports = new MenuCsvImportService();
