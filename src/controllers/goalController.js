const { query, withTransaction } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditLog } = require('../utils/auditLog');

// POST /api/goal-sheets/:sheetId/goals — Employee adds a goal
const addGoal = asyncHandler(async (req, res) => {
  const { sheetId } = req.params;
  const { thrust_area_id, title, description, uom_type, target_value, target_date, weightage } = req.body;

  const sheet = await query(
    'SELECT * FROM goal_sheets WHERE id=$1 AND employee_id=$2',
    [sheetId, req.user.id]
  );
  if (!sheet.rows[0]) return res.status(404).json({ error: 'Goal sheet not found.' });
  if (sheet.rows[0].status === 'approved') {
    return res.status(400).json({ error: 'Cannot edit an approved goal sheet.' });
  }

  // Max 8 goals check
  const count = await query('SELECT COUNT(*) FROM goals WHERE goal_sheet_id=$1', [sheetId]);
  if (parseInt(count.rows[0].count) >= 8) {
    return res.status(400).json({ error: 'Maximum of 8 goals allowed per employee.' });
  }

  // Min 10% weightage check
  if (weightage < 10) {
    return res.status(400).json({ error: 'Minimum weightage per goal is 10%.' });
  }

  const result = await query(
    `INSERT INTO goals (goal_sheet_id, thrust_area_id, title, description, uom_type, target_value, target_date, weightage, primary_owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [sheetId, thrust_area_id, title, description, uom_type, target_value || null, target_date || null, weightage, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /api/goals/:id — Employee edits own unlocked goal; Manager edits during approval
const updateGoal = asyncHandler(async (req, res) => {
  const goalResult = await query(
    `SELECT g.*, gs.employee_id, gs.status AS sheet_status, u.manager_id
     FROM goals g
     JOIN goal_sheets gs ON gs.id = g.goal_sheet_id
     JOIN users u ON u.id = gs.employee_id
     WHERE g.id = $1`,
    [req.params.id]
  );

  const goal = goalResult.rows[0];
  if (!goal) return res.status(404).json({ error: 'Goal not found.' });

  const isOwner = goal.employee_id === req.user.id;
  const isManager = req.user.role === 'manager' && goal.manager_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isManager && !isAdmin) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  if (goal.is_locked && !isAdmin) {
    return res.status(400).json({ error: 'Goal is locked after approval. Contact Admin to unlock.' });
  }

  // Shared goals: recipient can only change weightage
  if (goal.is_shared && !isAdmin) {
    const { weightage } = req.body;
    if (weightage < 10) return res.status(400).json({ error: 'Minimum weightage is 10%.' });
    const result = await query(
      'UPDATE goals SET weightage=$1 WHERE id=$2 RETURNING *',
      [weightage, req.params.id]
    );
    return res.json(result.rows[0]);
  }

  const { thrust_area_id, title, description, uom_type, target_value, target_date, weightage } = req.body;

  if (weightage < 10) return res.status(400).json({ error: 'Minimum weightage is 10%.' });

  const old = goal;
  const result = await query(
    `UPDATE goals SET thrust_area_id=$1, title=$2, description=$3, uom_type=$4,
     target_value=$5, target_date=$6, weightage=$7
     WHERE id=$8 RETURNING *`,
    [thrust_area_id, title, description, uom_type, target_value || null, target_date || null, weightage, req.params.id]
  );

  if (goal.is_locked) {
    await auditLog({
      entity_type: 'goal', entity_id: req.params.id,
      action: 'updated_after_lock', changed_by: req.user.id,
      old_value: old, new_value: result.rows[0],
    });
  }

  res.json(result.rows[0]);
});

// DELETE /api/goals/:id — Employee deletes own unlocked goal
const deleteGoal = asyncHandler(async (req, res) => {
  const goalResult = await query(
    `SELECT g.*, gs.employee_id FROM goals g
     JOIN goal_sheets gs ON gs.id = g.goal_sheet_id
     WHERE g.id = $1`,
    [req.params.id]
  );
  const goal = goalResult.rows[0];
  if (!goal) return res.status(404).json({ error: 'Goal not found.' });
  if (goal.employee_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }
  if (goal.is_locked) {
    return res.status(400).json({ error: 'Cannot delete a locked goal.' });
  }
  await query('DELETE FROM goals WHERE id=$1', [req.params.id]);
  res.json({ message: 'Goal deleted.' });
});

// POST /api/goals/share — Admin or Manager pushes shared goal to multiple employees
const shareGoal = asyncHandler(async (req, res) => {
  const { title, description, thrust_area_id, uom_type, target_value, target_date, cycle_id, recipient_ids } = req.body;

  if (!recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
    return res.status(400).json({ error: 'recipient_ids must be a non-empty array.' });
  }

  return withTransaction(async (client) => {
    const results = [];

    for (const recipientId of recipient_ids) {
      // Get or create goal sheet for recipient
      let sheetResult = await client.query(
        'SELECT id FROM goal_sheets WHERE employee_id=$1 AND cycle_id=$2',
        [recipientId, cycle_id]
      );
      let sheetId;
      if (sheetResult.rows.length === 0) {
        const newSheet = await client.query(
          `INSERT INTO goal_sheets (employee_id, cycle_id, status) VALUES ($1,$2,'draft') RETURNING id`,
          [recipientId, cycle_id]
        );
        sheetId = newSheet.rows[0].id;
      } else {
        sheetId = sheetResult.rows[0].id;
      }

      // Check max 8 goals
      const count = await client.query('SELECT COUNT(*) FROM goals WHERE goal_sheet_id=$1', [sheetId]);
      if (parseInt(count.rows[0].count) >= 8) {
        results.push({ recipient_id: recipientId, error: 'Max goals reached for this employee.' });
        continue;
      }

      // Insert shared goal (default weightage 10, recipient can adjust)
      const goal = await client.query(
        `INSERT INTO goals (goal_sheet_id, thrust_area_id, title, description, uom_type, target_value, target_date,
          weightage, is_shared, primary_owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,10,TRUE,$8) RETURNING id`,
        [sheetId, thrust_area_id, title, description, uom_type, target_value || null, target_date || null, req.user.id]
      );
      results.push({ recipient_id: recipientId, goal_id: goal.rows[0].id, success: true });
    }

    return res.status(201).json({ shared: results });
  });
});

module.exports = { addGoal, updateGoal, deleteGoal, shareGoal };
