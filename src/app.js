require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const routes = require('./routes/index');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

// ── SECURITY & PARSING ────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ── API ROUTES ────────────────────────────────────────────────

app.get('/debug', (req, res) => {
  res.json({
    has_db_url: !!process.env.DATABASE_URL,
    db_url_start: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 40) : 'MISSING',
    has_jwt: !!process.env.JWT_SECRET,
    node_env: process.env.NODE_ENV,
    port: process.env.PORT
  });
});

app.use('/api', routes);

// ── ERROR HANDLING ────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 AtomQuest API running on port ${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health check: http://localhost:${PORT}/health\n`);
});

module.exports = app;
