const express = require('express');
const router = express.Router();
const { createCall, updateCall, getCallHistory, addCallNote } = require('../controllers/callController');
const { protect } = require('../middleware/auth');

router.route('/')
  .post(protect, createCall)
  .get(protect, getCallHistory);

router.put('/:callSid', protect, updateCall);
router.post('/:callSid/notes', protect, addCallNote);

module.exports = router;
