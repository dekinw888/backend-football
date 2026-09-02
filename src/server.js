const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const matchRoutes = require('./routes/matchRoutes');
const betRoutes = require('./routes/betRoutes');
const settleRoutes = require('./routes/settleRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const activityRoutes = require('./routes/activityRoutes');
const { autoSettleGoal7Results } = require('./controllers/settleController');

const app = express();

app.use(cors());
app.use(express.json());

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
  app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    startGoal7AutoSync();

    try {
      goal7SyncInProgress = true;
      const result = await autoSettleGoal7Results();
      if (result.synced > 0) {
        console.log(`[goal7-sync] Initial sync settled ${result.synced} match(es)`);
      }
    } catch (error) {
      console.error('[goal7-sync] Initial sync failed:', error.message);
    } finally {
      goal7SyncInProgress = false;
    }
  });
}

module.exports = app;