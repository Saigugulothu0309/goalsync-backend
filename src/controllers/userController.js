const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const bcrypt = require('bcryptjs');

// GET /api/users — Admin: all users; Manager: their direct reports
const listUsers = asyncHandler(async (req, res) => {
  let result;
  if (req.user.role === 'admin') {
    result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.department, u.is_active,
              m.name AS manager_name
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       ORDER BY u.role, u.name`
    );
  } else if (req.user.role === 'manager') {
    result = await query(
      `SELECT id, name, email, role, department, is_active
       FROM users WHERE manager_id = $1 ORDER BY name`,
      [req.user.id]
    );
  } else {
    return res.status(403).json({ error: 'Access denied.' });
  }
  res.json(result.rows);
});

// GET /api/users/:id
const getUser = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.role, u.department, u.is_active,
            u.manager_id, m.name AS manager_name
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     WHERE u.id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
  res.json(result.rows[0]);
});

// PUT /api/users/:id — Admin only
const updateUser = asyncHandler(async (req, res) => {
  const { name, role, manager_id, department, is_active } = req.body;
  const result = await query(
    `UPDATE users SET name=$1, role=$2, manager_id=$3, department=$4, is_active=$5
     WHERE id=$6
     RETURNING id, name, email, role, department, is_active`,
    [name, role, manager_id || null, department, is_active, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
  res.json(result.rows[0]);
});

// POST /api/users/:id/reset-password — Admin only
const resetPassword = asyncHandler(async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const hash = await bcrypt.hash(new_password, 12);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
  res.json({ message: 'Password reset successfully.' });
});

// GET /api/users/managers — list all managers (for dropdown)
const listManagers = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, email, department FROM users WHERE role IN ('manager','admin') AND is_active=TRUE ORDER BY name`
  );
  res.json(result.rows);
});

module.exports = { listUsers, getUser, updateUser, resetPassword, listManagers };
