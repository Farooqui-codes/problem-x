require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const seedAdmin = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            console.error('❌ MONGO_URI is not set in environment variables');
            process.exit(1);
        }

        await mongoose.connect(mongoUri, { family: 4 });
        console.log('Connected to MongoDB');

        const adminEmail = (process.env.ADMIN_EMAIL || 'admin@problemx.com').toLowerCase().trim();
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminPassword) {
            console.error('❌ ADMIN_PASSWORD is not set in environment variables');
            process.exit(1);
        }

        // Clean up any unauthorized secondary test admin accounts
        await User.deleteMany({ email: 'admin@city.gov' });

        const isResetRequested = process.argv.includes('--reset-password') || process.argv.includes('--force');

        // Ensure the single designated admin account exists
        let admin = await User.findOne({ email: adminEmail });
        if (admin) {
            if (isResetRequested) {
                admin.name = 'NagarMitra Administrator';
                admin.password = adminPassword; // pre('save') hook will hash this
                admin.role = 'admin';
                await admin.save();
                console.log(`🔑 Designated Administrator password successfully reset for: ${adminEmail}`);
            } else {
                // Do not silently overwrite existing admin password
                console.log(`ℹ️ Designated Administrator account exists: ${adminEmail} (password preserved).`);
                console.log('   To explicitly reset password, run: npm run reset-admin');
            }
        } else {
            await User.create({
                name: 'NagarMitra Administrator',
                email: adminEmail,
                password: adminPassword,
                role: 'admin',
                phone: ''
            });
            console.log(`✅ Designated Administrator created: ${adminEmail}`);
        }

        console.log('🔒 Administrator bootstrap complete. Credentials loaded securely from environment.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error bootstrapping admin:', err.message);
        process.exit(1);
    }
};

seedAdmin();

