/**
 * Zod validation middleware factory.
 *
 * Usage:
 *   router.post('/register', validate(registerSchema), handler)
 *
 * Validates req.body by default; pass { source: 'query' } or { source: 'params' }
 * to validate other sources. Throws a ZodError on failure which the error
 * handler converts into a 422 with per-field messages.
 */
function validate(schema, { source = 'body' } = {}) {
  return (req, res, next) => {
    try {
      const data = schema.parse(req[source]);
      // Replace the source with the parsed (coerced/trimmed) data.
      req[source] = data;
      next();
    } catch (err) {
      next(err); // ZodError → errorHandler formats as 422
    }
  };
}

module.exports = validate;
