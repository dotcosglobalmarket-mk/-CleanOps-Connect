const adminService = require('../services/admin.service');
const opsService = require('../services/ops.service');
const auditService = require('../services/audit.service');
const staffService = require('../services/staff.service');

// The admin dashboard's verification and status forms predate the audit
// log and do not ask for a reason, so a default one is recorded.
const DEFAULT_ADMIN_REASON = 'Updated from the admin dashboard';

async function summary(req, res, next) {
  try {
    res.status(200).json(await adminService.getSummary());
  } catch (err) {
    next(err);
  }
}

async function listCleaners(req, res, next) {
  try {
    res.status(200).json(await adminService.listCleaners(req.query));
  } catch (err) {
    next(err);
  }
}

async function getCleaner(req, res, next) {
  try {
    res.status(200).json(await adminService.getCleanerById(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function updateCleanerVerification(req, res, next) {
  try {
    const { reason, ...updates } = req.body;
    res
      .status(200)
      .json(await opsService.updateCleanerVerification(req.params.id, updates, reason || DEFAULT_ADMIN_REASON, req));
  } catch (err) {
    next(err);
  }
}

async function updateCleanerDeactivation(req, res, next) {
  try {
    res
      .status(200)
      .json(
        await opsService.updateCleanerStatus(
          req.params.id,
          req.body.deactivationStatus,
          req.body.reason || DEFAULT_ADMIN_REASON,
          req
        )
      );
  } catch (err) {
    next(err);
  }
}

async function listJobs(req, res, next) {
  try {
    res.status(200).json(await adminService.listJobs(req.query));
  } catch (err) {
    next(err);
  }
}

async function getJob(req, res, next) {
  try {
    res.status(200).json(await adminService.getJobById(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function listApprovals(req, res, next) {
  try {
    res.status(200).json(await opsService.listApprovals(req.query));
  } catch (err) {
    next(err);
  }
}

async function decideApproval(req, res, next) {
  try {
    res.status(200).json(await opsService.decideApproval(req.params.id, req.body, req));
  } catch (err) {
    next(err);
  }
}

async function listAudit(req, res, next) {
  try {
    res.status(200).json(await auditService.list(req.query));
  } catch (err) {
    next(err);
  }
}

async function listStaff(req, res, next) {
  try {
    res.status(200).json(await staffService.listStaff(req.query));
  } catch (err) {
    next(err);
  }
}

async function createStaff(req, res, next) {
  try {
    res.status(201).json(await staffService.createStaff(req.body, req));
  } catch (err) {
    next(err);
  }
}

async function updateStaff(req, res, next) {
  try {
    res.status(200).json(await staffService.setStaffActive(req.params.id, req.body.active, req.body.reason, req));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  summary,
  listApprovals,
  decideApproval,
  listAudit,
  listStaff,
  createStaff,
  updateStaff,
  listCleaners,
  getCleaner,
  updateCleanerVerification,
  updateCleanerDeactivation,
  listJobs,
  getJob,
};
