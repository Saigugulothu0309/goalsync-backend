/**
 * escalationController.js
 * Handles escalation rules and simulation for AtomQuest.
 * Feature: Escalation Simulation (Bonus)
 */

const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/escalations/rules — List all escalation rules (Admin)
const listRules = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT er.*, gc.name AS cycle_name
     FROM escalation_rules er
     LEFT JOIN goal_cycles gc ON gc.id = er.cycle_id
     ORDER BY er.created_at DESC`
  );
  res.json(result.rows);
});

// POST /api/escalations/rules — Create escalation rule (Admin)
const createRule = asyncHandler(async (req, res) => {
  const { cycle_id, trigger_event, days_threshold, escalation_level } = req.body;

  if (!['no_submission', 'no_approval', 'no_checkin'].includes(trigger_event)) {
    return res.status(400).json({ error: 'Invalid trigger_event. Must be no_submission, no_approval, or no_checkin.' });
  }
  if (!days_threshold || days_threshold < 1) {
    return res.status(400).json({ error: 'days_threshold must be >= 1.' });
  }
  if (![1, 2, 3].includes(Number(escalation_level))) {
    return res.status(400).json({ error: 'escalation_level must be 1 (employee), 2 (manager), or 3 (HR).' });
  }

  const result = await query(
    `INSERT INTO escalation_rules (cycle_id, trigger_event, days_threshold, escalation_level, is_active, created_by)
     VALUES ($1,$2,$3,$4,TRUE,$5) RETURNING *`,
    [cycle_id || null, trigger_event, days_threshold, escalation_level, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /api/escalations/rules/:id — Update rule (Admin)
const updateRule = asyncHandler(async (req, res) => {
  const { trigger_event, days_threshold, escalation_level, is_active } = req.body;
  const result = await query(
    `UPDATE escalation_rules SET trigger_event=$1, days_threshold=$2, escalation_level=$3, is_active=$4
     WHERE id=$5 RETURNING *`,
    [trigger_event, days_threshold, escalation_level, is_active, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Rule not found.' });
  res.json(result.rows[0]);
});

// DELETE /api/escalations/rules/:id — Delete rule (Admin)
const deleteRule = asyncHandler(async (req, res) => {
  await query('DELETE FROM escalation_rules WHERE id=$1', [req.params.id]);
  res.json({ message: 'Rule deleted.' });
});

// GET /api/escalations/simulate?cycle_id= — Simulate which users would be escalated (Admin)
const simulate = asyncHandler(async (req, res) => {
  const { cycle_id } = req.query;
  if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required.' });

  const now = new Date();

  // Fetch active rules for cycle
  const rulesResult = await query(
    `SELECT * FROM escalation_rules WHERE (cycle_id=$1 OR cycle_id IS NULL) AND is_active=TRUE`,
    [cycle_id]
  );
  const rules = rulesResult.rows;

  const escalations = [];

  for (const rule of rules) {
    if (rule.trigger_event === 'no_submission') {
      // Employees who haven't submitted goals within N days of cycle goal_setting_opens
      const result = await query(
        `SELECT u.id, u.name, u.email, u.department, m.name AS manager_name,
                gc.goal_setting_opens,
                gs.status, gs.submitted_at
         FROM goal_cycles gc
         JOIN users u ON u.role = 'employee' AND u.is_active = TRUE
         LEFT JOIN users m ON m.id = u.manager_id
         LEFT JOIN goal_sheets gs ON gs.employee_id = u.id AND gs.cycle_id = gc.id
         WHERE gc.id = $1
           AND gc.goal_setting_opens IS NOT NULL
           AND (gs.id IS NULL OR gs.status = 'draft')
           AND NOW() > gc.goal_setting_opens + INTERVAL '1 day' * $2`,
        [cycle_id, rule.days_threshold]
      );

      for (const row of result.rows) {
        const daysOverdue = Math.floor(
          (now - new Date(row.goal_setting_opens)) / (1000 * 60 * 60 * 24) - rule.days_threshold
        );
        escalations.push({
          rule_id: rule.id,
          trigger: 'no_submission',
          escalation_level: rule.escalation_level,
          escalation_label: ['', 'Employee notified', 'Manager notified', 'HR/Skip-level notified'][rule.escalation_level],
          employee_id: row.id,
          employee_name: row.name,
          employee_email: row.email,
          department: row.department,
          manager_name: row.manager_name,
          days_overdue: Math.max(0, daysOverdue),
          detail: `Goals not submitted. Cycle opened ${rule.days_threshold}+ days ago.`,
          status: row.status || 'no_sheet',
        });
      }
    }

    if (rule.trigger_event === 'no_approval') {
      // Employees whose goals were submitted but manager hasn't approved in N days
      const result = await query(
        `SELECT u.id, u.name, u.email, u.department, m.name AS manager_name,
                gs.id AS sheet_id, gs.submitted_at, gs.status
         FROM goal_sheets gs
         JOIN users u ON u.id = gs.employee_id
         LEFT JOIN users m ON m.id = u.manager_id
         WHERE gs.cycle_id = $1
           AND gs.status = 'submitted'
           AND NOW() > gs.submitted_at + INTERVAL '1 day' * $2`,
        [cycle_id, rule.days_threshold]
      );

      for (const row of result.rows) {
        const daysOverdue = Math.floor(
          (now - new Date(row.submitted_at)) / (1000 * 60 * 60 * 24) - rule.days_threshold
        );
        escalations.push({
          rule_id: rule.id,
          trigger: 'no_approval',
          escalation_level: rule.escalation_level,
          escalation_label: ['', 'Employee notified', 'Manager notified', 'HR/Skip-level notified'][rule.escalation_level],
          employee_id: row.id,
          employee_name: row.name,
          employee_email: row.email,
          department: row.department,
          manager_name: row.manager_name,
          days_overdue: Math.max(0, daysOverdue),
          detail: `Goals submitted ${Math.floor((now - new Date(row.submitted_at)) / (1000 * 60 * 60 * 24))} days ago, pending manager approval.`,
          status: 'submitted',
          sheet_id: row.sheet_id,
        });
      }
    }

    if (rule.trigger_event === 'no_checkin') {
      // Managers who haven't done check-ins within N days of quarter opening
      const quarters = [
        { q: 'Q1', col: 'q1_opens' },
        { q: 'Q2', col: 'q2_opens' },
        { q: 'Q3', col: 'q3_opens' },
        { q: 'Q4', col: 'q4_opens' },
      ];

      for (const { q, col } of quarters) {
        const result = await query(
          `SELECT m.id AS manager_id, m.name AS manager_name, m.email AS manager_email,
                  u.id AS employee_id, u.name AS employee_name, u.department,
                  gs.id AS sheet_id,
                  gc.${col} AS quarter_opens
           FROM goal_cycles gc
           JOIN goal_sheets gs ON gs.cycle_id = gc.id AND gs.status = 'approved'
           JOIN users u ON u.id = gs.employee_id
           JOIN users m ON m.id = u.manager_id
           LEFT JOIN checkins c ON c.goal_sheet_id = gs.id AND c.manager_id = m.id AND c.quarter = $2
           WHERE gc.id = $1
             AND gc.${col} IS NOT NULL
             AND NOW() > gc.${col} + INTERVAL '1 day' * $3
             AND c.id IS NULL`,
          [cycle_id, q, rule.days_threshold]
        );

        for (const row of result.rows) {
          const daysOverdue = Math.floor(
            (now - new Date(row.quarter_opens)) / (1000 * 60 * 60 * 24) - rule.days_threshold
          );
          escalations.push({
            rule_id: rule.id,
            trigger: 'no_checkin',
            quarter: q,
            escalation_level: rule.escalation_level,
            escalation_label: ['', 'Manager reminded', 'Skip-level notified', 'HR notified'][rule.escalation_level],
            employee_id: row.employee_id,
            employee_name: row.employee_name,
            manager_id: row.manager_id,
            manager_name: row.manager_name,
            manager_email: row.manager_email,
            department: row.department,
            days_overdue: Math.max(0, daysOverdue),
            detail: `${q} check-in not completed. Window opened ${rule.days_threshold}+ days ago.`,
            sheet_id: row.sheet_id,
          });
        }
      }
    }
  }

  res.json({
    cycle_id,
    simulated_at: now.toISOString(),
    rules_applied: rules.length,
    total_escalations: escalations.length,
    escalations,
  });
});

// GET /api/escalations/log — Escalation log (Admin)
const getEscalationLog = asyncHandler(async (req, res) => {
  // For now, pull from audit_logs where action contains 'escalat'
  const result = await query(
    `SELECT al.*, u.name AS changed_by_name
     FROM audit_logs al
     JOIN users u ON u.id = al.changed_by
     WHERE al.action LIKE '%escalat%'
     ORDER BY al.created_at DESC LIMIT 200`
  );
  res.json(result.rows);
});

module.exports = { listRules, createRule, updateRule, deleteRule, simulate, getEscalationLog };
