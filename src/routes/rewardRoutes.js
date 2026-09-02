const express = require('express');
const rewardController = require('../controllers/rewardController');
const { verifyToken } = require('../middlewares/authMiddleware');

const router = express.Router();
router.get('/status', verifyToken, rewardController.getStatus);
router.post('/wheel', verifyToken, rewardController.claimWheel);
router.post('/checkin', verifyToken, rewardController.claimDailyCheckin);

module.exports = router;
