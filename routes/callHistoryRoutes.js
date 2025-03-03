const express = require('express');
const router = express.Router();
const CallHistory = require('../models/callHistory');

// Get call history for a user
router.get('/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const history = await CallHistory.find({ userId })
            .sort({ timestamp: -1 }) // Sort by newest first
            .limit(100); // Limit to last 100 calls
        res.json(history);
    } catch (error) {
        console.error('Error fetching call history:', error);
        res.status(500).json({ error: 'Failed to fetch call history' });
    }
});

// Add a new call record
router.post('/', async (req, res) => {
    try {
        const callRecord = new CallHistory(req.body);
        await callRecord.save();
        res.json(callRecord);
    } catch (error) {
        console.error('Error saving call record:', error);
        res.status(500).json({ error: 'Failed to save call record' });
    }
});

module.exports = router;
