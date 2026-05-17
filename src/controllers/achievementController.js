const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { computeProgressScore, getCurrentQuarter } = require('../utils/goalUtils');
const { auditLog } = require('../utils/auditLog');

// PUT /api/goals/:goalId/achievements/:quarter — Employee logs achievement
const upsertAchievement = asyncHandler(async (req, res) => {
  const { goalId, quarter } = req.params;
  const { actual_value, actual_date, status } = req.body;

  if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) {
    return res.status(400).json({ error: 'Quarter must be Q1, Q2, Q3, or Q4.' });
  }

  // Fetch goal + sheet info
  const goalResult = await query(
    `SELECT g.*, gs.employee_id, gs.cycle_id,
            gc.q1_opens, gc.q2_opens, gc.q3_opens, gc.q4_opens,
            gs.status AS sheet_status
     FROM goals g
     JOIN goal_sheets gs ON gs.id = g.goal_sheet_id
     JOIN goal_cycles gc ON gc.id = gs.cycle_id
     WHERE g.id = $1`,
    [goalId]
  );

  const goal = goalResult.rows[0];
  if (!goal) return res.status(404).json({ error: 'Goal not found.' });

  // Access: only the employee who owns the goal sheet
  if (goal.employee_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  if (goal.sheet_status !== 'approved') {
    return res.status(400).json({ error: 'Goal sheet must be approved before logging achievements.' });
  }

  // Check if the quarter window is open
  const currentQ = getCurrentQuarter(goal);
  if (currentQ === null) {
    return res.status(400).json({ error: 'Check-in window is not open yet.' });
  }
  const qOrder = ['Q1', 'Q2', 'Q3', 'Q4'];
  if (qOrder.indexOf(quarter) > qOrder.indexOf(currentQ)) {
    return res.status(400).json({ error: `Quarter ${quarter} window is not open yet.` });
  }

  // Compute progress score
  const progress_score = computeProgressScore({
    uom_type: goal.uom_type,
    target_value: goal.target_value,
    target_date: goal.target_date,
    actual_value,
    actual_date,
  });

  // Upsert
  const result = await query(
    `INSERT INTO achievements (goal_id, quarter, actual_value, actual_date, status, progress_score, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (goal_id, quarter) DO UPDATE
       SET actual_value=$3, actual_date=$4, status=$5, progress_score=$6,
           updated_by=$7, updated_at=NOW()
     RETURNING *`,
    [goalId, quarter, actual_value ?? null, actual_date ?? null, status, progress_score, req.user.id]
  );

  // If this is a shared goal, sync the achievement to all recipient goals
  if (goal.primary_owner_id === req.user.id && goal.is_shared) {
    const recipients = await query(
      'SELECT recipient_goal_id FROM shared_goal_recipients WHERE source_goal_id=$1',
      [goalId]
    );
    for (const r of recipients.rows) {
      await query(
        `INSERT INTO achievements (goal_id, quarter, actual_value, actual_date, status, progress_score, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (goal_id, quarter) DO UPDATE
           SET actual_value=$3, actual_date=$4, status=$5, progress_score=$6, updated_by=$7, updated_at=NOW()`,
        [r.recipient_goal_id, quarter, actual_value ?? null, actual_date ?? null, status, progress_score, req.user.id]
      );
    }
  }

  await auditLog({
    entity_type: 'achievement', entity_id: result.rows[0].id,
    action: 'upserted', changed_by: req.user.id,
    new_value: result.rows[0],
  });

  res.json(result.rows[0]);
});

// GET /api/goals/:goalId/achievements — All quarters for a goal
const getAchievements = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT a.*, u.name AS updated_by_name
     FROM achievements a
     LEFT JOIN users u ON u.id = a.updated_by
     WHERE a.goal_id = $1 ORDER BY a.quarter`,
    [req.params.goalId]
  );
  res.json(result.rows);
});

module.exports = { upsertAchievement, getAchievements };
