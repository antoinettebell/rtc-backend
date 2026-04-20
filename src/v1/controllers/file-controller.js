const { FileService: Service } = require('../services');
const { addObject } = require('../../helper/aws');
const fs = require('fs');
const entityName = 'File';

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
    const { file } = req;

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded!' });
    }

    let data = null;

    try {
      const fileUrl = await addObject(file);
      // fs.unlinkSync(req.file.path);
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('File delete error:', err);
      });
      data = await Service.create({
        fileUrl,
      });
    } catch (e) {
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
      // fs.unlinkSync(req.file.path);
      throw e;
    }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data?.fileUrl },
      `${entityName} added`
    );
  } catch (e) {
    return next(e);
  }
};
