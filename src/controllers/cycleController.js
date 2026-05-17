const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

// ── GOAL CYCLES ──────────────────────────────────────────────

// GET /api/cycles
const listCycles = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM goal_cycles ORDER BY start_date DESC');
  res.json(result.rows);
});

// GET /api/cycles/active
const getActiveCycle = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM goal_cycles WHERE is_active = TRUE LIMIT 1');
  if (!result.rows[0]) return res.status(404).json({ error: 'No active cycle found.' });
  res.json(result.rows[0]);
});

// POST /api/cycles — Admin only
const createCycle = asyncHandler(async (req, res) => {
  const { name, start_date, end_date, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens } = req.body;
  const result = await query(
    `INSERT INTO goal_cycles (name, start_date, end_date, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [name, start_date, end_date, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /api/cycles/:id — Admin only
const updateCycle = asyncHandler(async (req, res) => {
  const { name, start_date, end_date, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens } = req.body;
  const result = await query(
    `UPDATE goal_cycles SET name=$1, start_date=$2, end_date=$3, goal_setting_opens=$4,
     q1_opens=$5, q2_opens=$6, q3_opens=$7, q4_opens=$8 WHERE id=$9 RETURNING *`,
    [name, start_date, end_date, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Cycle not found.' });
  res.json(result.rows[0]);
});

// POST /api/cycles/:id/activate — Admin only (deactivates all others)
const activateCycle = asyncHandler(async (req, res) => {
  await query('UPDATE goal_cycles SET is_active = FALSE');
  const result = await query(
    'UPDATE goal_cycles SET is_active = TRUE WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Cycle not found.' });
  res.json(result.rows[0]);
});

// ── THRUST AREAS ─────────────────────────────────────────────

// GET /api/thrust-areas
const listThrustAreas = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM thrust_areas WHERE is_active = TRUE ORDER BY name'
  );
  res.json(result.rows);
});

// POST /api/thrust-areas — Admin only
const createThrustArea = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const result = await query(
    'INSERT INTO thrust_areas (name, description, created_by) VALUES ($1,$2,$3) RETURNING *',
    [name, description, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /api/thrust-areas/:id — Admin only
const updateThrustArea = asyncHandler(async (req, res) => {
  const { name, description, is_active } = req.body;
  const result = await query(
    'UPDATE thrust_areas SET name=$1, description=$2, is_active=$3 WHERE id=$4 RETURNING *',
    [name, description, is_active, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Thrust area not found.' });
  res.json(result.rows[0]);
});

module.exports = {
  listCycles, getActiveCycle, createCycle, updateCycle, activateCycle,
  listThrustAreas, createThrustArea, updateThrustArea,
};
