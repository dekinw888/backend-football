const express = require('express');
const router = express.Router();
const betController = require('../controllers/betController');
const { verifyToken } = require('../middlewares/authMiddleware');

// ต้อง Login ก่อนถึงจะแทงบอลและดูประวัติได้
router.post('/', verifyToken, betController.placeBet);
router.get('/my-bets', verifyToken, betController.getMyBets);

module.exports = router;