const express = require('express');
const activityController = require('../controllers/activityController');
const { verifyToken, checkAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/visit', activityController.recordVisit);
router.post('/heartbeat', verifyToken, activityController.heartbeat);
router.get('/admin', verifyToken, checkAdmin, activityController.getAdminActivity);

module.exports = router;
