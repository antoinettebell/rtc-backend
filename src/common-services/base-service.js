const CommonModelService = require('./common-service');
const { Model: DummyModel } = require('mongoose');

class BaseService {
  constructor(model = DummyModel) {
    this.model = model;
  }

  get commonModelService() {
    return CommonModelService;
  }

  async getById(id, options, field = null) {
    return await this.commonModelService.getById(
      this.model,
      id,
      options,
      field
    );
  }

  async getByData(params, options, field = null) {
    return await this.commonModelService.list(
      this.model,
      params,
      options,
      field
    );
  }

  async updateById(id, updateFields, options) {
    return await this.commonModelService.save(
      this.model,
      { _id: id },
      updateFields,
      options
    );
  }

  async update(params, updateFields, options) {
    return await this.commonModelService.save(
      this.model,
      params,
      updateFields,
      options
    );
  }

  async create(updateFields, options) {
    return await this.commonModelService.save(
      this.model,
      null,
      updateFields,
      options
    );
  }

  async destroy(params) {
    return await this.commonModelService.destroy(this.model, params);
  }

  async destroyMany(params) {
    return await this.commonModelService.destroyMany(this.model, params);
  }

  async getCount(params, options) {
    return await this.commonModelService.getCount(this.model, params, options);
  }

  async updateMany(query, data) {
    return await this.model.updateMany(query, { $set: data });
  }

  async insertMany(data) {
    if (!Array.isArray(data))
      throw new Error('InsertMany params must be array');
    return await this.model.insertMany(data);
  }

  getModel() {
    return this.model;
  }
}

module.exports = { BaseService };
