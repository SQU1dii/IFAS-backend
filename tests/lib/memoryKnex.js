/**
 * In-memory Knex-compatible mock for the IFAS test suite.
 *
 * Implements the subset of the Knex query-builder API that the IFAS
 * repositories use, so the full Express app can be exercised with Supertest
 * without MySQL or any native dependency.
 *
 * JOIN semantics:
 *   knex('left_table').join('right_table as alias', 'alias.col', 'left_table.col')
 *   → for each left row, find right rows where right[leftArg] == left[rightArg]
 *   NOTE: Knex's 3-arg join convention is (rightTable, rightCol, leftCol).
 *
 * After a join, merged rows contain:
 *   - All bare keys from both tables (left-table bare keys win on conflict)
 *   - All keys prefixed with right-table real name  e.g. "roles.name"
 *   - All keys prefixed with right-table alias      e.g. "r.name"
 * This lets  .select('r.name as role_name')  work even when both
 * workspace and roles have a column named "name".
 */

'use strict';

/* ─── helpers ──────────────────────────────────────────────────────────────── */

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Strip a single table-alias prefix: "wm.user_id" → "user_id". */
function bare(col) {
  if (typeof col !== 'string') return col;
  return col.includes('.') ? col.slice(col.indexOf('.') + 1) : col;
}

/** Compare two values with an operator. */
function cmp(a, op, b) {
  /* loose equality so numeric IDs stored as numbers match string comparisons */
  switch (op) {
    case '=':  case '==': return a == b;   // eslint-disable-line eqeqeq
    case '!=': case '<>': return a != b;   // eslint-disable-line eqeqeq
    case '<':  return a < b;
    case '<=': return a <= b;
    case '>':  return a > b;
    case '>=': return a >= b;
    case 'like': {
      const pat = String(b).replace(/%/g, '');
      return String(a).toLowerCase().includes(pat.toLowerCase());
    }
    default:   return false;
  }
}

/** Parse an aggregate argument: "col as alias" | { alias: col } | "col" */
function parseAgg(arg) {
  if (!arg || arg === '*') return { col: '*', alias: 'count' };
  if (typeof arg === 'string') {
    const m = arg.match(/^\s*([\w.*]+)\s+(?:as\s+)?(\w+)\s*$/i);
    if (m) return { col: bare(m[1]), alias: m[2] };
    return { col: bare(arg), alias: bare(arg) };
  }
  const [[alias, col]] = Object.entries(arg);
  return { col: bare(col), alias };
}

/** Parse "table as alias" → { real, alias } */
function parseTable(t) {
  const m = (t || '').match(/^(\w+)(?:\s+(?:as\s+)?(\w+))?$/i);
  if (!m) return { real: t, alias: t };
  return { real: m[1], alias: m[2] || m[1] };
}

/* ─── QueryBuilder ─────────────────────────────────────────────────────────── */

class QueryBuilder {
  constructor(store, realTable) {
    this._store   = store;
    this._table   = realTable;
    this._type    = 'select';
    this._cols    = null;        // null = SELECT *
    this._wheres  = [];
    this._order   = [];
    this._limit   = null;
    this._offset  = 0;
    this._joins   = [];          // { real, alias, lCol, op, rCol, kind }
    this._groups  = [];
    this._aggs    = [];
    this._distinct= null;
    this._first   = false;
    this._insRows = null;
    this._patch   = null;
    this._ret     = null;        // RETURNING columns
  }

  /* ── selection ─────────────────────────────────────────────────────────── */
  from(t)       { this._table = parseTable(t).real; return this; }
  select(...cs) { this._cols  = cs.length ? cs : null; return this; }
  column(...cs) { this._cols  = cs; return this; }
  distinct(...cs){ this._distinct = cs; return this; }

  /* ── filtering ─────────────────────────────────────────────────────────── */
  _push(p)  { this._wheres.push(p); return this; }

