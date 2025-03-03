const Call = require('../models/Call');
const Lead = require('../models/Lead');

// @desc    Create call record
// @route   POST /api/calls
// @access  Private
const createCall = async (req, res) => {
  try {
    const { callSid, from, to, direction } = req.body;
    
    // Find or create lead based on the phone number
    let lead = await Lead.findOne({ phoneNumber: direction === 'inbound' ? from : to });
    if (!lead) {
      lead = await Lead.create({
        phoneNumber: direction === 'inbound' ? from : to,
        source: 'call',
        assignedTo: req.user._id
      });
    }

    const call = await Call.create({
      callSid,
      from,
      to,
      direction,
      status: 'initiated',
      agent: req.user._id,
      lead: lead._id
    });

    res.status(201).json(call);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update call record
// @route   PUT /api/calls/:callSid
// @access  Private
const updateCall = async (req, res) => {
  try {
    const call = await Call.findOneAndUpdate(
      { callSid: req.params.callSid },
      req.body,
      { new: true }
    );

    if (!call) {
      return res.status(404).json({ message: 'Call not found' });
    }

    // If call is completed, update lead's lastContacted
    if (req.body.status === 'completed' && call.lead) {
      await Lead.findByIdAndUpdate(call.lead, {
        lastContacted: new Date()
      });
    }

    res.json(call);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get call history
// @route   GET /api/calls
// @access  Private
const getCallHistory = async (req, res) => {
  try {
    const pageSize = 10;
    const page = Number(req.query.page) || 1;

    const query = {};
    if (req.user.role !== 'admin') {
      query.agent = req.user._id;
    }

    const count = await Call.countDocuments(query);
    const calls = await Call.find(query)
      .populate('agent', 'name email')
      .populate('lead', 'name phoneNumber')
      .sort({ createdAt: -1 })
      .limit(pageSize)
      .skip(pageSize * (page - 1));

    res.json({
      calls,
      page,
      pages: Math.ceil(count / pageSize),
      total: count
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Add note to call
// @route   POST /api/calls/:callSid/notes
// @access  Private
const addCallNote = async (req, res) => {
  try {
    const { notes } = req.body;
    const call = await Call.findOneAndUpdate(
      { callSid: req.params.callSid },
      { notes },
      { new: true }
    );

    if (!call) {
      return res.status(404).json({ message: 'Call not found' });
    }

    res.json(call);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createCall,
  updateCall,
  getCallHistory,
  addCallNote
};
