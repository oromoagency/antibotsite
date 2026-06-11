const express = require('express');
const router = express.Router();
const validationController = require('../controllers/validationController');
const adminController = require('../controllers/adminController');

router.get('/challenge-config', validationController.getChallengeConfig);
router.post('/verify-challenge', validationController.verifyChallenge);
router.post('/feedback-invisible', validationController.recordSilentFeedback);
router.get('/admin/stats', adminController.getStats);

module.exports = router;
