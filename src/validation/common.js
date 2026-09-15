const { z } = require('zod');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

const objectId = () => z.string().regex(OBJECT_ID_REGEX, 'Must be a valid ObjectId');

module.exports = {
  objectId,
};
