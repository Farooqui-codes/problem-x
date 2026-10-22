const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isDbConnected, connectDB } = require('../config/db');

// Middleware to ensure database is available for DB-dependent operations
const checkDbReady = (req, res, next) => {
    if (!isDbConnected()) {
        // Attempt background reconnect
        connectDB();
        return res.status(503).json({
            success: false,
            error: 'DATABASE_UNAVAILABLE',
            message: 'Database service is currently unavailable. Please try again shortly.'
        });
    }
    next();
};

// Protect routes - verifies JWT token
const protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'UNAUTHENTICATED',
            message: 'Authentication required. Please sign in.'
        });
    }

    if (!isDbConnected()) {
        connectDB();
        return res.status(503).json({
            success: false,
            error: 'DATABASE_UNAVAILABLE',
            message: 'Database is currently unavailable. Please try again shortly.'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Account associated with this session no longer exists.'
            });
        }

        // Normalize legacy roles ('citizen', 'user') to 'local_user'
        if (user.role === 'citizen' || user.role === 'user') {
            user.role = 'local_user';
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            error: 'TOKEN_INVALID',
            message: 'Session has expired or is invalid. Please sign in again.'
        });
    }
};

// Optional auth - if token is present and valid, attach user; else proceed as guest
const optionalAuth = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (token && isDbConnected()) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            const user = await User.findById(decoded.id).select('-password');
            if (user) {
                if (user.role === 'citizen' || user.role === 'user') {
                    user.role = 'local_user';
                }
                req.user = user;
            }
        } catch (err) {
            req.user = null;
        }
    } else {
        req.user = null;
    }
    next();
};

// Grant access to specific roles
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'UNAUTHENTICATED',
                message: 'Authentication required to access this resource.'
            });
        }

        const effectiveRole = (req.user.role === 'citizen' || req.user.role === 'user')
            ? 'local_user'
            : req.user.role;

        const roleAllowed = roles.includes(effectiveRole) ||
            (roles.includes('local_user') && (req.user.role === 'citizen' || req.user.role === 'user'));

        if (!roleAllowed) {
            return res.status(403).json({
                success: false,
                error: 'FORBIDDEN',
                message: `Forbidden: role '${effectiveRole}' is not authorized to access this resource.`
            });
        }
        next();
    };
};

module.exports = { checkDbReady, protect, optionalAuth, authorize };

