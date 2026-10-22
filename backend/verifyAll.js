const http = require('http');
const dotenv = require('dotenv');
dotenv.config();

const { connectDB, isDbConnected, closeDB } = require('./config/db');
const User = require('./models/User');
const Complaint = require('./models/Complaint');

// Helper to make local HTTP requests to express app
async function runTests() {
    console.log('🧪 ===============================================');
    console.log('🧪 STARTING COMPREHENSIVE E2E VERIFICATION SUITE');
    console.log('🧪 ===============================================\n');

    // 1. Database Connection Lifecycle
    console.log('--- TEST 1: Database Connection Lifecycle ---');
    await connectDB();
    console.log(`Database connected state: ${isDbConnected()}`);
    if (!isDbConnected()) {
        throw new Error('Database failed to connect!');
    }
    console.log('✅ TEST 1 PASSED: MongoDB Atlas successfully connected.\n');

    // Start Express server on test port 5099
    const express = require('express');
    const cors = require('cors');
    const path = require('path');

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api/complaints', require('./routes/complaintRoutes'));
    app.use('/api/auth', require('./routes/authRoutes'));
    app.use('/api/stats', require('./routes/statsRoutes'));

    app.get('/api/health', (req, res) => {
        const dbConnected = isDbConnected();
        res.status(dbConnected ? 200 : 503).json({
            success: dbConnected,
            backend: { status: 'online' },
            database: { status: dbConnected ? 'connected' : 'disconnected' }
        });
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(5099, resolve));
    console.log('Express test server listening on http://localhost:5099\n');

    const baseUrl = 'http://localhost:5099/api';

    const request = async (path, options = {}) => {
        const res = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        const data = await res.json().catch(() => null);
        return { status: res.status, ok: res.ok, data };
    };

    // 2. Health Check Endpoint
    console.log('--- TEST 2: Health Check Endpoint ---');
    const health = await request('/health');
    console.log('Health response:', health.data);
    if (health.status !== 200 || !health.data.database || health.data.database.status !== 'connected') {
        throw new Error('Health check test failed!');
    }
    console.log('✅ TEST 2 PASSED: /api/health reports backend and database health separately.\n');

    // 3. User Registration (Default role 'local_user' & client role injection rejection)
    console.log('--- TEST 3: User Registration with Role Enforcement ---');
    const testEmail = `tester_${Date.now()}@example.com`;
    const regRes = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Test Citizen',
            email: `  ${testEmail.toUpperCase()}  `, // Test whitespace and uppercase
            password: 'password123',
            role: 'admin' // Attempting privilege escalation!
        })
    });
    console.log('Register response:', regRes.data);
    if (regRes.status !== 201 || regRes.data.user.role !== 'local_user') {
        throw new Error(`Role escalation was not prevented! Got role: ${regRes.data.user.role}`);
    }
    const citizenToken = regRes.data.token;
    const citizenId = regRes.data.user.id;
    console.log('✅ TEST 3 PASSED: Public registration enforces local_user role and rejects role injection.\n');

    // 4. Login with Email Normalization
    console.log('--- TEST 4: Login & Email Normalization ---');
    const loginRes = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email: ` ${testEmail.toUpperCase()} `,
            password: 'password123'
        })
    });
    if (loginRes.status !== 200 || !loginRes.data.token || loginRes.data.user.role !== 'local_user') {
        throw new Error('Login failed with normalized email!');
    }
    console.log('✅ TEST 4 PASSED: Login succeeds with normalized email and correct password.\n');

    // 5. Wrong Password Rejection
    console.log('--- TEST 5: Wrong Password Rejection ---');
    const wrongLogin = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email: testEmail,
            password: 'WrongPassword!'
        })
    });
    if (wrongLogin.status !== 401) {
        throw new Error('Wrong password was not rejected!');
    }
    console.log('✅ TEST 5 PASSED: Invalid password correctly rejected with 401.\n');

    // 6. Token Verification (/api/auth/me)
    console.log('--- TEST 6: Authenticated Session Restoration (/api/auth/me) ---');
    const meRes = await request('/auth/me', {
        headers: { Authorization: `Bearer ${citizenToken}` }
    });
    if (meRes.status !== 200 || meRes.data.user.email !== testEmail.toLowerCase()) {
        throw new Error('Auth /me failed to verify user session!');
    }
    console.log('✅ TEST 6 PASSED: Verified server session restored via token.\n');

    // 7. Complaint Creation by Local User
    console.log('--- TEST 7: Complaint Creation by Local User ---');
    const compRes = await request('/complaints', {
        method: 'POST',
        headers: { Authorization: `Bearer ${citizenToken}` },
        body: JSON.stringify({
            category: 'Pothole / Road Repair',
            description: 'Major road crater causing hazard at junction 5',
            location: 'Station Road, Ward 4',
            severity: 'High'
        })
    });
    if (compRes.status !== 201 || !compRes.data.complaint || !compRes.data.complaint.complaintId) {
        throw new Error('Complaint creation failed!');
    }
    const citizenComplaint = compRes.data.complaint;
    console.log(`Created Complaint ID: ${citizenComplaint.complaintId}`);
    console.log('✅ TEST 7 PASSED: Complaint created with unique complaintId and ownership attached.\n');

    // 8. Scope Isolation: Local user can ONLY see their own complaints
    console.log('--- TEST 8: Local User Scope Isolation ---');
    const userComplaints = await request('/complaints', {
        headers: { Authorization: `Bearer ${citizenToken}` }
    });
    console.log(`User sees ${userComplaints.data.count} complaints.`);
    const nonOwned = userComplaints.data.complaints.find(c => c.citizenEmail !== testEmail.toLowerCase());
    if (nonOwned) {
        throw new Error('Privacy breach! Local user saw complaints belonging to someone else!');
    }
    console.log('✅ TEST 8 PASSED: Local user strictly restricted to their own complaints.\n');

    // 9. Unauthorized Role Escalation & Action Prevention
    console.log('--- TEST 9: Unauthorized Actions Blocked for Local User ---');
    // Local user attempting to update complaint status (Admin only)
    const illegalStatus = await request(`/complaints/${citizenComplaint.complaintId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${citizenToken}` },
        body: JSON.stringify({ status: 'Resolved' })
    });
    if (illegalStatus.status !== 403) {
        throw new Error(`Expected HTTP 403 for status change by local_user, got: ${illegalStatus.status}`);
    }
    console.log('Status change attempt blocked with HTTP 403 Forbidden.');

    // Local user attempting to export CSV (Admin only)
    const illegalExport = await request('/complaints/export/csv', {
        headers: { Authorization: `Bearer ${citizenToken}` }
    });
    if (illegalExport.status !== 403) {
        throw new Error(`Expected HTTP 403 for CSV export by local_user, got: ${illegalExport.status}`);
    }
    console.log('CSV export attempt blocked with HTTP 403 Forbidden.');
    console.log('✅ TEST 9 PASSED: Local user blocked from all administrative endpoints.\n');

    // 10. Admin Authentication and Permissions
    console.log('--- TEST 10: Admin Authentication & Powers ---');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@problemx.com';
    const adminPassword = process.env.ADMIN_PASSWORD;

    const adminLogin = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email: adminEmail,
            password: adminPassword
        })
    });
    if (adminLogin.status !== 200 || adminLogin.data.user.role !== 'admin') {
        throw new Error('Admin login failed!');
    }
    const adminToken = adminLogin.data.token;
    console.log('Admin login successful.');

    // Admin can see all complaints
    const allComplaints = await request('/complaints', {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log(`Admin sees all ${allComplaints.data.count} complaints.`);
    if (allComplaints.data.count < 2) {
        throw new Error('Admin did not retrieve all system complaints!');
    }

    // Admin updating complaint status
    const adminStatusUpdate = await request(`/complaints/${citizenComplaint.complaintId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
            status: 'In Progress',
            note: 'Assigned crew dispatched'
        })
    });
    if (adminStatusUpdate.status !== 200 || adminStatusUpdate.data.complaint.status !== 'In Progress') {
        throw new Error('Admin status update failed!');
    }
    console.log('Admin successfully updated complaint status to "In Progress".');
    console.log('✅ TEST 10 PASSED: Administrator login, all-complaint access, and status updates verified.\n');

    // 11. Public Tracking & Privacy Protection
    console.log('--- TEST 11: Public Tracking & Contact Privacy Protection ---');
    const publicTrack = await request(`/complaints/${citizenComplaint.complaintId}`);
    if (publicTrack.status !== 200) {
        throw new Error('Public tracking lookup failed!');
    }
    console.log('Public track citizen email:', publicTrack.data.complaint.citizenEmail);
    if (!publicTrack.data.complaint.citizenEmail.includes('***')) {
        throw new Error('Citizen email was not masked for unauthenticated third-party tracker!');
    }
    console.log('✅ TEST 11 PASSED: Public tracking works and masks citizen contact details.\n');

    // Clean up test complaint and test user
    await Complaint.deleteOne({ complaintId: citizenComplaint.complaintId });
    await User.deleteOne({ email: testEmail.toLowerCase() });
    console.log('Cleaned up test user and test complaint.');

    server.close();
    console.log('\n🎉 ALL 11 END-TO-END TESTS COMPLETED SUCCESSFULLY!');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ TEST SUITE FAILURE:', err);
    process.exit(1);
});