  where(a, b, c) {
    if (typeof a === 'function')             return this._push(a);
    if (a && typeof a === 'object') {
      for (const [k, v] of Object.entries(a)) {
        const col = bare(k);
        this._push((r) => cmp(r[col], '=', v));
      }
      return this;
    }
    const col = bare(a);
    if (c === undefined) return this._push((r) => cmp(r[col], '=', b));
    return this._push((r) => cmp(r[col], b, c));
  }
  andWhere(...a)          { return this.where(...a); }
  orWhere(a, b, c)        {
    const preds = [];
    if (typeof a === 'function') { preds.push(a); }
    else if (a && typeof a === 'object') {
      for (const [k, v] of Object.entries(a)) { const col = bare(k); preds.push((r) => cmp(r[col], '=', v)); }
    } else {
      const col = bare(a);
      preds.push(c === undefined ? (r) => cmp(r[col], '=', b) : (r) => cmp(r[col], b, c));
    }
    return this._push((r) => preds.some((p) => p(r)));
  }
  whereIn(col, arr)       { const k = bare(col); const s = new Set(arr.map(String)); return this._push((r) => r[k] != null && s.has(String(r[k]))); }
  whereNotIn(col, arr)    { const k = bare(col); const s = new Set(arr.map(String)); return this._push((r) => r[k] == null || !s.has(String(r[k]))); }
  whereNull(col)          { const k = bare(col); return this._push((r) => r[k] == null); }
  whereNotNull(col)       { const k = bare(col); return this._push((r) => r[k] != null); }
  whereRaw()              { throw new Error('whereRaw not supported by in-memory mock'); }

  /* ── sorting / paging ─────────────────────────────────────────────────── */
  orderBy(col, dir = 'asc') { this._order.push({ col: bare(col), dir: dir.toLowerCase() }); return this; }
  limit(n)  { this._limit  = n; return this; }
  offset(n) { this._offset = n; return this; }
  first()   { this._first  = true; this._limit = 1; return this; }

  /* ── joins ─────────────────────────────────────────────────────────────── */
  _join(table, lColRaw, opOrRC, rcRaw, kind) {
    const { real, alias } = parseTable(table);
    let op, rCol;
    if (rcRaw === undefined) { op = '='; rCol = bare(opOrRC); }
    else { op = opOrRC; rCol = bare(rcRaw); }
    // lCol is the RIGHT-table column (first arg after table in Knex join)
    // rCol is the LEFT-accumulated-row column
    this._joins.push({ real, alias, lCol: bare(lColRaw), op, rCol, kind });
    return this;
  }
  join(t, l, o, r)     { return this._join(t, l, o, r, 'inner'); }
  leftJoin(t, l, o, r) { return this._join(t, l, o, r, 'left');  }

  /* ── aggregates ─────────────────────────────────────────────────────────── */
  groupBy(...cs) { this._groups = cs.map(bare); return this; }
  count(a = '*') { this._aggs.push({ fn: 'count', ...parseAgg(a) }); this._type = 'aggregate'; return this; }
  sum(a)         { this._aggs.push({ fn: 'sum',   ...parseAgg(a) }); this._type = 'aggregate'; return this; }
  min(a)         { this._aggs.push({ fn: 'min',   ...parseAgg(a) }); this._type = 'aggregate'; return this; }
  max(a)         { this._aggs.push({ fn: 'max',   ...parseAgg(a) }); this._type = 'aggregate'; return this; }
  avg(a)         { this._aggs.push({ fn: 'avg',   ...parseAgg(a) }); this._type = 'aggregate'; return this; }

  /* ── mutations ─────────────────────────────────────────────────────────── */
  insert(rows, returning) {
    this._type    = 'insert';
    this._insRows = Array.isArray(rows) ? rows : [rows];
    if (returning) this._ret = Array.isArray(returning) ? returning : [returning];
    return this;
  }
  returning(cols) { this._ret = Array.isArray(cols) ? cols : [cols]; return this; }
  update(patch)   { this._type = 'update'; this._patch = patch; return this; }
  del()           { this._type = 'delete'; return this; }
  delete()        { return this.del(); }

  clone() {
    const q = new QueryBuilder(this._store, this._table);
    Object.assign(q, this);
    q._wheres = this._wheres.slice();
    q._order  = this._order.slice();
    q._joins  = this._joins.slice();
    q._aggs   = this._aggs.slice();
    q._groups = this._groups.slice();
    return q;
  }

  /* ── execution ─────────────────────────────────────────────────────────── */

