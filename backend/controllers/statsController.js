const Complaint = require('../models/Complaint');
const User = require('../models/User');
const { isDbConnected } = require('../config/db');

// @desc    Get dashboard statistics
// @route   GET /api/stats
exports.getStats = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline.'
            });
        }
        const total = await Complaint.countDocuments();
        const pending = await Complaint.countDocuments({ status: { $in: ['Pending', 'Submitted', 'Under Review'] } });
        const inProgress = await Complaint.countDocuments({ status: { $in: ['In Progress', 'Assigned'] } });
        const resolved = await Complaint.countDocuments({ status: { $in: ['Resolved', 'Closed'] } });
        const rejected = await Complaint.countDocuments({ status: 'Rejected' });

        const totalUsers = await User.countDocuments();

        // Category breakdown
        const categoryStats = await Complaint.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);

        const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

        const statsData = {
            total,
            pending,
            inProgress,
            resolved,
            rejected,
            totalUsers,
            resolutionRate,
            byCategory: categoryStats
        };

        res.json({
            success: true,
            data: statsData,
            stats: statsData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
