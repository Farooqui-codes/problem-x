const mongoose = require('mongoose');

// State flags and retry variables
let isConnecting = false;
let isShuttingDown = false;
let retryCount = 0;
let reconnectTimer = null;

const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds
const MAX_RETRY_DELAY_MS = 60000;    // Cap at 60 seconds

/**
 * Calculates exponential backoff delay: 5s, 10s, 20s, 40s, max 60s
 */
const getNextRetryDelay = () => {
    const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
    return Math.min(delay, MAX_RETRY_DELAY_MS);
};

/**
 * Schedules a reconnection attempt with exponential backoff
 */
const scheduleReconnect = (reason) => {
    if (isShuttingDown) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    const delayMs = getNextRetryDelay();
    const delaySeconds = Math.round(delayMs / 1000);

    console.warn(`🔄 [MongoDB] Reconnecting in ${delaySeconds}s (Attempt #${retryCount + 1}) | Reason: ${reason}`);

    reconnectTimer = setTimeout(async () => {
        retryCount++;
        reconnectTimer = null;
        await connectDB();
    }, delayMs);
};

/**
 * Connect to MongoDB with production-grade options and resilience
 */
const connectDB = async () => {
    // Avoid concurrent connection attempts
    if (isConnecting || isShuttingDown) return;

    // Already connected
    if (mongoose.connection.readyState === 1) {
        return;
    }

    let mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        // Fallback: Try loading from .env if not yet loaded in process.env
        const path = require('path');
        const fs = require('fs');
        const backendEnv = path.join(__dirname, '../.env');
        const rootEnv = path.join(__dirname, '../../.env');
        if (fs.existsSync(backendEnv)) {
            require('dotenv').config({ path: backendEnv });
        } else if (fs.existsSync(rootEnv)) {
            require('dotenv').config({ path: rootEnv });
        }
        mongoUri = process.env.MONGO_URI;
    }

    if (!mongoUri) {
        console.error('❌ [MongoDB] MONGO_URI is not defined in environment variables (.env)');
        return;
    }

    isConnecting = true;

    const isSrv = mongoUri.startsWith('mongodb+srv://');

    // Production-ready Mongoose connection options (compatible with Mongoose v7/v8)
    const options = {
        serverSelectionTimeoutMS: 8000,  // Timeout after 8s if server/cluster is unreachable
        socketTimeoutMS: 45000,          // Close socket after 45s of inactivity
        connectTimeoutMS: 10000,         // 10s timeout for initial connection
        maxPoolSize: 10,                 // Maintain up to 10 socket connections
        minPoolSize: 2,                  // Maintain at least 2 socket connections
        autoIndex: process.env.NODE_ENV !== 'production' // Build indexes automatically only in non-production
    };

    // Force IPv4 only for local/IP based connections to avoid ::1 resolution delay on Windows
    if (!isSrv) {
        options.family = 4;
    }

    try {
        await mongoose.connect(mongoUri, options);
        // Connection success is also handled in 'connected' event
    } catch (error) {
        console.error(`❌ [MongoDB] Connection Failed: ${error.message}`);
        scheduleReconnect(error.message);
    } finally {
        isConnecting = false;
    }
};

// -------------------------------------------------------------
// Connection Event Listeners
// -------------------------------------------------------------
mongoose.connection.on('connected', () => {
    retryCount = 0; // Reset exponential backoff on successful connection
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    const host = mongoose.connection.host || 'unknown-host';
    const dbName = mongoose.connection.name || 'default';
    console.log(`✅ [MongoDB] Connected successfully to host: ${host} | Database: ${dbName}`);
});

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ [MongoDB] Connection lost/disconnected!');
    // Automatically trigger exponential retry if not shutting down
    if (!isShuttingDown && mongoose.connection.readyState !== 1) {
        scheduleReconnect('Connection dropped');
    }
});

mongoose.connection.on('reconnected', () => {
    retryCount = 0;
    console.log('🔄 [MongoDB] Reconnection established successfully');
});

mongoose.connection.on('error', (err) => {
    console.error(`❌ [MongoDB] Runtime Error: ${err.message}`);
    // If state is not connected and not connecting, trigger reconnect
    if (mongoose.connection.readyState === 0 && !isShuttingDown) {
        scheduleReconnect(err.message);
    }
});

/**
 * Helper to check if DB is currently operational
 */
const isDbConnected = () => {
    return mongoose.connection.readyState === 1;
};

/**
 * Graceful shutdown helper to close connections cleanly
 */
const closeDB = async () => {
    isShuttingDown = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    try {
        await mongoose.connection.close(false);
        console.log('🛑 [MongoDB] Connection closed gracefully');
    } catch (err) {
        console.error('❌ [MongoDB] Error closing connection:', err.message);
    }
};

module.exports = { connectDB, isDbConnected, closeDB };
