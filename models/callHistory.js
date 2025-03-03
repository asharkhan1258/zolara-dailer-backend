const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema({
    callId: {
        type: String,
        required: true,
        unique: true
    },
    number: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true,
        enum: ['ringing', 'in-progress', 'completed', 'no-answer', 'failed', 'busy', 'canceled']
    },
    timestamp: {
        type: Date,
        required: true
    },
    duration: {
        type: Number,
        default: 0
    },
    from: String,
    to: String,
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('CallHistory', callHistorySchema);
