const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');
const { verifyToken, checkAdmin } = require('../middlewares/authMiddleware');

// User ทั่วไปและ Admin ดูคู่บอลได้
router.get('/', matchController.getAllMatches);

// เฉพาะ Admin เท่านั้นที่เพิ่มและแก้ราคาบอลได้
router.post('/', verifyToken, checkAdmin, matchController.createMatch);
router.put('/:matchId', verifyToken, checkAdmin, matchController.updateMatch);
router.put('/:matchId/odds', verifyToken, checkAdmin, matchController.updateOdds);

module.exports = router;