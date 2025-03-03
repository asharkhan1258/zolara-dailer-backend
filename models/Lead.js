const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['New', 'In-Progress', 'Contacted','Completed', 'Qualified', 'Lost', 'Converted'],
    default: 'New'
  },
  notes: [{
    content: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  lastContactedAt: {
    type: Date,
    default: null
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // required: true
  },
  source: {
    type: String,
    enum: ['manual', 'import', 'website'],
    default: 'manual'
  },
  lastContacted: Date,
  customFields: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Lead', leadSchema);
