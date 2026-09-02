const express = require('express');
const router = express.Router();
const settleController = require('../controllers/settleController');
const { verifyToken, checkAdmin } = require('../middlewares/authMiddleware');

// เฉพาะ Admin เท่านั้นที่สามารถกรอกผลสกอร์และเคลียร์เงินได้
router.post('/match/:matchId', verifyToken, checkAdmin, settleController.settleMatch);
router.post('/goal7-sync', verifyToken, checkAdmin, settleController.syncGoal7Results);

module.exports = router;