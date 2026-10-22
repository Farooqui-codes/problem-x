const express = require('express');
const router = express.Router();
const {
    createComplaint,
    getAllComplaints,
    getComplaintById,
    updateStatus,
    upvoteComplaint,
    deleteComplaint,
    exportCSV
} = require('../controllers/complaintController');
const { protect, authorize, optionalAuth } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');


// Routes
// Listing complaints requires authentication: admin gets all, local_user gets own
router.route('/')
    .get(protect, getAllComplaints)
    .post(protect, upload.single('image'), createComplaint);

// Admin-only CSV export
router.get('/export/csv', protect, authorize('admin'), exportCSV);

// Track specific complaint (publicly visible by ID for tracking progress)
router.get('/:id', optionalAuth, getComplaintById);

// Delete complaint (admin or author owner)
router.delete('/:id', protect, deleteComplaint);

// Admin-only status change
router.patch('/:id/status', protect, authorize('admin'), updateStatus);

// Upvoting
router.post('/:id/upvote', optionalAuth, upvoteComplaint);

module.exports = router;

