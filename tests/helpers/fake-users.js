// A small in-memory stand-in for the users collection that understands exactly the
// filters and updates two-factor.service.js sends ($set, $unset, $inc, $pull; $or,
// $exists, $lt, $lte, $gt, $ne). Each call is applied in one step, as MongoDB
// applies a single-document update, so these tests exercise the service's logic
// under simultaneous requests. (They do not prove MongoDB itself is atomic.)
const store = { doc: null };
const clone = (d) => (d ? JSON.parse(JSON.stringify(d), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v)) : d);
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((a, k) => (a[k] = a[k] || {}), o);
  if (value === undefined) delete target[last];
  else target[last] = value;
}
function matchValue(actual, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    const ops = {
      $exists: (v) => (actual !== undefined) === v,
      $lt: (v) => actual != null && actual < v,
      $lte: (v) => actual != null && actual <= v,
      $gt: (v) => actual != null && actual > v,
      $ne: (v) => actual !== v,
    };
    return Object.entries(cond).every(([op, v]) => ops[op](v));
  }
  if (Array.isArray(actual)) return actual.includes(cond);
  return cond === null ? actual == null : actual === cond;
}
const matches = (doc, filter) =>
  Object.entries(filter).every(([k, v]) => (k === '$or' ? v.some((f) => matches(doc, f)) : matchValue(k === '_id' ? doc._id : getPath(doc, k), v)));
function applyUpdate(doc, update) {
  Object.entries(update.$set || {}).forEach(([k, v]) => setPath(doc, k, v));
  Object.keys(update.$unset || {}).forEach((k) => setPath(doc, k, undefined));
  Object.entries(update.$inc || {}).forEach(([k, v]) => setPath(doc, k, (getPath(doc, k) || 0) + v));
  Object.entries(update.$pull || {}).forEach(([k, v]) => setPath(doc, k, (getPath(doc, k) || []).filter((x) => x !== v)));
}
// Every database call yields once first, so simultaneous requests really do interleave.
const tick = () => new Promise((resolve) => setImmediate(resolve));

const jestFn = (fn) => jest.fn(fn);
const model = ({
  findById: jestFn(async () => {
    await tick();
    if (!store.doc) return null;
    const copy = clone(store.doc);
    copy.save = async () => { Object.assign(store.doc, clone({ ...copy, save: undefined })); };
    return copy;
  }),
  findOneAndUpdate: jestFn(async (filter, update, options = {}) => {
    await tick();
    if (!store.doc || !matches(store.doc, filter)) return null;
    const before = clone(store.doc);
    applyUpdate(store.doc, update);
    return options.new ? clone(store.doc) : before;
  }),
  updateOne: jestFn(async (filter, update) => {
    await tick();
    if (store.doc && matches(store.doc, filter)) applyUpdate(store.doc, update);
  }),
});

module.exports = { store, clone, model };
