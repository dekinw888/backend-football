const express = require('express');
const walletController = require('../controllers/walletController');
const { verifyToken, checkAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();
router.post('/', verifyToken, walletController.createRequest);
router.get('/mine', verifyToken, walletController.getMyRequests);
router.get('/admin', verifyToken, checkAdmin, walletController.getAllRequests);
router.patch('/:requestId', verifyToken, checkAdmin, walletController.reviewRequest);

module.exports = router;
