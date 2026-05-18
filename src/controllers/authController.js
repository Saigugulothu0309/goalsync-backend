const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');

const generateToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, manager_id, department } = req.body;

  if (!['employee', 'manager', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be employee, manager, or admin.' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Email already registered.' });
  }

  const password_hash = await bcrypt.hash(password, 12);

  const result = await query(
    `INSERT INTO users (name, email, password_hash, role, manager_id, department)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, role, department, created_at`,
    [name, email, password_hash, role, manager_id || null, department || null]
  );

  const user = result.rows[0];
  res.status(201).json({ user, token: generateToken(user) });
});

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await query(
      'SELECT id, name, email, password_hash, role, department, is_active FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials or account inactive.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, token: generateToken(safeUser) });
  } catch (err) {
    console.error('[LOGIN ERROR DETAIL]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.role, u.department, u.is_active,
            m.name AS manager_name, m.email AS manager_email
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     WHERE u.id = $1`,
    [req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
  res.json(result.rows[0]);
});

module.exports = { register, login, me };
