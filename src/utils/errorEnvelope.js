/**
 * Builds the canonical IFAS error response body.
 */
function errorBody(code, message, fields = null) {
  return { error: { code, message, fields } };
}

module.exports = { errorBody };
