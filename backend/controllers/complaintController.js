const Complaint = require('../models/Complaint');
const { isDbConnected } = require('../config/db');

// Generate sequential complaint ID (e.g. PRB-001, PRB-002, PRB-003...)
const generateSequentialComplaintId = async () => {
    // Query all existing complaints matching PRB- pattern
    const existing = await Complaint.find({ complaintId: /^PRB-\d+$/ }, 'complaintId');
    let maxSequentialNum = 0;

    for (const c of existing) {
        const match = c.complaintId && c.complaintId.match(/^PRB-(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            // Treat numbers < 1000 as part of the sequential series (001, 002...)
            if (num < 1000 && num > maxSequentialNum) {
                maxSequentialNum = num;
            }
        }
    }

    let nextNum = maxSequentialNum + 1;
    let complaintId = `PRB-${String(nextNum).padStart(3, '0')}`;

    // Check collision to ensure absolute uniqueness
    while (await Complaint.findOne({ complaintId })) {
        nextNum++;
        complaintId = `PRB-${String(nextNum).padStart(3, '0')}`;
    }

    return complaintId;
};

// @desc    Create new complaint
// @route   POST /api/complaints
exports.createComplaint = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline. Your complaint draft has been preserved. Please try submitting again shortly.'
            });
        }

        const {
            category,
            description,
            location,
            landmark,
            severity,
            department,
            imageUrl,
            utm
        } = req.body;

        if (!category || !description || !location) {
            return res.status(400).json({
                success: false,
                message: 'Please provide category, description, and location'
            });
        }

        const complaintId = await generateSequentialComplaintId();

        const complaintData = {
            complaintId,
            category: category.trim(),
            description: description.trim(),
            location: location.trim(),
            landmark: landmark ? landmark.trim() : '',
            severity: severity || 'Medium',
            department: department || 'Public Infrastructure Department',
            imageUrl: imageUrl || '',
            image: imageUrl || '',
            citizenName: req.user ? req.user.name : 'Anonymous Citizen',
            citizenEmail: req.user ? req.user.email.toLowerCase() : '',
            citizenPhone: req.user ? req.user.phone : '',
            status: 'Submitted',
            utm: utm || null,
            statusHistory: [{
                status: 'Submitted',
                changedAt: new Date(),
                changedBy: req.user ? req.user.name : 'Citizen',
                note: 'Complaint submitted'
            }]
        };

        if (req.user) {
            complaintData.user = req.user._id;
        }

        if (req.file) {
            complaintData.imageUrl = `/uploads/${req.file.filename}`;
            complaintData.image = `/uploads/${req.file.filename}`;
        }

        const complaint = await Complaint.create(complaintData);
        res.status(201).json({
            success: true,
            data: complaint,
            complaint
        });
    } catch (error) {
        console.error('Create Complaint Error:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

// @desc    Get complaints (all for admin, own complaints for local_user)
// @route   GET /api/complaints
exports.getAllComplaints = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline. Please try again shortly.'
            });
        }

        const { category, status, search, priority, severity, sort, myReportsOnly } = req.query;
        let query = {};

        const isAdmin = req.user && req.user.role === 'admin';

        if (!isAdmin) {
            // Local users are STRICTLY scoped to their own complaints
            query.$or = [
                { user: req.user._id },
                { citizenEmail: req.user.email.toLowerCase() }
            ];
        } else if (myReportsOnly === 'true') {
            // Admin explicitly viewing own reports
            query.$or = [
                { user: req.user._id },
                { citizenEmail: req.user.email.toLowerCase() }
            ];
        }

        if (category && category !== 'all') query.category = category;
        if (status && status !== 'all') query.status = status;
        if (priority && priority !== 'all') query.severity = priority;
        if (severity && severity !== 'all') query.severity = severity;

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            const searchConditions = [
                { description: searchRegex },
                { location: searchRegex },
                { category: searchRegex },
                { complaintId: searchRegex }
            ];
            if (query.$or) {
                query.$and = [
                    { $or: query.$or },
                    { $or: searchConditions }
                ];
                delete query.$or;
            } else {
                query.$or = searchConditions;
            }
        }

        let queryBuilder = Complaint.find(query);

        if (sort === 'upvotes') {
            queryBuilder = queryBuilder.sort({ upvotes: -1, createdAt: -1 });
        } else if (sort === 'oldest') {
            queryBuilder = queryBuilder.sort({ createdAt: 1 });
        } else {
            queryBuilder = queryBuilder.sort({ createdAt: -1 });
        }

        const complaints = await queryBuilder;
        res.json({
            success: true,
            count: complaints.length,
            data: complaints,
            complaints
        });
    } catch (error) {
        console.error('Get All Complaints Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get single complaint by ID (supports public tracking with privacy protection)
// @route   GET /api/complaints/:id
exports.getComplaintById = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline. Please try again shortly.'
            });
        }

        const id = req.params.id;
        let complaint;

        if (id.startsWith('PRB-')) {
            complaint = await Complaint.findOne({ complaintId: id });
        } else {
            complaint = await Complaint.findById(id).catch(() => null) ||
                        await Complaint.findOne({ complaintId: id });
        }

        if (!complaint) {
            return res.status(404).json({ success: false, message: 'Complaint not found' });
        }

        // Privacy check: mask private contact details for third parties
        const isOwner = req.user && (
            (complaint.user && complaint.user.toString() === req.user._id.toString()) ||
            (complaint.citizenEmail && complaint.citizenEmail.toLowerCase() === req.user.email.toLowerCase())
        );
        const isAdmin = req.user && req.user.role === 'admin';

        const safeComplaint = complaint.toObject();
        if (!isAdmin && !isOwner) {
            safeComplaint.citizenPhone = '';
            if (safeComplaint.citizenEmail) {
                const parts = safeComplaint.citizenEmail.split('@');
                safeComplaint.citizenEmail = parts[0].slice(0, 2) + '***@' + (parts[1] || '');
            }
        }

        res.json({ success: true, data: safeComplaint, complaint: safeComplaint });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update complaint status (Admin only)
