const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

// POST /api/goal-sheets/:sheetId/checkins — Manager adds/updates check-in comment
const upsertCheckin = asyncHandler(async (req, res) => {
  const { quarter, comment } = req.body;
  const { sheetId } = req.params;

  if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) {
    return res.status(400).json({ error: 'Quarter must be Q1, Q2, Q3, or Q4.' });
  }
  if (!comment || comment.trim().length === 0) {
    return res.status(400).json({ error: 'Check-in comment is required.' });
  }

  // Verify manager has access to this sheet
  const sheetResult = await query(
    `SELECT gs.*, u.manager_id FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id WHERE gs.id=$1`,
    [sheetId]
  );
  const sheet = sheetResult.rows[0];
  if (!sheet) return res.status(404).json({ error: 'Goal sheet not found.' });

  if (sheet.manager_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied — you are not this employee\'s manager.' });
  }
  if (sheet.status !== 'approved') {
    return res.status(400).json({ error: 'Check-ins can only be added to approved goal sheets.' });
  }

  const result = await query(
    `INSERT INTO checkins (goal_sheet_id, manager_id, quarter, comment)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (goal_sheet_id, manager_id, quarter) DO UPDATE
       SET comment=$4, updated_at=NOW()
     RETURNING *`,
    [sheetId, req.user.id, quarter, comment.trim()]
  );

  res.status(201).json(result.rows[0]);
});

// GET /api/goal-sheets/:sheetId/checkins — View all check-ins for a sheet
const listCheckins = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.*, u.name AS manager_name
     FROM checkins c
     JOIN users u ON u.id = c.manager_id
     WHERE c.goal_sheet_id = $1
     ORDER BY c.quarter, c.created_at`,
    [req.params.sheetId]
  );
  res.json(result.rows);
});

// GET /api/manager/pending-checkins — Manager sees which sheets need check-ins this quarter
const pendingCheckins = asyncHandler(async (req, res) => {
  const { quarter } = req.query;
  if (!quarter) return res.status(400).json({ error: 'quarter query param required.' });

  const result = await query(
    `SELECT gs.id AS sheet_id, u.name AS employee_name, u.email, u.department,
            CASE WHEN c.id IS NULL THEN FALSE ELSE TRUE END AS checkin_done
     FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id
     LEFT JOIN checkins c ON c.goal_sheet_id = gs.id AND c.manager_id=$1 AND c.quarter=$2
     WHERE u.manager_id = $1 AND gs.status = 'approved'
     ORDER BY checkin_done, u.name`,
    [req.user.id, quarter]
  );
  res.json(result.rows);
});

module.exports = { upsertCheckin, listCheckins, pendingCheckins };
