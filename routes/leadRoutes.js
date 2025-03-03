const express = require('express');
const multer = require('multer');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  createLead,
  getLeads,
  updateLead,
  deleteLeads,
  updateLastContact,
  importLeads,
  addNote
} = require('../controllers/leadController');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

router.route('/')
  .get(getLeads)
  .post(createLead)
  .delete(deleteLeads);

router.route('/import')
  .post(upload.single('file'), importLeads);

router.route('/:id')
  .put(updateLead);

router.route('/:id/contact')
  .put(updateLastContact);

router.route('/:id/notes')
  .post(addNote);

module.exports = router;
