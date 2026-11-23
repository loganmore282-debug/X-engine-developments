// A small in-memory stand-in for the parts of MongoDB the server uses, so
// tests can run the real query-building code. It understands equality,
// $or/$and, $in/$nin/$ne, $gt/$gte/$lt/$lte, $exists and $regex.
'use strict';
const { ObjectId } = require('mongodb');

const same = (a, b) => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
};
const isNil = (v) => v === null || v === undefined;

function cmp(a, b) {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

function matchValue(actual, cond) {
  const isOps = cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof ObjectId) && !Array.isArray(cond)
    && Object.keys(cond).some((k) => k.startsWith('$'));
  if (!isOps) return isNil(cond) ? isNil(actual) : same(actual, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$in': return arg.some((v) => (isNil(v) ? isNil(actual) : same(actual, v)));
      case '$nin': return !arg.some((v) => (isNil(v) ? isNil(actual) : same(actual, v)));
      case '$ne': return isNil(arg) ? !isNil(actual) : !same(actual, arg);
      case '$gt': return !isNil(actual) && cmp(actual, arg) > 0;
      case '$gte': return !isNil(actual) && cmp(actual, arg) >= 0;
      case '$lt': return !isNil(actual) && cmp(actual, arg) < 0;
      case '$lte': return !isNil(actual) && cmp(actual, arg) <= 0;
      case '$exists': return arg ? actual !== undefined : actual === undefined;
      case '$regex': return typeof actual === 'string' && new RegExp(arg, cond.$options || '').test(actual);
      case '$options': return true;
      default: throw new Error('fake-mongo: unsupported operator ' + op);
    }
  });
}

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([key, cond]) => {
    if (key === '$or') return cond.some((f) => matches(doc, f));
    if (key === '$and') return cond.every((f) => matches(doc, f));
    return matchValue(doc[key], cond);
  });
}

function makeDb() {
  const data = {};
  const rows = (name) => (data[name] = data[name] || []);
  return {
    data,
    collection(name) {
      const col = {
        async insertOne(doc) {
          const row = { ...doc };
          if (!row._id) row._id = new ObjectId();
          rows(name).push(row);
          return { insertedId: row._id };
        },
        async findOne(filter) { return rows(name).find((d) => matches(d, filter)) || null; },
        find(filter) {
          let list = rows(name).filter((d) => matches(d, filter));
          const cursor = {
            sort(spec) {
              // Every key in the spec counts, in order (later keys break ties), like MongoDB.
              const keys = Object.entries(spec);
              list = [...list].sort((a, b) => {
                for (const [key, dir] of keys) {
                  const c = cmp(a[key] ?? 0, b[key] ?? 0) * dir;
                  if (c !== 0) return c;
                }
                return 0;
              });
              return cursor;
            },
            skip(n) { list = list.slice(n); return cursor; },
            limit(n) { list = list.slice(0, n); return cursor; },
            async toArray() { return list; },
          };
          return cursor;
        },
        async countDocuments(filter) { return rows(name).filter((d) => matches(d, filter)).length; },
        async updateOne(filter, update, opts) {
          let row = rows(name).find((d) => matches(d, filter));
          if (!row) {
            if (!opts || !opts.upsert) return { matchedCount: 0 };
            row = { ...(filter._id !== undefined ? { _id: filter._id } : {}) };
            rows(name).push(row);
          }
          Object.assign(row, update.$set || {});
          for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
          for (const k of Object.keys(update.$unset || {})) delete row[k];
          return { matchedCount: 1 };
        },
        async updateMany(filter, update) {
          const hit = rows(name).filter((d) => matches(d, filter));
          for (const row of hit) {
            Object.assign(row, update.$set || {});
            for (const k of Object.keys(update.$unset || {})) delete row[k];
          }
          return { matchedCount: hit.length, modifiedCount: hit.length };
        },
        async deleteOne(filter) {
          const i = rows(name).findIndex((d) => matches(d, filter));
          if (i >= 0) rows(name).splice(i, 1);
          return { deletedCount: i >= 0 ? 1 : 0 };
        },
        async deleteMany(filter) { const before = rows(name).length; data[name] = rows(name).filter((d) => !matches(d, filter)); return { deletedCount: before - data[name].length }; },
        async findOneAndUpdate(filter, update, opts) {
          let row = rows(name).find((d) => matches(d, filter));
          if (!row) {
            if (!opts || !opts.upsert) return { value: null };
            row = { ...(update.$setOnInsert || {}), count: 0 };
            rows(name).push(row);
          }
          for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
          return { value: row };
        },
      };
      return col;
    },
  };
}

// Makes require('./db') hand out this database to every module.
function stubDb(db) {
  const dbPath = require.resolve('./db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => db, connect: async () => {} } };
}

module.exports = { makeDb, stubDb, ObjectId };
