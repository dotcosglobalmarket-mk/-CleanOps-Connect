function formatZodError(zodError) {
  const error = new Error('Validation failed');
  error.status = 400;
  error.details = zodError.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return error;
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(formatZodError(result.error));
    }
    req.body = result.data;
    next();
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(formatZodError(result.error));
    }
    req.params = result.data;
    next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(formatZodError(result.error));
    }
    req.query = result.data;
    next();
  };
}

module.exports = {
  validateBody,
  validateParams,
  validateQuery,
};
