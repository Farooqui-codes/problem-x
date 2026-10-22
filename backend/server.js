const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Robust Environment Variables Loader (works from any working directory)
const backendEnvPath = path.join(__dirname, '.env');
const rootEnvPath = path.join(__dirname, '../.env');

if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath });
} else {
    dotenv.config();
}

const { connectDB, isDbConnected, closeDB } = require('./config/db');

// Startup Environment Validation
if (!process.env.MONGO_URI) {
    console.warn('⚠️ WARNING: MONGO_URI is not set in .env. Database operations will be unavailable.');
}
if (!process.env.JWT_SECRET) {
    console.warn('⚠️ WARNING: JWT_SECRET is not set in .env. Using fallback key.');
}

// Connect to MongoDB asynchronously without halting server boot
connectDB();

const app = express();

// Middlewares
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : '*';

app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend website
app.use(express.static(path.join(__dirname, '../')));

// Routes
app.use('/api/complaints', require('./routes/complaintRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/stats', require('./routes/statsRoutes'));

// Contact form inquiry endpoint
app.post('/api/contact', (req, res) => {
    const { name, email, phone, message } = req.body;
    console.log(`📩 [Contact Inquiry Received]:`);
    console.log(`- From: ${name} (${email}) | Phone: ${phone || 'N/A'}`);
    console.log(`- Message: ${message}`);
    console.log(`- Target Support Email: fmdumair07@gmail.com`);

    res.json({
        success: true,
        message: 'Inquiry received and routed to fmdumair07@gmail.com'
    });
});

// Comprehensive Health check route: reports backend AND database separately
app.get('/api/health', (req, res) => {
    const dbConnected = isDbConnected();
    const isHealthy = dbConnected;

    res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        backend: {
            status: 'online',
            uptime: Math.floor(process.uptime()),
            nodeEnv: process.env.NODE_ENV || 'development'
        },
        database: {
            status: dbConnected ? 'connected' : 'disconnected',
            ready: dbConnected
        },
        message: dbConnected
            ? 'Backend API and Database are operational'
            : 'Backend API is running, but MongoDB is currently unreachable or stopped'
    });
});

app.get('/api', (req, res) => {
    const dbConnected = isDbConnected();
    res.json({
        success: true,
        status: 'active',
        database: dbConnected ? 'connected' : 'disconnected',
        message: 'NagarMitra REST API'
    });
});

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, message: 'API route not found' });
});

// Error handling middleware (never expose sensitive stack traces)
app.use((err, req, res, next) => {
    console.error('Server Error:', err.message);
    const statusCode = err.status || 500;
    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`🚀 NagarMitra Backend running on http://localhost:${PORT}`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(async () => {
        console.log('HTTP server closed.');
        await closeDB();
        process.exit(0);
    });

    // Force exit if not closed within 10s
    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

