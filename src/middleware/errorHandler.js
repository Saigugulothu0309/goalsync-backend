// Wraps async route handlers to forward errors to Express error handler
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Central error handler — register as last middleware in app.js
const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (err.code === '23505') {
    // PostgreSQL unique violation
    return res.status(409).json({ error: 'Duplicate entry — record already exists' });
  }
  if (err.code === '23503') {
    // Foreign key violation
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
};

module.exports = { asyncHandler, errorHandler, notFound };
