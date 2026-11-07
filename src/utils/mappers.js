'use strict';
/**
 * Field mappers — translate backend (DB) rows into the shapes the frontend
 * expects. Every response goes through `ok(res, mapper(row))` so the data
 * the Vue components receive matches the mock contract exactly.
 */

// ── User ──────────────────────────────────────────────────────────────────────
function mapUser(u) {
  if (!u) return null;
  return {
    id:       u.id,
    name:     u.full_name,
    email:    u.email,
    phone:    u.phone ?? null,
    currency: 'KES',
    date_format: 'DD/MM/YYYY',
    theme:    'light',
    created_at: u.created_at,
    is_platform_admin: !!u.is_platform_admin,
    notification_prefs: { budget_alerts: true, goal_reminders: true, insight_notifications: true },
  };
}

// ── Workspace ─────────────────────────────────────────────────────────────────
function mapWorkspace(w, role = null, permissions = []) {
  return {
    id:         w.id,
    name:       w.name,
    type:       w.workspace_type,
    currency:   w.currency,
    created_at: (w.created_at || '').toString().slice(0, 10),
    my_role:    w.my_role || role || w.role_name || null,
    my_permissions: w.my_permissions || permissions || [],
  };
}

// ── Member ────────────────────────────────────────────────────────────────────
function mapMember(m) {
  return {
    id:        m.id,
    user_id:   m.user_id,
    name:      m.full_name || m.name || null,
    email:     m.email,
    role:      m.role || _simpleRole(m.role_name),
    joined_at: (m.joined_at || '').toString().slice(0, 10),
    department_id: m.department_id ?? null,
    department_name: m.department_name ?? null,
  };
}

// Frontend uses simple lowercase roles: owner / admin / manager / member / viewer
function _simpleRole(roleName) {
  if (!roleName) return 'member';
  const n = String(roleName).toLowerCase();
  if (n.includes('owner'))    return 'owner';
  if (n.includes('admin'))    return 'admin';
  if (n.includes('manager')) return 'manager';
  if (n.includes('head'))    return 'manager';
  if (n.includes('finance'))  return 'manager';
  if (n.includes('viewer'))  return 'viewer';
  return 'member';
}

// ── Department ─────────────────────────────────────────────────────────────────
function mapDepartment(d) {
  const budget = Number(d.budget ?? 0);
  const spent = Number(d.spent ?? 0);
  const utilization = budget > 0 ? Math.round((spent / budget) * 1000) / 10 : 0;
  return {
    id:            d.id,
    workspace_id:  d.workspace_id,
    name:          d.name,
    budget,
    spent,
    head_name:     d.head_name ?? '',
    utilization_pct: utilization,
    remaining:     budget - spent,
    status:        spent > budget ? 'over' : utilization >= 80 ? 'warning' : 'on_track',
  };
}

// ── Account ───────────────────────────────────────────────────────────────────
function mapAccount(a, currency = 'KES') {
  return {
    id:          a.id,
    name:        a.name,
    type:        a.account_type || a.type,
    currency:    a.currency || currency,
    balance:     Number(a.opening_balance ?? a.balance ?? 0),
    institution: a.institution ?? '',
    is_active:   a.is_active ?? true,
    created_at:  (a.created_at || '').toString().slice(0, 10),
  };
}

// ── Category ──────────────────────────────────────────────────────────────────
function mapCategory(c) {
  return { id: c.id, name: c.name, type: c.category_type || c.type };
}

// ── Transaction ───────────────────────────────────────────────────────────────
// Frontend shape:
//   { id, date, description, amount, type, category_id, category_name,
//     account_id, account_name, destination_account_id, destination_account_name, notes }
function mapTransaction(t, names = {}) {
  return {
    id:                    t.id,
    date:                  (t.txn_date || t.date || '').toString().slice(0, 10),
    description:           t.description,
    amount:                Number(t.amount),
    type:                  (t.txn_type || t.type || '').toLowerCase(),
    category_id:           t.category_id ?? null,
    category_name:         names.categoryName ?? t.category_name ?? null,
    account_id:            t.account_id,
    account_name:          names.accountName ?? t.account_name ?? '',
    destination_account_id: t.to_account_id ?? t.destination_account_id ?? null,
    destination_account_name: names.destAccountName ?? t.destination_account_name ?? null,
    notes:                 t.notes ?? '',
    status:                t.status ?? 'POSTED',
  };
}