  /** Build the joined + filtered row set. */
  _build() {
    let rows = this._store.table(this._table).slice();

    for (const j of this._joins) {
      const right = this._store.table(j.real);
      const out   = [];

      for (const left of rows) {
        let matched = false;
        for (const rr of right) {
          // j.lCol = column on the RIGHT table
          // j.rCol = column on the LEFT accumulated row
          if (cmp(rr[j.lCol], j.op, left[j.rCol])) {
            matched = true;
            // Merge: right table first (all bare + prefixed), then left bare wins
            const merged = {};
            for (const [k, v] of Object.entries(rr)) {
              merged[k] = v;
              merged[`${j.real}.${k}`]  = v;          // "roles.name"
              if (j.alias !== j.real) merged[`${j.alias}.${k}`] = v;  // "r.name"
            }
            for (const [k, v] of Object.entries(left)) {
              merged[k] = v;                           // left bare wins
            }
            out.push(merged);
          }
        }
        if (!matched && j.kind === 'left') out.push({ ...left });
      }
      rows = out;
    }

    for (const pred of this._wheres) rows = rows.filter(pred);
    return rows;
  }

  /** Project final column selection onto rows. */
  _project(rows) {
    if (!this._cols || !this._cols.length || this._cols[0] === '*') return rows;
    return rows.map((r) => {
      const out = {};
      for (const c of this._cols) {
        if (c === '*') { Object.assign(out, r); continue; }

        // "table.*" — copy all bare (non-prefixed) keys
        if (c.endsWith('.*')) {
          for (const [k, v] of Object.entries(r)) {
            if (!k.includes('.')) out[k] = v;
          }
          continue;
        }

        // "expr as alias"
        const asM = c.match(/^(.+?)\s+as\s+(\w+)$/i);
        if (asM) {
          const expr  = asM[1].trim();
          const alias = asM[2];
          out[alias] = r[expr] !== undefined ? r[expr] : r[bare(expr)];
          continue;
        }

        // "table.col"
        const dotM = c.match(/^(\w+)\.(\w+)$/);
        if (dotM) {
          out[dotM[2]] = r[c] !== undefined ? r[c] : r[dotM[2]];
          continue;
        }

        out[c] = r[c];
      }
      return out;
    });
  }

  _applyAgg(fn, rows, col) {
    const vals = rows.map((r) => r[col]).filter((v) => v != null).map(Number);
    switch (fn) {
      case 'count': return rows.length;
      case 'sum':   return vals.reduce((a, b) => a + b, 0);
      case 'min':   return vals.length ? Math.min(...vals) : null;
      case 'max':   return vals.length ? Math.max(...vals) : null;
      case 'avg':   return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      default:      return null;
    }
  }

  _aggregate(rows) {
    if (!this._groups.length) {
      const out = {};
      for (const a of this._aggs) out[a.alias] = this._applyAgg(a.fn, rows, a.col);
      return [out];
    }
    const groups = new Map();
    for (const r of rows) {
      const key = this._groups.map((c) => String(r[c])).join('\x00');
      if (!groups.has(key)) {
        const gKey = {};
        for (const c of this._groups) gKey[c] = r[c];
        groups.set(key, { gKey, items: [] });
      }
      groups.get(key).items.push(r);
    }
    return Array.from(groups.values()).map(({ gKey, items }) => {
      const row = { ...gKey };
      for (const a of this._aggs) row[a.alias] = this._applyAgg(a.fn, items, a.col);
      return row;
    });
  }

