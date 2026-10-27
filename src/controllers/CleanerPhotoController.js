const cleanerPhotoService = require('../services/cleaner-photo.service');

async function upload(req, res, next) {
  try {
    // express.raw leaves req.body as {} when the Content-Type is not an accepted image type.
    res.status(200).json(await cleanerPhotoService.setPhoto({ userId: req.user.id, buffer: req.body }));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await cleanerPhotoService.removePhoto({ userId: req.user.id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function get(req, res, next) {
  try {
    const { file } = await cleanerPhotoService.getPhoto({ user: req.user, cleanerId: req.params.id });
    res.set({
      'Content-Type': file.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).send(file.data);
  } catch (err) {
    next(err);
  }
}

module.exports = { upload, remove, get };
