const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/reports/achievements?cycle_id= — Achievement report (CSV-ready)
const achievementReport = asyncHandler(async (req, res) => {
  const { cycle_id, format } = req.query;
  if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required.' });

  const result = await query(
    `SELECT
       u.name AS employee_name, u.email, u.department,
       m.name AS manager_name,
       ta.name AS thrust_area,
       g.title AS goal_title,
       g.uom_type,
       g.target_value, g.target_date,
       g.weightage,
       a_q1.actual_value AS q1_actual, a_q1.status AS q1_status, a_q1.progress_score AS q1_score,
       a_q2.actual_value AS q2_actual, a_q2.status AS q2_status, a_q2.progress_score AS q2_score,
       a_q3.actual_value AS q3_actual, a_q3.status AS q3_status, a_q3.progress_score AS q3_score,
       a_q4.actual_value AS q4_actual, a_q4.status AS q4_status, a_q4.progress_score AS q4_score
     FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id
     LEFT JOIN users m ON m.id = u.manager_id
     JOIN goals g ON g.goal_sheet_id = gs.id
     LEFT JOIN thrust_areas ta ON ta.id = g.thrust_area_id
     LEFT JOIN achievements a_q1 ON a_q1.goal_id = g.id AND a_q1.quarter='Q1'
     LEFT JOIN achievements a_q2 ON a_q2.goal_id = g.id AND a_q2.quarter='Q2'
     LEFT JOIN achievements a_q3 ON a_q3.goal_id = g.id AND a_q3.quarter='Q3'
     LEFT JOIN achievements a_q4 ON a_q4.goal_id = g.id AND a_q4.quarter='Q4'
     WHERE gs.cycle_id = $1
     ORDER BY u.name, g.title`,
    [cycle_id]
  );

  if (format === 'csv') {
    const rows = result.rows;
    if (rows.length === 0) {
      return res.status(200).send('No data found.');
    }
    const headers = Object.keys(rows[0]).join(',');
    const lines = rows.map(r =>
      Object.values(r).map(v => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`)).join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="achievement_report_${cycle_id}.csv"`);
    return res.send([headers, ...lines].join('\n'));
  }

  res.json(result.rows);
});

// GET /api/reports/completion?cycle_id=&quarter= — Completion dashboard
const completionDashboard = asyncHandler(async (req, res) => {
  const { cycle_id, quarter } = req.query;
  if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required.' });

  const employeeCompletion = await query(
    `SELECT
       u.id, u.name, u.email, u.department,
       m.name AS manager_name,
       gs.status AS sheet_status,
       gs.submitted_at, gs.approved_at,
       CASE WHEN $2::text IS NOT NULL THEN
         (SELECT COUNT(*) FROM achievements a
          JOIN goals g ON g.id = a.goal_id
          WHERE g.goal_sheet_id = gs.id AND a.quarter = $2)
       ELSE NULL END AS achievements_logged,
       CASE WHEN $2::text IS NOT NULL THEN
         (SELECT COUNT(*) FROM goals g WHERE g.goal_sheet_id = gs.id)
       ELSE NULL END AS total_goals
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     LEFT JOIN goal_sheets gs ON gs.employee_id = u.id AND gs.cycle_id = $1
     WHERE u.role = 'employee' AND u.is_active = TRUE
     ORDER BY u.name`,
    [cycle_id, quarter || null]
  );

  const managerCheckins = quarter ? await query(
    `SELECT
       m.id, m.name AS manager_name,
       COUNT(DISTINCT gs.id) AS total_reports,
       COUNT(DISTINCT c.goal_sheet_id) AS checkins_done
     FROM users m
     JOIN users u ON u.manager_id = m.id
     JOIN goal_sheets gs ON gs.employee_id = u.id AND gs.cycle_id = $1 AND gs.status = 'approved'
     LEFT JOIN checkins c ON c.goal_sheet_id = gs.id AND c.manager_id = m.id AND c.quarter = $2
     WHERE m.role IN ('manager','admin')
     GROUP BY m.id, m.name
     ORDER BY m.name`,
    [cycle_id, quarter]
  ) : { rows: [] };

  res.json({
    employees: employeeCompletion.rows,
    manager_checkins: managerCheckins.rows,
  });
});

// GET /api/reports/audit?entity_id= — Audit trail (Admin only)
const auditTrail = asyncHandler(async (req, res) => {
  const { entity_id, entity_type, from_date, to_date } = req.query;

  let sql = `
    SELECT al.*, u.name AS changed_by_name, u.email AS changed_by_email
    FROM audit_logs al
    JOIN users u ON u.id = al.changed_by
    WHERE 1=1
  `;
  const params = [];

  if (entity_id) { params.push(entity_id); sql += ` AND al.entity_id = $${params.length}`; }
  if (entity_type) { params.push(entity_type); sql += ` AND al.entity_type = $${params.length}`; }
  if (from_date) { params.push(from_date); sql += ` AND al.created_at >= $${params.length}`; }
  if (to_date) { params.push(to_date); sql += ` AND al.created_at <= $${params.length}`; }

  sql += ' ORDER BY al.created_at DESC LIMIT 500';

  const result = await query(sql, params);
  res.json(result.rows);
});

// GET /api/reports/analytics?cycle_id= — Bonus: analytics summary
const analytics = asyncHandler(async (req, res) => {
  const { cycle_id } = req.query;
  if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required.' });

  const [byDept, byThrust, byUom, managerEffectiveness] = await Promise.all([
    // Achievement by department
    query(
      `SELECT u.department,
              COUNT(DISTINCT gs.employee_id) AS employees,
              AVG(a.progress_score) AS avg_score
       FROM goal_sheets gs
       JOIN users u ON u.id = gs.employee_id
       JOIN goals g ON g.goal_sheet_id = gs.id
       LEFT JOIN achievements a ON a.goal_id = g.id
       WHERE gs.cycle_id=$1 GROUP BY u.department ORDER BY u.department`,
      [cycle_id]
    ),
    // By thrust area
    query(
      `SELECT ta.name AS thrust_area, COUNT(g.id) AS goal_count,
              AVG(a.progress_score) AS avg_score
       FROM goals g
       JOIN goal_sheets gs ON gs.id = g.goal_sheet_id
       LEFT JOIN thrust_areas ta ON ta.id = g.thrust_area_id
       LEFT JOIN achievements a ON a.goal_id = g.id
       WHERE gs.cycle_id=$1 GROUP BY ta.name ORDER BY goal_count DESC`,
      [cycle_id]
    ),
    // By UoM type
    query(
      `SELECT g.uom_type, COUNT(g.id) AS goal_count, AVG(a.progress_score) AS avg_score
       FROM goals g
       JOIN goal_sheets gs ON gs.id = g.goal_sheet_id
       LEFT JOIN achievements a ON a.goal_id = g.id
       WHERE gs.cycle_id=$1 GROUP BY g.uom_type`,
      [cycle_id]
    ),
    // Manager check-in effectiveness (all quarters combined)
    query(
      `SELECT m.name AS manager, m.id,
              COUNT(DISTINCT gs.id) AS total_reports,
              COUNT(DISTINCT c.id) AS checkins_done,
              ROUND(COUNT(DISTINCT c.id)::numeric / NULLIF(COUNT(DISTINCT gs.id),0) * 100, 1) AS completion_pct
       FROM users m
       JOIN users u ON u.manager_id = m.id
       JOIN goal_sheets gs ON gs.employee_id = u.id AND gs.cycle_id=$1 AND gs.status='approved'
       LEFT JOIN checkins c ON c.goal_sheet_id = gs.id AND c.manager_id = m.id
       WHERE m.role IN ('manager','admin')
       GROUP BY m.id, m.name ORDER BY completion_pct DESC`,
      [cycle_id]
    ),
  ]);

  res.json({
    by_department: byDept.rows,
    by_thrust_area: byThrust.rows,
    by_uom_type: byUom.rows,
    manager_effectiveness: managerEffectiveness.rows,
  });
});

module.exports = { achievementReport, completionDashboard, auditTrail, analytics };