  async _execute() {
    /* ── INSERT ── */
    if (this._type === 'insert') {
      const ids = this._store.insert(this._table, this._insRows);
      if (this._ret) {
        return ids.map((id) => {
          const row = this._store.table(this._table).find((r) => r.id === id) || {};
          const out = {};
          for (const col of this._ret) out[col] = row[col];
          return out;
        });
      }
      return ids;
    }

    /* ── UPDATE ── */
    if (this._type === 'update') return this._store.update(this._table, this._wheres, this._patch);

    /* ── DELETE ── */
    if (this._type === 'delete') return this._store.del(this._table, this._wheres);

    /* ── SELECT / AGGREGATE ── */
    let rows = this._build();

    if (this._type === 'aggregate') {
      const agg = this._aggregate(rows);
      return this._first ? (agg[0] ?? undefined) : agg;
    }

    // sort
    for (const { col, dir } of this._order) {
      rows.sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === 'desc' ? -1 : 1);
      });
    }

    // offset / limit
    if (this._offset) rows = rows.slice(this._offset);
    if (this._limit  != null) rows = rows.slice(0, this._limit);

    rows = this._project(rows);

    // distinct
    if (this._distinct && this._distinct.length) {
      const seen = new Set();
      rows = rows.filter((r) => {
        const k = JSON.stringify(this._distinct.map((c) => r[c]));
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    return this._first ? (rows[0] ?? undefined) : rows;
  }

  /* ── thenable ── */
  then(ok, fail) { return Promise.resolve().then(() => this._execute()).then(ok, fail); }
  catch(fail)    { return this.then(undefined, fail); }
  finally(fn)    { return this.then(() => fn(), () => fn()); }
}

/* ─── MemoryStore ───────────────────────────────────────────────────────────── */

class MemoryStore {
  constructor() {
    this.tables      = new Map();
    this.sequences   = new Map();
    this.constraints = [];
  }

  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name);
  }

  registerCompositeFK(child, childCols, parent, parentCols) {
    this.constraints.push({ child, childCols, parent, parentCols });
  }

  _checkFKs(tableName, rows) {
    for (const c of this.constraints) {
      if (c.child !== tableName) continue;
      for (const row of rows) {
        if (c.childCols.some((col) => row[col] == null)) continue; // nullable FK → skip
        const ok = this.table(c.parent).some((p) =>
          c.parentCols.every((col, i) => p[col] == row[c.childCols[i]]), // eslint-disable-line eqeqeq
        );
        if (!ok) throw new Error(
          `FK violation: ${tableName}(${c.childCols}) → ${c.parent}(${c.parentCols})`,
        );
      }
    }
  }

  _stamp(row, tableName) {
    const out = { ...row };
    if (out.created_at == null) out.created_at = now();
    // Only set updated_at if the table schema uses it (check existing rows or row itself)
    const sample = this.table(tableName)[0];
    if (out.updated_at == null && (row.updated_at !== undefined || (sample && 'updated_at' in sample))) {
      out.updated_at = out.created_at;
    }
    return out;
  }

  insert(tableName, rows) {
    const stamped = rows.map((r) => this._stamp(r, tableName));
    this._checkFKs(tableName, stamped);
    let seq = this.sequences.get(tableName) ?? 1;
    const ids = [];
    for (const row of stamped) {
      if (row.id == null) row.id = seq++;
      else seq = Math.max(seq, Number(row.id) + 1);
      this.table(tableName).push(row);
      ids.push(row.id);
    }
    this.sequences.set(tableName, seq);
    return ids;
  }

  update(tableName, preds, patch) {
    let count = 0;
    for (const row of this.table(tableName)) {
      if (preds.every((p) => p(row))) {
        Object.assign(row, patch);
        if ('updated_at' in row) row.updated_at = now();
        count++;
      }
    }
    return count;
  }

  del(tableName, preds) {
    const before = this.table(tableName).length;
    this.tables.set(tableName, this.table(tableName).filter((r) => !preds.every((p) => p(r))));
    return before - this.table(tableName).length;
  }

  reset() {
    this.tables.clear();
    this.sequences.clear();
  }
}

/* ─── factory ───────────────────────────────────────────────────────────────── */

function createMemoryKnex() {
  const store = new MemoryStore();

  function knex(tableExpr) {
    return new QueryBuilder(store, parseTable(tableExpr).real);
  }

  knex.from = (t) => new QueryBuilder(store, parseTable(t).real);
  knex.raw  = () => { throw new Error('knex.raw not supported by in-memory mock'); };
  knex.fn   = { now };

  knex.transaction = async (cb) => {
    // Snapshot for rollback
    const snap    = new Map(Array.from(store.tables,    ([k, v]) => [k, v.map((r) => ({ ...r }))]));
    const seqSnap = new Map(store.sequences);
    try {
      return await cb(knex);          // same instance — no real connection
    } catch (err) {
      store.tables    = snap;
      store.sequences = seqSnap;
      throw err;
    }
  };

  knex.destroy  = () => {};
  knex.isMemory = true;
  knex._store   = store;
  return knex;
}

module.exports = { createMemoryKnex, MemoryStore, QueryBuilder };
