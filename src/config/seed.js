/**
 * Seed script — creates demo users, an active cycle, and thrust areas.
 * Run: node src/config/seed.js
 */
require('dotenv').config();
const { query, pool } = require('./db');
const bcrypt = require('bcryptjs');

const seed = async () => {
  console.log('🌱 Seeding demo data...');

  // Demo users
  const password = await bcrypt.hash('Password123!', 12);

  // Admin
  const admin = await query(
    `INSERT INTO users (name, email, password_hash, role, department)
     VALUES ('Admin User', 'admin@atomquest.com', $1, 'admin', 'HR')
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id, name, email`,
    [password]
  );

  // Manager
  const manager = await query(
    `INSERT INTO users (name, email, password_hash, role, department)
     VALUES ('Manager One', 'manager@atomquest.com', $1, 'manager', 'Engineering')
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id, name, email`,
    [password]
  );

  // Employee
  await query(
    `INSERT INTO users (name, email, password_hash, role, department, manager_id)
     VALUES ('Employee One', 'employee@atomquest.com', $1, 'employee', 'Engineering', $2)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name`,
    [password, manager.rows[0].id]
  );

  // Thrust Areas
  const thrustAreas = ['Revenue Growth', 'Customer Satisfaction', 'Operational Excellence', 'People & Culture', 'Safety & Compliance'];
  for (const name of thrustAreas) {
    await query(
      `INSERT INTO thrust_areas (name, created_by) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [name, admin.rows[0].id]
    );
  }

  // Active Goal Cycle
  await query(`UPDATE goal_cycles SET is_active=FALSE`);
  await query(
    `INSERT INTO goal_cycles (name, start_date, end_date, goal_setting_opens, q1_opens, q2_opens, q3_opens, q4_opens, is_active, created_by)
     VALUES ('FY 2025-26', '2025-04-01', '2026-03-31', '2025-05-01', '2025-07-01', '2025-10-01', '2026-01-01', '2026-03-01', TRUE, $1)
     ON CONFLICT DO NOTHING`,
    [admin.rows[0].id]
  );

  console.log('\n✅ Seed complete! Demo credentials:');
  console.log('   Admin   → admin@atomquest.com    / Password123!');
  console.log('   Manager → manager@atomquest.com  / Password123!');
  console.log('   Employee→ employee@atomquest.com / Password123!\n');

  await pool.end();
};

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
