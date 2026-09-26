const adminService = require('../services/admin.service');
const opsService = require('../services/ops.service');

function wrap(fn) {
  return async (req, res, next) => {
    try {
      const result = await fn(req, res);
      res.status(result.status || 200).json(result.body);
    } catch (err) {
      next(err);
    }
  };
}

const summary = wrap(async () => ({ body: await opsService.getSummary() }));

const listDisputes = wrap(async () => ({ body: await opsService.listDisputes() }));

const getDispute = wrap(async (req) => ({ body: await opsService.getDispute(req.params.id) }));

const resolveDispute = wrap(async (req) => {
  const result = await opsService.resolveDispute(req.params.id, req.body, req);
  return { status: result.status === 'pending_approval' ? 202 : 200, body: result };
});

const listCleaners = wrap(async (req) => ({ body: await adminService.listCleaners(req.query) }));

const getCleaner = wrap(async (req) => ({ body: await opsService.getCleanerDetail(req.params.id) }));

const updateCleanerVerification = wrap(async (req) => {
  const { reason, ...updates } = req.body;
  return { body: await opsService.updateCleanerVerification(req.params.id, updates, reason, req) };
});

const updateCleanerStatus = wrap(async (req) => ({
  body: await opsService.updateCleanerStatus(req.params.id, req.body.deactivationStatus, req.body.reason, req),
}));

const listJobs = wrap(async (req) => ({ body: await adminService.listJobs(req.query) }));

const getJob = wrap(async (req) => {
  const [job, notes] = await Promise.all([
    adminService.getJobById(req.params.id),
    opsService.listJobNotes(req.params.id),
  ]);
  return { body: { job, notes } };
});

const addJobNote = wrap(async (req) => ({
  status: 201,
  body: await opsService.addJobNote(req.params.id, req.body.body, req),
}));

module.exports = {
  summary,
  listDisputes,
  getDispute,
  resolveDispute,
  listCleaners,
  getCleaner,
  updateCleanerVerification,
  updateCleanerStatus,
  listJobs,
  getJob,
  addJobNote,
};
