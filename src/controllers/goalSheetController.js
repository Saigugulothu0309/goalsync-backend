const { query, withTransaction } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditLog } = require('../utils/auditLog');

// GET /api/goal-sheets — Employee: own sheet; Manager: team sheets; Admin: all
const listGoalSheets = asyncHandler(async (req, res) => {
  const { cycle_id } = req.query;
  let sql, params;

  if (req.user.role === 'employee') {
    sql = `
      SELECT gs.*, gc.name AS cycle_name,
             u.name AS employee_name, u.department
      FROM goal_sheets gs
      JOIN goal_cycles gc ON gc.id = gs.cycle_id
      JOIN users u ON u.id = gs.employee_id
      WHERE gs.employee_id = $1
      ${cycle_id ? 'AND gs.cycle_id = $2' : ''}
      ORDER BY gs.created_at DESC`;
    params = cycle_id ? [req.user.id, cycle_id] : [req.user.id];
  } else if (req.user.role === 'manager') {
    sql = `
      SELECT gs.*, gc.name AS cycle_name,
             u.name AS employee_name, u.department
      FROM goal_sheets gs
      JOIN goal_cycles gc ON gc.id = gs.cycle_id
      JOIN users u ON u.id = gs.employee_id
      WHERE u.manager_id = $1
      ${cycle_id ? 'AND gs.cycle_id = $2' : ''}
      ORDER BY u.name, gs.created_at DESC`;
    params = cycle_id ? [req.user.id, cycle_id] : [req.user.id];
  } else {
    sql = `
      SELECT gs.*, gc.name AS cycle_name,
             u.name AS employee_name, u.department,
             m.name AS manager_name
      FROM goal_sheets gs
      JOIN goal_cycles gc ON gc.id = gs.cycle_id
      JOIN users u ON u.id = gs.employee_id
      LEFT JOIN users m ON m.id = u.manager_id
      ${cycle_id ? 'WHERE gs.cycle_id = $1' : ''}
      ORDER BY u.name, gs.created_at DESC`;
    params = cycle_id ? [cycle_id] : [];
  }

  const result = await query(sql, params);
  res.json(result.rows);
});

