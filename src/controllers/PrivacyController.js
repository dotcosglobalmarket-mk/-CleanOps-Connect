const privacyService = require('../services/privacy-request.service');
const auditService = require('../services/audit.service');

async function lookup(req, res, next) {
  try {
    res.status(200).json(await privacyService.lookup(req.query.email));
  } catch (err) {
    next(err);
  }
}

// The copy is a download, never cached. Producing it is itself recorded.
async function exportData(req, res, next) {
  try {
    const data = await privacyService.exportData(req.params.id);
    await auditService.record({
      req,
      action: 'user.export',
      targetType: 'user',
      targetId: req.params.id,
      reason: 'A copy of their data was produced at their request (identity checked)',
    });
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cleanops-data-${req.params.id}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).send(JSON.stringify(data, null, 2));
  } catch (err) {
    next(err);
  }
}

async function erase(req, res, next) {
  try {
    res.status(200).json(await privacyService.erase(req.params.id, req.body, req));
  } catch (err) {
    next(err);
  }
}

module.exports = { lookup, exportData, erase };