// @route   PATCH /api/complaints/:id/status
exports.updateStatus = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline. Status update cannot be processed right now.'
            });
        }

        const { status, note } = req.body;
        const id = req.params.id;

        let complaint;
        if (id.startsWith('PRB-')) {
            complaint = await Complaint.findOne({ complaintId: id });
        } else {
            complaint = await Complaint.findById(id).catch(() => null) ||
                        await Complaint.findOne({ complaintId: id });
        }

        if (!complaint) {
            return res.status(404).json({ success: false, message: 'Complaint not found' });
        }

        complaint.status = status || complaint.status;
        complaint.statusHistory.push({
            status: status || complaint.status,
            changedAt: new Date(),
            changedBy: req.user ? req.user.name : 'Administrator',
            note: note || `Status updated to ${status}`
        });

        await complaint.save();
        res.json({ success: true, data: complaint, complaint });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// @desc    Upvote complaint
// @route   POST /api/complaints/:id/upvote
exports.upvoteComplaint = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline. Please try again shortly.'
            });
        }

        const id = req.params.id;
        let complaint;

        if (id.startsWith('PRB-')) {
            complaint = await Complaint.findOne({ complaintId: id });
        } else {
            complaint = await Complaint.findById(id).catch(() => null) ||
                        await Complaint.findOne({ complaintId: id });
        }

        if (!complaint) {
            return res.status(404).json({ success: false, message: 'Complaint not found' });
        }

        const identifier = req.user ? req.user.email : (req.body.email || ('ip_' + req.ip));

        const hasUpvoted = complaint.upvotedBy.includes(identifier);
        if (hasUpvoted) {
            complaint.upvotedBy = complaint.upvotedBy.filter(item => item !== identifier);
            complaint.upvotes = Math.max(0, complaint.upvotes - 1);
        } else {
            complaint.upvotedBy.push(identifier);
            complaint.upvotes += 1;
        }

        await complaint.save();
        res.json({
            success: true,
            data: { upvotes: complaint.upvotes, hasUpvoted: !hasUpvoted },
            upvotes: complaint.upvotes,
            hasUpvoted: !hasUpvoted
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// @desc    Delete complaint (Admin or owner author only)
// @route   DELETE /api/complaints/:id
exports.deleteComplaint = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline. Please try again shortly.'
            });
        }

        const id = req.params.id;
        let complaint;

        if (id.startsWith('PRB-')) {
            complaint = await Complaint.findOne({ complaintId: id });
        } else {
            complaint = await Complaint.findById(id).catch(() => null) ||
                        await Complaint.findOne({ complaintId: id });
        }

        if (!complaint) {
            return res.status(404).json({ success: false, message: 'Complaint not found' });
        }

        // Enforce permission: Admin or author
        const isAdmin = req.user.role === 'admin';
        const isOwner = (complaint.user && complaint.user.toString() === req.user._id.toString()) ||
                        (complaint.citizenEmail && complaint.citizenEmail.toLowerCase() === req.user.email.toLowerCase());

        if (!isAdmin && !isOwner) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden: You do not have permission to delete this complaint'
            });
        }

        await complaint.deleteOne();
        res.json({ success: true, message: 'Complaint deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Helper to format/escape CSV cell and protect against Formula Injection
const formatCSVCell = (val) => {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    // Protect against Spreadsheet Formula Injection (CSV Injection)
    if (/^[=\+\-@\t\r]/.test(str)) {
        str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
};

// @desc    Export CSV (Admin only)
// @route   GET /api/complaints/export/csv
exports.exportCSV = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({
                success: false,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Database is currently offline. Cannot export data.'
            });
        }

        const { category, status, priority, severity, department, search } = req.query;
        const query = {};

        if (category && category !== 'all') query.category = category;
        if (status && status !== 'all') query.status = status;
        if (priority && priority !== 'all') query.severity = priority;
        if (severity && severity !== 'all') query.severity = severity;
        if (department && department !== 'all') query.department = department;

        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            query.$or = [
                { description: searchRegex },
                { location: searchRegex },
                { landmark: searchRegex },
                { category: searchRegex },
                { complaintId: searchRegex },
                { citizenName: searchRegex }
            ];
        }

        // Export all matching records authorized for admin
        const complaints = await Complaint.find(query).sort({ createdAt: -1 });

        const headers = [
            'Complaint ID',
            'Category',
            'Description',
            'Location',
            'Landmark',
            'Severity',
            'Department',
            'Status',
            'Upvotes',
            'Reported By',
            'Citizen Email',
            'Citizen Phone',
            'Latest Remarks',
            'Submission Date'
        ];

        let csv = headers.map(formatCSVCell).join(',') + '\r\n';

        complaints.forEach(c => {
            const latestHistory = Array.isArray(c.statusHistory) && c.statusHistory.length > 0
                ? c.statusHistory[c.statusHistory.length - 1]
                : null;
            const remarks = latestHistory && latestHistory.note ? latestHistory.note : '';
            const dateStr = c.createdAt ? new Date(c.createdAt).toISOString() : '';

            const row = [
                c.complaintId || c._id,
                c.category || '',
                c.description || '',
                c.location || '',
                c.landmark || '',
                c.severity || 'Medium',
                c.department || '',
                c.status || 'Submitted',
                c.upvotes || 0,
                c.citizenName || 'Anonymous Citizen',
                c.citizenEmail || '',
                c.citizenPhone || '',
                remarks,
                dateStr
            ];

            csv += row.map(formatCSVCell).join(',') + '\r\n';
        });

        const today = new Date().toISOString().slice(0, 10);
        const filename = `NagarMitra_Complaints_${today}.csv`;

        // Prepend UTF-8 Byte Order Mark (BOM) so Excel renders Unicode/Hindi correctly
        const BOM = '\uFEFF';

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.status(200).send(BOM + csv);
    } catch (error) {
        console.error('Export CSV Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

