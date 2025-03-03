const Lead = require('../models/Lead');
const csv = require('csv-parser');
const fs = require('fs');

// @desc    Create a new lead
// @route   POST /api/leads
// @access  Private
const createLead = async (req, res) => {
  try {
    const lead = await Lead.create({
      ...req.body,
      assignedTo: req.user._id
    });
    res.status(201).json(lead);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all leads with pagination
// @route   GET /api/leads
// @access  Private
const getLeads = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchTerm = req.query.search || '';
    const status = req.query.status || '';

    let query;

    // Add search functionality
    // if (searchTerm) {
    //   query.$or = [
    //     { name: { $regex: searchTerm, $options: 'i' } },
    //     { email: { $regex: searchTerm, $options: 'i' } },
    //     { phoneNumber: { $regex: searchTerm, $options: 'i' } }
    //   ];
    // }

    // Add status filter
    if (status) {
      query.status = status;
    }

    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      // .populate('assignedTo', 'name email');

    res.json({
      leads,
      page,
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update lead's last contact time
// @route   PUT /api/leads/:id/contact
// @access  Private
const updateLastContact = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    lead.lastContactedAt = new Date();
    await lead.save();

    res.json(lead);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete multiple leads
// @route   DELETE /api/leads
// @access  Private
const deleteLeads = async (req, res) => {
  try {
    const { leadsIds } = req.query;
    const leadsArray = typeof leadsIds === 'string' ? leadsIds.split(',') : [];
    console.log('Deleting leads with IDs:', leadsArray); // Debugging log
    if (!leadsArray || !Array.isArray(leadsArray) || leadsArray.length === 0) {
      console.log('Issue...')
      return res.status(400).json({ message: 'No leads selected for deletion' });
    }

    await Lead.deleteMany({ _id: { $in: leadsArray }});

    res.json({ message: 'Leads deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update lead
// @route   PUT /api/leads/:id
// @access  Private
const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findOne({ 
      _id: req.params.id, 
    });
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const updatedLead = await Lead.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    ) 

    res.json(updatedLead);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Import leads from CSV
// @route   POST /api/leads/import
// @access  Private/Admin
const importLeads = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a file' });
    }

    const results = [];
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        try {
          const leads = await Lead.insertMany(
            results?.map(lead => ({
              ...lead,
              source: 'import',
              // assignedTo: req.user._id
            }))
          );
          
          // Delete the temporary file
          fs.unlinkSync(req.file.path);
          
          res.json({
            message: `Successfully imported ${leads.length} leads`,
            count: leads.length
          });
        } catch (error) {
          console.error('Error importing leads:', error);
          res.status(500).json({ message: 'Error importing leads' });
        }
      });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Add note to lead
// @route   POST /api/leads/:id/notes
// @access  Private
const addNote = async (req, res) => {
  try {
    const { content } = req.body;
    const lead = await Lead.findById(req.params.id);
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    lead.notes.push({
      content,
      createdBy: req.user._id
    });

    await lead.save();
    res.status(201).json(lead);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createLead,
  getLeads,
  updateLead,
  deleteLeads,
  updateLastContact,
  importLeads,
  addNote
};
