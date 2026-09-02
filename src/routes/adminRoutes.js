const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyToken, checkAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();
router.get('/users', verifyToken, checkAdmin, adminController.getUsers);
router.patch('/users/:userId', verifyToken, checkAdmin, adminController.updateUser);
module.exports = router;
