const complianceDocumentService = require('../services/compliance-document.service');

async function upload(req, res, next) {
  try {
    // express.raw leaves req.body as {} when the Content-Type is not an accepted file type.
    const doc = await complianceDocumentService.upload({
      user: req.user,
      type: req.query.type,
      filename: req.query.filename,
      buffer: req.body,
    });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    res.status(200).json(await complianceDocumentService.listMine(req.user));
  } catch (err) {
    next(err);
  }
}

async function listForReview(req, res, next) {
  try {
    res.status(200).json(await complianceDocumentService.listForAdmin(req.query));
  } catch (err) {
    next(err);
  }
}

async function file(req, res, next) {
  try {
    const { doc, file: stored } = await complianceDocumentService.getFileForReview(req.params.id, req);
    res.set({
      'Content-Type': stored.mimeType,
      'Content-Disposition': `inline; filename="${String(doc.originalName || 'document').replace(/[^\w.\- ]/g, '_')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).send(stored.data);
  } catch (err) {
    next(err);
  }
}

async function review(req, res, next) {
  try {
    const doc = await complianceDocumentService.review(req.params.id, req.body, req);
    res.status(200).json({ _id: doc._id, status: doc.status, expiresAt: doc.expiresAt });
  } catch (err) {
    next(err);
  }
}

module.exports = { upload, listMine, listForReview, file, review };
