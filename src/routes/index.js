/**
 * routes/index.js — UPDATED with missing feature routes
 * Add these routes to your existing routes/index.js
 * 
 * NEW ROUTES ADDED:
 *   - Escalation rules & simulation
 *   - Risk Radar
 *   - Quarterly Window Validator (utility endpoint)
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');

// Controllers (existing)
const auth = require('../controllers/authController');
const users = require('../controllers/userController');
const cycles = require('../controllers/cycleController');
const sheets = require('../controllers/goalSheetController');
const goals = require('../controllers/goalController');
const achievements = require('../controllers/achievementController');
const checkins = require('../controllers/checkinController');
const reports = require('../controllers/reportController');

// Controllers (NEW - missing features)
const escalations = require('../controllers/escalationController');
const risk = require('../controllers/riskController');

// ── AUTH ──────────────────────────────────────────────────────
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.get('/auth/me', authenticate, auth.me);

// ── USERS ─────────────────────────────────────────────────────
router.get('/users', authenticate, authorize('admin', 'manager'), users.listUsers);
router.get('/users/managers', authenticate, users.listManagers);
router.get('/users/:id', authenticate, users.getUser);
router.put('/users/:id', authenticate, authorize('admin'), users.updateUser);
router.post('/users/:id/reset-password', authenticate, authorize('admin'), users.resetPassword);

// ── CYCLES ────────────────────────────────────────────────────
router.get('/cycles', authenticate, cycles.listCycles);
router.get('/cycles/active', authenticate, cycles.getActiveCycle);
router.post('/cycles', authenticate, authorize('admin'), cycles.createCycle);
router.put('/cycles/:id', authenticate, authorize('admin'), cycles.updateCycle);
router.post('/cycles/:id/activate', authenticate, authorize('admin'), cycles.activateCycle);

// ── QUARTERLY WINDOW VALIDATOR (NEW) ─────────────────────────
// GET /api/cycles/:id/window-status — Returns current open window for a cycle
router.get('/cycles/:id/window-status', authenticate, async (req, res) => {
  const { query } = require('../config/db');
  const { asyncHandler } = require('../middleware/errorHandler');
  const { getCurrentQuarter } = require('../utils/goalUtils');

  try {
    const cycleResult = await query('SELECT * FROM goal_cycles WHERE id=$1', [req.params.id]);
    const cycle = cycleResult.rows[0];
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });

    const now = new Date();
    const toDate = (d) => d ? new Date(d) : null;

    const windows = {
      goal_setting: {
        label: 'Goal Setting (Phase 1)',
        opens: cycle.goal_setting_opens,
        is_open: toDate(cycle.goal_setting_opens) && now >= toDate(cycle.goal_setting_opens) &&
                 (!toDate(cycle.q1_opens) || now < toDate(cycle.q1_opens)),
      },
      Q1: {
        label: 'Q1 Check-in',
        opens: cycle.q1_opens,
        is_open: toDate(cycle.q1_opens) && now >= toDate(cycle.q1_opens) &&
                 (!toDate(cycle.q2_opens) || now < toDate(cycle.q2_opens)),
      },
      Q2: {
        label: 'Q2 Check-in',
        opens: cycle.q2_opens,
        is_open: toDate(cycle.q2_opens) && now >= toDate(cycle.q2_opens) &&
                 (!toDate(cycle.q3_opens) || now < toDate(cycle.q3_opens)),
      },
      Q3: {
        label: 'Q3 Check-in',
        opens: cycle.q3_opens,
        is_open: toDate(cycle.q3_opens) && now >= toDate(cycle.q3_opens) &&
                 (!toDate(cycle.q4_opens) || now < toDate(cycle.q4_opens)),
      },
      Q4: {
        label: 'Q4 / Annual Check-in',
        opens: cycle.q4_opens,
        is_open: toDate(cycle.q4_opens) && now >= toDate(cycle.q4_opens),
      },
    };

    const currentWindow = Object.entries(windows).find(([, v]) => v.is_open)?.[0] || null;
    const currentQuarter = getCurrentQuarter(cycle);

    res.json({
      cycle_id: cycle.id,
      cycle_name: cycle.name,
      current_date: now.toISOString(),
      current_window: currentWindow,
      current_quarter: currentQuarter,
      windows,
      is_active: cycle.is_active,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── THRUST AREAS ──────────────────────────────────────────────
router.get('/thrust-areas', authenticate, cycles.listThrustAreas);
router.post('/thrust-areas', authenticate, authorize('admin'), cycles.createThrustArea);
router.put('/thrust-areas/:id', authenticate, authorize('admin'), cycles.updateThrustArea);

// ── GOAL SHEETS ───────────────────────────────────────────────
router.get('/goal-sheets', authenticate, sheets.listGoalSheets);
router.post('/goal-sheets', authenticate, authorize('employee'), sheets.createGoalSheet);
router.get('/goal-sheets/:id', authenticate, sheets.getGoalSheet);
router.post('/goal-sheets/:id/submit', authenticate, authorize('employee'), sheets.submitGoalSheet);
router.post('/goal-sheets/:id/approve', authenticate, authorize('manager', 'admin'), sheets.approveGoalSheet);
router.post('/goal-sheets/:id/return', authenticate, authorize('manager', 'admin'), sheets.returnGoalSheet);
router.post('/goal-sheets/:id/unlock', authenticate, authorize('admin'), sheets.unlockGoalSheet);   // Goal Lock/Unlock

// ── GOALS ─────────────────────────────────────────────────────
router.post('/goal-sheets/:sheetId/goals', authenticate, authorize('employee'), goals.addGoal);
router.put('/goals/:id', authenticate, goals.updateGoal);
router.delete('/goals/:id', authenticate, goals.deleteGoal);
router.post('/goals/share', authenticate, authorize('admin', 'manager'), goals.shareGoal);           // Shared Goals

// ── ACHIEVEMENTS ──────────────────────────────────────────────
router.get('/goals/:goalId/achievements', authenticate, achievements.getAchievements);
router.put('/goals/:goalId/achievements/:quarter', authenticate, authorize('employee', 'admin'), achievements.upsertAchievement);

// ── CHECK-INS ─────────────────────────────────────────────────
router.get('/goal-sheets/:sheetId/checkins', authenticate, checkins.listCheckins);
router.post('/goal-sheets/:sheetId/checkins', authenticate, authorize('manager', 'admin'), checkins.upsertCheckin);
router.get('/manager/pending-checkins', authenticate, authorize('manager', 'admin'), checkins.pendingCheckins);

// ── REPORTS ───────────────────────────────────────────────────
router.get('/reports/achievements', authenticate, authorize('admin', 'manager'), reports.achievementReport);
router.get('/reports/completion', authenticate, authorize('admin', 'manager'), reports.completionDashboard);   // Completion Dashboard
router.get('/reports/audit', authenticate, authorize('admin'), reports.auditTrail);                            // Audit Timeline
router.get('/reports/analytics', authenticate, authorize('admin', 'manager'), reports.analytics);              // Analytics

// ── ESCALATION (NEW — Bonus Feature) ─────────────────────────
router.get('/escalations/rules', authenticate, authorize('admin'), escalations.listRules);
router.post('/escalations/rules', authenticate, authorize('admin'), escalations.createRule);
router.put('/escalations/rules/:id', authenticate, authorize('admin'), escalations.updateRule);
router.delete('/escalations/rules/:id', authenticate, authorize('admin'), escalations.deleteRule);
router.get('/escalations/simulate', authenticate, authorize('admin'), escalations.simulate);         // Escalation Simulation
router.get('/escalations/log', authenticate, authorize('admin'), escalations.getEscalationLog);

// ── RISK RADAR (NEW — Bonus Feature) ─────────────────────────
router.get('/risk/radar', authenticate, authorize('admin', 'manager'), risk.riskRadar);              // Risk Radar

module.exports = router;
