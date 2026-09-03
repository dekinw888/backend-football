const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const matchRoutes = require('./routes/matchRoutes');
const betRoutes = require('./routes/betRoutes');
const settleRoutes = require('./routes/settleRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const activityRoutes = require('./routes/activityRoutes');
const rewardRoutes = require('./routes/rewardRoutes');
const { autoSettleGoal7Results } = require('./controllers/settleController');
const socketService = require('./services/socket');

const app = express();
const server = http.createServer(app); // needed so Socket.io can share the same port

// Restrict CORS via env instead of wide-open cors(). Set ALLOWED_ORIGINS on
// Render to your real frontend origin(s), comma separated. Falls back to "*"
// only if you haven't set it yet, so nothing breaks on first deploy.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(compression()); // gzip responses — big win for the matches/bets JSON payloads
app.use(express.json());

// Rate limit only /api — protects the DB from runaway polling/bots without
// touching the static page. 120 req/min/IP is generous for real users.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please slow down.' },
});
app.use('/api', apiLimiter);

// Socket.io — free, replaces most of the old 5s polling loop on the frontend.
socketService.init(server, { corsOrigin: allowedOrigins.length ? allowedOrigins : '*' });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'PRO.html'));
});

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      ok: true,
      status: 'healthy',
      service: 'backend-football',
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      status: 'degraded',
      service: 'backend-football',
      database: 'disconnected',
      error: error.message,
    });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/bets', betRoutes);
app.use('/api/settle', settleRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/rewards', rewardRoutes);

const PORT = process.env.PORT || 5000;

let goal7SyncTimer = null;
let goal7SyncInProgress = false;

function startGoal7AutoSync(intervalMs = 120000) {
  if (goal7SyncTimer) return goal7SyncTimer;

  goal7SyncTimer = setInterval(async () => {
    if (goal7SyncInProgress) return;
    goal7SyncInProgress = true;
    try {
      const result = await autoSettleGoal7Results();
      if (result.synced > 0) {
        console.log(`[goal7-sync] Auto-settled ${result.synced} match(es)`);
        // Tell connected clients to refetch instead of waiting on their own poll.
        socketService.emitSafe('matches:updated', { reason: 'auto-sync' });
        socketService.emitSafe('bets:updated', { reason: 'auto-sync' });
      }
    } catch (error) {
      console.error('[goal7-sync] Error:', error.message);
    } finally {
      goal7SyncInProgress = false;
    }
  }, intervalMs);

  return goal7SyncTimer;
}

if (require.main === module) {
  server.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    startGoal7AutoSync();

    try {
      goal7SyncInProgress = true;
      const result = await autoSettleGoal7Results();
      if (result.synced > 0) {
        console.log(`[goal7-sync] Initial sync settled ${result.synced} match(es)`);
        socketService.emitSafe('matches:updated', { reason: 'initial-sync' });
      }
    } catch (error) {
      console.error('[goal7-sync] Initial sync failed:', error.message);
    } finally {
      goal7SyncInProgress = false;
    }
  });
}

module.exports = app;