// GET /api/goal-sheets/:id — with all goals
const getGoalSheet = asyncHandler(async (req, res) => {
  const sheetResult = await query(
    `SELECT gs.*, gc.name AS cycle_name, gc.q1_opens, gc.q2_opens, gc.q3_opens, gc.q4_opens,
            u.name AS employee_name, u.email AS employee_email, u.department,
            m.name AS manager_name, m.email AS manager_email
     FROM goal_sheets gs
     JOIN goal_cycles gc ON gc.id = gs.cycle_id
     JOIN users u ON u.id = gs.employee_id
     LEFT JOIN users m ON m.id = u.manager_id
     WHERE gs.id = $1`,
    [req.params.id]
  );

  const sheet = sheetResult.rows[0];
  if (!sheet) return res.status(404).json({ error: 'Goal sheet not found.' });

  // Access control
  if (req.user.role === 'employee' && sheet.employee_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const goalsResult = await query(
    `SELECT g.*, ta.name AS thrust_area_name,
            a_q1.actual_value AS q1_actual, a_q1.actual_date AS q1_actual_date,
            a_q1.status AS q1_status, a_q1.progress_score AS q1_score,
            a_q2.actual_value AS q2_actual, a_q2.actual_date AS q2_actual_date,
            a_q2.status AS q2_status, a_q2.progress_score AS q2_score,
            a_q3.actual_value AS q3_actual, a_q3.actual_date AS q3_actual_date,
            a_q3.status AS q3_status, a_q3.progress_score AS q3_score,
            a_q4.actual_value AS q4_actual, a_q4.actual_date AS q4_actual_date,
            a_q4.status AS q4_status, a_q4.progress_score AS q4_score
     FROM goals g
     LEFT JOIN thrust_areas ta ON ta.id = g.thrust_area_id
     LEFT JOIN achievements a_q1 ON a_q1.goal_id = g.id AND a_q1.quarter = 'Q1'
     LEFT JOIN achievements a_q2 ON a_q2.goal_id = g.id AND a_q2.quarter = 'Q2'
     LEFT JOIN achievements a_q3 ON a_q3.goal_id = g.id AND a_q3.quarter = 'Q3'
     LEFT JOIN achievements a_q4 ON a_q4.goal_id = g.id AND a_q4.quarter = 'Q4'
     WHERE g.goal_sheet_id = $1
     ORDER BY g.created_at`,
    [req.params.id]
  );

  res.json({ ...sheet, goals: goalsResult.rows });
});

// POST /api/goal-sheets — Employee creates sheet for active cycle
const createGoalSheet = asyncHandler(async (req, res) => {
  const { cycle_id } = req.body;

  const existing = await query(
    'SELECT id FROM goal_sheets WHERE employee_id=$1 AND cycle_id=$2',
    [req.user.id, cycle_id]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Goal sheet already exists for this cycle.' });
  }

  const result = await query(
    `INSERT INTO goal_sheets (employee_id, cycle_id, status)
     VALUES ($1, $2, 'draft') RETURNING *`,
    [req.user.id, cycle_id]
  );
  res.status(201).json(result.rows[0]);
});

// POST /api/goal-sheets/:id/submit — Employee submits for approval
const submitGoalSheet = asyncHandler(async (req, res) => {
  const sheet = await query(
    'SELECT * FROM goal_sheets WHERE id=$1 AND employee_id=$2',
    [req.params.id, req.user.id]
  );

  if (!sheet.rows[0]) return res.status(404).json({ error: 'Goal sheet not found.' });
  if (!['draft', 'returned'].includes(sheet.rows[0].status)) {
    return res.status(400).json({ error: `Cannot submit a sheet with status "${sheet.rows[0].status}".` });
  }

  // Validate goals exist and weightage rules
  const goals = await query(
    'SELECT * FROM goals WHERE goal_sheet_id=$1',
    [req.params.id]
  );

  if (goals.rows.length === 0) {
    return res.status(400).json({ error: 'Cannot submit a goal sheet with no goals.' });
  }
  if (goals.rows.length > 8) {
    return res.status(400).json({ error: 'Maximum 8 goals allowed.' });
  }
  for (const g of goals.rows) {
    if (g.weightage < 10) {
      return res.status(400).json({ error: `Goal "${g.title}" has weightage below minimum 10%.` });
    }
  }
  const total = goals.rows.reduce((s, g) => s + Number(g.weightage), 0);
  if (Math.abs(total - 100) > 0.01) {
    return res.status(400).json({ error: `Total weightage must be 100%. Current: ${total}%.` });
  }

  const result = await query(
    `UPDATE goal_sheets SET status='submitted', submitted_at=NOW(), total_weightage=$1
     WHERE id=$2 RETURNING *`,
    [total, req.params.id]
  );

  await auditLog({
    entity_type: 'goal_sheet', entity_id: req.params.id,
    action: 'submitted', changed_by: req.user.id,
    new_value: { status: 'submitted' },
  });

  res.json(result.rows[0]);
});

// POST /api/goal-sheets/:id/approve — Manager approves
const approveGoalSheet = asyncHandler(async (req, res) => {
  return withTransaction(async (client) => {
    const sheet = await client.query(
      `SELECT gs.*, u.manager_id FROM goal_sheets gs
       JOIN users u ON u.id = gs.employee_id
       WHERE gs.id = $1`,
      [req.params.id]
    );

    if (!sheet.rows[0]) throw Object.assign(new Error('Goal sheet not found.'), { status: 404 });
    if (sheet.rows[0].manager_id !== req.user.id && req.user.role !== 'admin') {
      throw Object.assign(new Error('You are not this employee\'s manager.'), { status: 403 });
    }
    if (sheet.rows[0].status !== 'submitted') {
      throw Object.assign(new Error(`Sheet is "${sheet.rows[0].status}" — can only approve submitted sheets.`), { status: 400 });
    }

    // Lock all goals
    await client.query('UPDATE goals SET is_locked=TRUE WHERE goal_sheet_id=$1', [req.params.id]);

    const result = await client.query(
      `UPDATE goal_sheets SET status='approved', approved_at=NOW(), approved_by=$1
       WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );

    await auditLog({
      entity_type: 'goal_sheet', entity_id: req.params.id,
      action: 'approved', changed_by: req.user.id,
      new_value: { status: 'approved', approved_by: req.user.id },
      client,
    });

    return res.json(result.rows[0]);
  });
});

// POST /api/goal-sheets/:id/return — Manager returns for rework
const returnGoalSheet = asyncHandler(async (req, res) => {
  const { return_reason } = req.body;
  if (!return_reason) return res.status(400).json({ error: 'Return reason is required.' });

  const sheet = await query(
    `SELECT gs.*, u.manager_id FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id WHERE gs.id=$1`,
    [req.params.id]
  );
  if (!sheet.rows[0]) return res.status(404).json({ error: 'Goal sheet not found.' });
  if (sheet.rows[0].manager_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const result = await query(
    `UPDATE goal_sheets SET status='returned', return_reason=$1 WHERE id=$2 RETURNING *`,
    [return_reason, req.params.id]
  );

  await auditLog({
    entity_type: 'goal_sheet', entity_id: req.params.id,
    action: 'returned', changed_by: req.user.id,
    new_value: { status: 'returned', return_reason },
  });

  res.json(result.rows[0]);
});

// POST /api/goal-sheets/:id/unlock — Admin only
const unlockGoalSheet = asyncHandler(async (req, res) => {
  await query('UPDATE goals SET is_locked=FALSE WHERE goal_sheet_id=$1', [req.params.id]);
  const result = await query(
    `UPDATE goal_sheets SET status='draft' WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Goal sheet not found.' });

  await auditLog({
    entity_type: 'goal_sheet', entity_id: req.params.id,
    action: 'unlocked_by_admin', changed_by: req.user.id,
    notes: req.body.reason || 'Admin unlock',
  });

  res.json(result.rows[0]);
});

module.exports = {
  listGoalSheets, getGoalSheet, createGoalSheet,
  submitGoalSheet, approveGoalSheet, returnGoalSheet, unlockGoalSheet,
};