// ── Budget ────────────────────────────────────────────────────────────────────
// Frontend model: { id, category_id, category_name, limit, period, notes, spent, remaining, utilization, status }
function mapBudget(b, enriched = {}) {
  const limit = Number(b.amount_limit ?? b.limit ?? 0);
  const spent = Number(enriched.spent ?? b.spent ?? 0);
  const remaining = limit - spent;
  const utilization = limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0;
  return {
    id:            b.id,
    category_id:   b.category_id ?? null,
    category_name: b.category_name ?? enriched.category_name ?? '',
    limit,
    period:        b.period || _inferPeriod(b.period_start, b.period_end),
    notes:         b.notes ?? '',
    spent,
    remaining,
    utilization,
    status:        spent >= limit ? 'over' : utilization >= (b.alert_threshold ?? 80) ? 'warning' : 'on_track',
  };
}

function _inferPeriod(start, end) {
  if (!start || !end) return 'monthly';
  const s = new Date(start), e = new Date(end);
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  return months >= 11 ? 'yearly' : 'monthly';
}

// ── Savings Goal ──────────────────────────────────────────────────────────────
function mapSavingsGoal(g) {
  const target = Number(g.target_amount ?? 0);
  const current = Number(g.saved_amount ?? g.current_amount ?? 0);
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const remaining = Math.max(0, target - current);
  const reached = current >= target;
  let days_remaining = null;
  if (g.target_date) {
    days_remaining = Math.ceil((new Date(g.target_date).getTime() - Date.now()) / 86400000);
  }
  let monthly_needed = null;
  if (!reached && days_remaining != null && days_remaining > 0) {
    monthly_needed = Math.ceil((remaining / (days_remaining / 30.44)) * 100) / 100;
  }
  return {
    id:               g.id,
    name:             g.name,
    target_amount:    target,
    current_amount:   current,
    target_date:      g.target_date ?? null,
    notes:            g.notes ?? '',
    progress_pct:     Math.round(pct * 10) / 10,
    remaining_amount: remaining,
    reached,
    days_remaining,
    monthly_needed,
  };
}

// ── Contribution ───────────────────────────────────────────────────────────────
function mapContribution(c) {
  return {
    id:      c.id,
    goal_id: c.goal_id,
    date:    (c.date || '').toString().slice(0, 10),
    amount:  Number(c.amount),
    type:    c.type || 'contribution',
    notes:   c.notes ?? '',
  };
}

// ── Alert ───────────────────────────────────────────────────────────────────────
function mapAlert(a) {
  return {
    id:           a.id,
    workspace_id: a.workspace_id,
    type:         (a.alert_type || a.type || '').toLowerCase(),
    severity:     (a.severity || 'medium').toLowerCase(),
    title:        a.title || a.reason || '',
    description:  a.description || a.reason || '',
    status:       (a.status || 'open').toLowerCase(),
    created_at:   a.created_at,
    transaction_id: a.transaction_id ?? null,
    budget_id:    a.budget_id ?? null,
  };
}

// ── Recommendation ───────────────────────────────────────────────────────────────
function mapRecommendation(r) {
  return {
    id:            r.id,
    workspace_id:  r.workspace_id,
    title:         r.title || (r.recommendation || '').split('.')[0] || 'Recommendation',
    body:          r.body || r.recommendation || '',
    priority:      r.priority || 'medium',
    created_at:    r.created_at,
  };
}

// ── Conversation / Message ───────────────────────────────────────────────────────
function mapConversation(c, messages = null) {
  return {
    id:         c.id,
    title:      c.title,
    messages:   messages ?? c.messages ?? [],
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function mapMessage(m) {
  return {
    id:         m.id,
    role:       m.role,
    content:    m.content,
    created_at: m.created_at,
  };
}

module.exports = {
  mapUser, mapWorkspace, mapMember, mapDepartment, mapAccount, mapCategory,
  mapTransaction, mapBudget, mapSavingsGoal, mapContribution, mapAlert,
  mapRecommendation, mapConversation, mapMessage, _simpleRole,
};
