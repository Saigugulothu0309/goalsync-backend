/**
 * Computes the progress score (0–1) for a goal based on UoM type.
 * Returns null if insufficient data.
 */
const computeProgressScore = ({ uom_type, target_value, target_date, actual_value, actual_date }) => {
  switch (uom_type) {
    case 'numeric_min': {
      // Higher is better (e.g. Sales Revenue) → Achievement / Target
      if (!target_value || target_value === 0 || actual_value == null) return null;
      return Math.min(actual_value / target_value, 2); // cap at 200%
    }
    case 'numeric_max': {
      // Lower is better (e.g. TAT, Cost) → Target / Achievement
      if (!target_value || actual_value == null || actual_value === 0) return null;
      return Math.min(target_value / actual_value, 2);
    }
    case 'timeline': {
      // Date-based: completed on or before deadline = 100%, else proportional
      if (!target_date || !actual_date) return null;
      const deadline = new Date(target_date);
      const completed = new Date(actual_date);
      if (completed <= deadline) return 1;
      // overdue — return 0 (or you could do partial credit logic)
      return 0;
    }
    case 'zero': {
      // Zero = success (e.g. safety incidents)
      if (actual_value == null) return null;
      return actual_value === 0 ? 1 : 0;
    }
    default:
      return null;
  }
};

/**
 * Validates goal weightage business rules for a list of goals.
 * Returns { valid: bool, errors: [] }
 */
const validateWeightage = (goals) => {
  const errors = [];

  if (goals.length > 8) {
    errors.push(`Maximum 8 goals allowed per employee. Got ${goals.length}.`);
  }

  for (const g of goals) {
    if (g.weightage < 10) {
      errors.push(`Goal "${g.title}" has weightage ${g.weightage}% — minimum is 10%.`);
    }
  }

  const total = goals.reduce((sum, g) => sum + Number(g.weightage), 0);
  if (Math.abs(total - 100) > 0.01) {
    errors.push(`Total weightage must equal 100%. Current total: ${total}%.`);
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Determines which quarter is currently active for check-ins.
 */
const getCurrentQuarter = (cycle) => {
  const now = new Date();
  const toDate = (d) => d ? new Date(d) : null;

  if (toDate(cycle.q4_opens) && now >= toDate(cycle.q4_opens)) return 'Q4';
  if (toDate(cycle.q3_opens) && now >= toDate(cycle.q3_opens)) return 'Q3';
  if (toDate(cycle.q2_opens) && now >= toDate(cycle.q2_opens)) return 'Q2';
  if (toDate(cycle.q1_opens) && now >= toDate(cycle.q1_opens)) return 'Q1';
  return null; // goal setting phase
};

module.exports = { computeProgressScore, validateWeightage, getCurrentQuarter };
