const jobPhotoService = require('../services/job-photo.service');

async function upload(req, res, next) {
  try {
    // express.raw leaves req.body as {} when the Content-Type is not an accepted image type.
    const photo = await jobPhotoService.upload({
      user: req.user,
      jobId: req.params.id,
      kind: req.query.kind,
      filename: req.query.filename,
      buffer: req.body,
    });
    res.status(201).json(photo);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    res.status(200).json(await jobPhotoService.list({ user: req.user, jobId: req.params.id }));
  } catch (err) {
    next(err);
  }
}

async function file(req, res, next) {
  try {
    const { photo, file: stored } = await jobPhotoService.getFile({
      user: req.user,
      jobId: req.params.id,
      photoId: req.params.photoId,
      req,
    });
    res.set({
      'Content-Type': stored.mimeType,
      'Content-Disposition': `inline; filename="${String(photo.originalName || 'photo').replace(/[^\w.\- ]/g, '_')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).send(stored.data);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await jobPhotoService.remove({ user: req.user, jobId: req.params.id, photoId: req.params.photoId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { upload, list, file, remove };
