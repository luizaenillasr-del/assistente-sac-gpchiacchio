'use strict';

const prisma = require('../connection');

class BaseRepository {
  constructor(model) {
    this.model = model;
    this.client = prisma[model];
  }

  async findById(id) {
    return this.client.findUnique({ where: { id: Number(id) } });
  }

  async findAll(where = {}, options = {}) {
    return this.client.findMany({ where, ...options });
  }

  async create(data) {
    return this.client.create({ data });
  }

  async update(id, data) {
    return this.client.update({ where: { id: Number(id) }, data });
  }

  async upsert(where, create, update) {
    return this.client.upsert({ where, create, update });
  }

  async count(where = {}) {
    return this.client.count({ where });
  }

  async delete(id) {
    return this.client.delete({ where: { id: Number(id) } });
  }
}

module.exports = BaseRepository;
