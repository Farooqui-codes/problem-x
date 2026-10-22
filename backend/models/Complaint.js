const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema({
    status: {
        type: String,
        default: 'Submitted'
    },
    changedAt: {
        type: Date,
        default: Date.now
    },
    changedBy: {
        type: String,
        default: 'System/Admin'
    },
    note: {
        type: String,
        default: ''
    }
}, { _id: false });

const complaintSchema = new mongoose.Schema({
    complaintId: {
        type: String,
        required: [true, 'Complaint ID is required'],
        trim: true,
        index: true
    },
    category: {
        type: String,
        required: [true, 'Please specify category'],
        trim: true
    },
    description: {
        type: String,
        required: [true, 'Please provide description'],
        trim: true
    },
    location: {
        type: String,
        required: [true, 'Please provide location'],
        trim: true
    },
    landmark: {
        type: String,
        default: ''
    },
    severity: {
        type: String,
        default: 'Medium'
    },
    department: {
        type: String,
        default: 'Public Infrastructure Department'
    },
    status: {
        type: String,
        default: 'Submitted'
    },
    imageUrl: {
        type: String,
        default: ''
    },
    image: {
        type: String,
        default: ''
    },
    citizenName: {
        type: String,
        default: 'Anonymous Citizen'
    },
    citizenEmail: {
        type: String,
        default: ''
    },
    citizenPhone: {
        type: String,
        default: ''
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    upvotes: {
        type: Number,
        default: 0
    },
    upvotedBy: [{
        type: String
    }],
    statusHistory: [statusHistorySchema],
    utm: {
        type: Object,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Complaint', complaintSchema);
