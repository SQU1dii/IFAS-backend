'use strict';
const { parse } = require('csv-parse/sync');

/**
 * Parse a CSV Buffer/string and return an array of plain objects.
 * Columns are trimmed; empty rows are skipped.
 * Expected IFAS import headers: ref, date, description, amount, type,
 *                               account, to_account, category, department
 */
function parseImportCsv(buffer) {
  const records = parse(buffer, {
    columns:           true,
    skip_empty_lines:  true,
    trim:              true,
    cast:              false,
  });
  return records;
}

module.exports = { parseImportCsv };
