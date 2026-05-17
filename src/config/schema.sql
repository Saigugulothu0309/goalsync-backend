-- ============================================================
-- AtomQuest Goal Setting & Tracking Portal — DB Schema
-- ============================================================

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  department VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- THRUST AREAS (configurable by Admin)
CREATE TABLE IF NOT EXISTS thrust_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GOAL CYCLES (configured by Admin)
CREATE TABLE IF NOT EXISTS goal_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,            -- e.g. "FY 2025-26"
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  goal_setting_opens DATE NOT NULL,      -- Phase 1 window open
  q1_opens DATE,
  q2_opens DATE,
  q3_opens DATE,
  q4_opens DATE,
  is_active BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GOAL SHEETS (one per employee per cycle)
CREATE TABLE IF NOT EXISTS goal_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL REFERENCES goal_cycles(id),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'returned', 'approved')),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  return_reason TEXT,
  total_weightage NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, cycle_id)
);

-- GOALS (up to 8 per goal sheet)
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_sheet_id UUID NOT NULL REFERENCES goal_sheets(id) ON DELETE CASCADE,
  thrust_area_id UUID REFERENCES thrust_areas(id),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  uom_type VARCHAR(20) NOT NULL CHECK (uom_type IN ('numeric_min', 'numeric_max', 'timeline', 'zero')),
  target_value NUMERIC(15,4),            -- NULL for timeline/zero types
  target_date DATE,                      -- for timeline UoM
  weightage NUMERIC(5,2) NOT NULL,
  is_shared BOOLEAN DEFAULT FALSE,
  shared_from_goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,  -- if pushed by admin/manager
  primary_owner_id UUID REFERENCES users(id),                        -- for shared goals
  is_locked BOOLEAN DEFAULT FALSE,       -- locked after manager approval
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- QUARTERLY ACHIEVEMENTS
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  quarter VARCHAR(10) NOT NULL CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  actual_value NUMERIC(15,4),
  actual_date DATE,                      -- for timeline UoM
  status VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'on_track', 'completed')),
  progress_score NUMERIC(6,4),           -- system-computed
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(goal_id, quarter)
);

-- MANAGER CHECK-INS
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_sheet_id UUID NOT NULL REFERENCES goal_sheets(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES users(id),
  quarter VARCHAR(10) NOT NULL CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(goal_sheet_id, manager_id, quarter)
);

-- AUDIT LOGS (every change after goal lock)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,      -- 'goal', 'goal_sheet', 'achievement'
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,           -- 'update', 'unlock', 'approve', etc.
  changed_by UUID NOT NULL REFERENCES users(id),
  old_value JSONB,
  new_value JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SHARED GOAL LINKS (tracks who received a shared goal)
CREATE TABLE IF NOT EXISTS shared_goal_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  recipient_goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_goal_id, recipient_id)
);

-- ESCALATION RULES (bonus feature)
CREATE TABLE IF NOT EXISTS escalation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID REFERENCES goal_cycles(id),
  trigger_event VARCHAR(50) NOT NULL,    -- 'no_submission', 'no_approval', 'no_checkin'
  days_threshold INT NOT NULL,
  escalation_level INT NOT NULL DEFAULT 1, -- 1=employee, 2=manager, 3=HR
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_goals_sheet ON goals(goal_sheet_id);
CREATE INDEX IF NOT EXISTS idx_goal_sheets_employee ON goal_sheets(employee_id);
CREATE INDEX IF NOT EXISTS idx_goal_sheets_cycle ON goal_sheets(cycle_id);
CREATE INDEX IF NOT EXISTS idx_achievements_goal ON achievements(goal_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_checkins_sheet ON checkins(goal_sheet_id);

-- TRIGGERS: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_goal_sheets_updated_at') THEN
    CREATE TRIGGER trg_goal_sheets_updated_at BEFORE UPDATE ON goal_sheets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_goals_updated_at') THEN
    CREATE TRIGGER trg_goals_updated_at BEFORE UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
