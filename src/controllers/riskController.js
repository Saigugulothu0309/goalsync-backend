/**
 * riskController.js
 * Risk Radar — identifies employees and goals at risk of missing targets.
 * Feature: Risk Radar (Bonus)
 */

const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/risk/radar?cycle_id=&quarter= — Risk analysis for a cycle
const riskRadar = asyncHandler(async (req, res) => {
  const { cycle_id, quarter } = req.query;
  if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required.' });

  const activeQuarter = quarter || 'Q1';

  // 1. Goals with low progress scores (below 0.5 = 50%)
  const lowProgress = await query(
    `SELECT
       u.id AS employee_id, u.name AS employee_name, u.email, u.department,
       m.name AS manager_name,
       g.id AS goal_id, g.title AS goal_title, g.uom_type, g.weightage,
       ta.name AS thrust_area,
       a.quarter, a.actual_value, a.status AS achievement_status,
       a.progress_score,
       CASE
         WHEN a.progress_score < 0.25 THEN 'critical'
         WHEN a.progress_score < 0.5 THEN 'at_risk'
         WHEN a.progress_score < 0.75 THEN 'needs_attention'
         ELSE 'on_track'
       END AS risk_level
     FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id
     LEFT JOIN users m ON m.id = u.manager_id
     JOIN goals g ON g.goal_sheet_id = gs.id
     LEFT JOIN thrust_areas ta ON ta.id = g.thrust_area_id
     LEFT JOIN achievements a ON a.goal_id = g.id AND a.quarter = $2
     WHERE gs.cycle_id = $1
       AND gs.status = 'approved'
       AND (a.progress_score IS NOT NULL AND a.progress_score < 0.75
            OR a.status = 'not_started')
     ORDER BY a.progress_score ASC NULLS FIRST, u.name`,
    [cycle_id, activeQuarter]
  );

  // 2. Employees with no achievements logged this quarter (not started)
  const noActivity = await query(
    `SELECT
       u.id, u.name, u.email, u.department,
       m.name AS manager_name,
       COUNT(g.id) AS total_goals,
       SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) AS goals_updated,
       COUNT(g.id) - SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) AS goals_not_updated
     FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id
     LEFT JOIN users m ON m.id = u.manager_id
     JOIN goals g ON g.goal_sheet_id = gs.id
     LEFT JOIN achievements a ON a.goal_id = g.id AND a.quarter = $2
     WHERE gs.cycle_id = $1 AND gs.status = 'approved'
     GROUP BY u.id, u.name, u.email, u.department, m.name
     HAVING SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) = 0
     ORDER BY u.name`,
    [cycle_id, activeQuarter]
  );

  // 3. High-weightage goals at risk (weightage >= 25 and low progress)
  const highWeightAtRisk = await query(
    `SELECT
       u.name AS employee_name, u.department,
       g.title, g.weightage, g.uom_type,
       ta.name AS thrust_area,
       a.progress_score, a.status AS achievement_status
     FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id
     JOIN goals g ON g.goal_sheet_id = gs.id
     LEFT JOIN thrust_areas ta ON ta.id = g.thrust_area_id
     LEFT JOIN achievements a ON a.goal_id = g.id AND a.quarter = $2
     WHERE gs.cycle_id = $1
       AND gs.status = 'approved'
       AND g.weightage >= 25
       AND (a.progress_score IS NULL OR a.progress_score < 0.5)
     ORDER BY g.weightage DESC, a.progress_score ASC`,
    [cycle_id, activeQuarter]
  );

  // 4. Department risk summary
  const deptRisk = await query(
    `SELECT
       u.department,
       COUNT(DISTINCT gs.employee_id) AS employees,
       COUNT(g.id) AS total_goals,
       ROUND(AVG(a.progress_score) * 100, 1) AS avg_progress_pct,
       SUM(CASE WHEN a.progress_score < 0.5 THEN 1 ELSE 0 END) AS at_risk_goals,
       SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END) AS not_started_goals
     FROM goal_sheets gs
     JOIN users u ON u.id = gs.employee_id
     JOIN goals g ON g.goal_sheet_id = gs.id
     LEFT JOIN achievements a ON a.goal_id = g.id AND a.quarter = $2
     WHERE gs.cycle_id = $1 AND gs.status = 'approved'
     GROUP BY u.department
     ORDER BY avg_progress_pct ASC NULLS FIRST`,
    [cycle_id, activeQuarter]
  );

  res.json({
    cycle_id,
    quarter: activeQuarter,
    summary: {
      low_progress_goals: lowProgress.rows.length,
      employees_with_no_activity: noActivity.rows.length,
      high_weight_at_risk: highWeightAtRisk.rows.length,
    },
    low_progress_goals: lowProgress.rows,
    no_activity_employees: noActivity.rows,
    high_weightage_at_risk: highWeightAtRisk.rows,
    department_risk: deptRisk.rows,
  });
});

module.exports = { riskRadar };
