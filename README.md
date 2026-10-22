# 🏙️ NagarMitra – Smart City Complaint Management System

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg?logo=node.js)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-v4.19-lightgrey.svg?logo=express)](https://expressjs.com/)
[![MongoDB Atlas](https://img.shields.io/badge/MongoDB-Atlas%20Cloud-green.svg?logo=mongodb)](https://www.mongodb.com/atlas)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-Yes-emerald.svg)](https://github.com/)

> **Your City, Your Voice, Our Responsibility.**
>
> **NagarMitra** is a full-stack civic grievance redressal and smart city complaint management portal. It empowers citizens to report local municipal issues (potholes, garbage, water leakages, faulty streetlights), track resolution workflows in real time, and hold public authorities accountable with transparent department-level routing.

---

## 🌟 Key Features

### 👤 Citizen Portal
- **One-Click Problem Reporting:** Instant filing with category, severity, description, location tagging, and image uploads.
- **Real-Time Complaint Tracking:** Public and private complaint status timeline tracking (`Submitted` ➔ `Under Review` ➔ `Assigned` ➔ `In Progress` ➔ `Resolved`).
- **Scope & Privacy Protection:** Role-isolated "My Reports" view with masked contact details in public tracking.
- **Social Sharing:** One-click sharing to WhatsApp and Twitter to rally neighborhood support.

### 🛡️ Authority & Admin Panel
- **Role-Based Access Control (RBAC):** Strict JWT-authenticated role management (`admin` vs `local_user`).
- **Complaint Workflow Management:** Filter by department, change resolution status, assign field teams, and add administrative resolution notes.
- **Data Analytics & Export:** Real-time city grievance statistics and one-click CSV export.

### 📞 Civic Helplines & Direct Communication
- **Emergency Calling Hub:** Direct click-to-call integration for national emergency (`112`), municipal corporation (`1916`), electricity (`1912`), and ambulance (`108`).
- **Floating 24/7 Support:** Quick-access floating Call and WhatsApp assistance buttons.
- **Web3Forms Contact Integration:** Direct asynchronous inquiry routing to developer support with spam botcheck honeypot.

### 📱 Responsive & Accessible UI
- **Animated Mobile Hamburger Menu:** Smooth morphing toggle with full slide-out glassmorphic navigation drawer.
- **Multi-Palette Theming:** Cyber Azure, Emerald Eco, Neon Indigo, and Sunset Amber themes with Dark/Light mode switching.
- **SEO & Social Cards:** Comprehensive Open Graph, Twitter cards, JSON-LD Schema markup, and canonical tags.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | Semantic HTML5, Vanilla CSS3 (Custom Glassmorphism Design System), JavaScript (ES6+) |
| **Backend** | Node.js, Express.js REST API |
| **Database** | MongoDB Atlas (Cloud NoSQL), Mongoose ODM |
| **Authentication** | JSON Web Tokens (JWT), bcryptjs password hashing |
| **File Storage** | Multer disk storage (with auto-directory creation & mime verification) |
| **Inquiry Delivery** | Web3Forms API |

---

## 📁 Project Structure

```text
nagarmitra/
├── index.html                 # Main single-page application interface
├── style.css                  # Core design tokens, theme system & responsive styles
├── script.js                  # Frontend client logic & REST API integration
├── privacy.html               # Privacy Policy
├── terms.html                 # Terms & Conditions
├── 404.html                   # Custom 404 Error page
├── sitemap.xml                # SEO Sitemap
├── robots.txt                 # Search engine crawler directives
├── logo.png                   # Portal brand logo
├── MINE PHOTO.jpeg            # Developer profile photo
├── package.json               # Root Node.js orchestration script
│
├── backend/
│   ├── config/
│   │   └── db.js              # Resilient MongoDB Atlas connector with exponential backoff
│   ├── controllers/
│   │   ├── authController.js       # User registration, login & session restoration
│   │   ├── complaintController.js  # Complaint CRUD & filtering
│   │   └── statsController.js      # Public municipal grievance statistics
│   ├── middleware/
│   │   ├── authMiddleware.js       # JWT validation & role verification
│   │   └── uploadMiddleware.js     # Image upload filtering & size limits
│   ├── models/
│   │   ├── Complaint.js       # Complaint schema & status history
│   │   └── User.js            # User authentication & role schema
│   ├── routes/                # Express API route declarations
│   ├── uploads/               # Uploaded complaint proof media
│   ├── package.json           # Backend dependencies & test scripts
│   ├── server.js              # Express application bootstrapper & static server
│   ├── seedAdmin.js           # Admin seeding and password reset utility
│   └── verifyAll.js           # Comprehensive 11-step end-to-end test suite
```

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- [MongoDB Atlas](https://www.mongodb.com/atlas) account (or local MongoDB)

### 1. Clone Repository
```bash
git clone https://github.com/Farooqui-codes/nagarmitra.git
cd nagarmitra
```

### 2. Install Dependencies
```bash
# Install backend dependencies
cd backend
npm install
```

### 3. Configure Environment Variables
Create a `.env` file inside the `backend/` directory (or workspace root):
```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
ADMIN_EMAIL=admin@problemx.com
ADMIN_PASSWORD=YourAdminPassword123!
NODE_ENV=development
```

### 4. Run Automated Verification Tests
```bash
npm test
```
*Validates database connection, user registration, role isolation, complaint tracking, and administrative capabilities.*

### 5. Start Application
```bash
# Start backend and serve frontend
npm start
```
Open **`http://localhost:5000`** in your browser.

---

## 🌐 Production Deployment

### Option A: Fullstack on Render / Railway (Recommended)
Because the Express server serves both the REST API and the frontend website, you can host the entire portal as a single web service:
1. Create a **New Web Service** on [Render](https://render.com/) or [Railway](https://railway.app/).
2. Connect your GitHub repository.
3. Configure settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add your Environment Variables (`MONGO_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NODE_ENV=production`) in the dashboard.
5. Deploy!

### Option B: Decoupled (Vercel/Netlify Frontend + Render Backend)
- Deploy `backend/` to Render.
- Set `<meta name="nagarmitra-api-url" content="https://your-backend.onrender.com">` in `index.html`.
- Deploy the static frontend to Vercel, Netlify, or GitHub Pages.

---

## 👨‍💻 Developer Profile

**Umair Farooqui**  
*Full Stack Developer*  
- **Email:** [fmdumair07@gmail.com](mailto:fmdumair07@gmail.com)  
- **Phone:** [+91 90049 20733](tel:+919004920733)  
- **WhatsApp:** [Chat on WhatsApp](https://wa.me/919004920733)  
- **Instagram:** [@umair___073](https://www.instagram.com/umair___073?psln=MTdiYjRwZDRyczdrYw==)  
- **Facebook:** [Umair Farooqui](https://www.facebook.com/profile.php?id=61561042082791)

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
