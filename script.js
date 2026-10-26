/* =====================================================
   NagarMitra – Smart City Complaint Management System
   Powered by Node.js & MongoDB REST API (with local fallback)
===================================================== */

/* =========================
   CONFIG & API CONFIG
========================= */
const CONFIG = {
  MAX_IMAGE_SIZE: 1000000,
  DRAFT_KEY: 'nagarMitraDraft'
}

/* =========================
   UTM TRACKING
========================= */
function captureUTM () {
  const params = new URLSearchParams(window.location.search)
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
  const utm = {}
  let hasUTM = false
  utmKeys.forEach(k => {
    if (params.has(k)) {
      utm[k] = params.get(k)
      hasUTM = true
    }
  })
  if (hasUTM) {
    utm._captured = new Date().toISOString()
    utm._landingPath = window.location.pathname
    localStorage.setItem('problemXUTM', JSON.stringify(utm))
  }
}

function getStoredUTM () {
  try {
    return JSON.parse(localStorage.getItem('problemXUTM')) || null
  } catch { return null }
}

function resolveApiBase () {
  // 1. Stored runtime override
  const stored = localStorage.getItem('nagarMitraApiUrl') || localStorage.getItem('problemXApiUrl')
  if (stored) return stored.replace(/\/$/, '') + '/api'

  // 2. Meta tag override (<meta name="nagarmitra-api-url" content="https://...">)
  const meta = document.querySelector('meta[name="nagarmitra-api-url"]') || document.querySelector('meta[name="problemx-api-url"]')
  if (meta && meta.content && meta.content.trim()) {
    return meta.content.trim().replace(/\/$/, '') + '/api'
  }

  // 3. Global window config
  if (typeof window !== 'undefined' && (window.NAGAR_MITRA_API_URL || window.PROBLEM_X_API_URL)) {
    return (window.NAGAR_MITRA_API_URL || window.PROBLEM_X_API_URL).replace(/\/$/, '') + '/api'
  }

  // 4. Localhost / Local Development
  const hostname = window.location.hostname
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === ''
  if (isLocal) {
    if (window.location.port === '5000') {
      return `${window.location.origin}/api`
    }
    return 'http://localhost:5000/api'
  }

  // 5. Cloud Static Hosting platforms (GitHub Pages, Netlify, Vercel, Cloudflare Pages)
  const isStaticPlatform = hostname.endsWith('github.io') ||
                           hostname.endsWith('netlify.app') ||
                           hostname.endsWith('vercel.app') ||
                           hostname.endsWith('pages.dev') ||
                           hostname.endsWith('firebaseapp.com') ||
                           hostname.endsWith('web.app')

  if (isStaticPlatform) {
    const defaultCloudBackend = 'https://nagarmitra-backend.onrender.com'
    return `${defaultCloudBackend}/api`
  }

  // 6. Fullstack Cloud Deployment (e.g. Render, Railway, VPS, or Custom Domain serving frontend + backend)
  return `${window.location.origin}/api`
}

const API_BASE = resolveApiBase()

function getFullImageUrl (url) {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url
  }
  const backendOrigin = API_BASE.replace(/\/api$/, '')
  return `${backendOrigin}${url.startsWith('/') ? '' : '/'}${url}`
}

const STATUSES = [
  'Submitted',
  'Under Review',
  'Assigned',
  'In Progress',
  'Resolved',
  'Closed'
]

/* =========================
   API CLIENT & HEALTHCHECK
========================= */
async function apiFetch (endpoint, options = {}, retries = 0) {
  // Check client network connectivity
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      success: false,
      networkError: true,
      errorType: 'CLIENT_OFFLINE',
      message: 'Network offline. Please check your internet connection.'
    }
  }

  const token = localStorage.getItem('problemXToken')
  const headers = { ...(options.headers || {}) }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  if (!options.isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  const fetchOptions = {
    ...options,
    headers
  }
  delete fetchOptions.isFormData

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, fetchOptions)
    const data = await res.json().catch(() => null)

    if (!res.ok) {
      // 503: Database / Service unavailable
      if (res.status === 503) {
        return {
          success: false,
          status: 503,
          dbOffline: true,
          errorType: 'DATABASE_UNAVAILABLE',
          message: (data && data.message) || 'Database service is currently unavailable. Please try again shortly.',
          data
        }
      }

      // 401: Unauthorized / expired token
      if (res.status === 401) {
        return {
          success: false,
          status: 401,
          authError: true,
          errorType: 'UNAUTHORIZED',
          message: (data && data.message) || 'Authentication required or session expired.',
          data
        }
      }

      // 403: Forbidden
      if (res.status === 403) {
        return {
          success: false,
          status: 403,
          forbidden: true,
          errorType: 'FORBIDDEN',
          message: (data && data.message) || 'Access denied: You do not have permission for this action.',
          data
        }
      }

      return {
        success: false,
        status: res.status,
        message: (data && data.message) || `Error ${res.status}`,
        data
      }
    }

    return { success: true, status: res.status, ...(data || {}) }
  } catch (err) {
    // Retry up to 2 times for idempotent GET requests on transient network glitches
    const method = (options.method || 'GET').toUpperCase()
    if (method === 'GET' && retries < 2) {
      await new Promise(r => setTimeout(r, (retries + 1) * 500))
      return apiFetch(endpoint, options, retries + 1)
    }

    // Backend unreachable / connection refused
    return {
      success: false,
      offline: true,
      backendOffline: true,
      errorType: 'BACKEND_OFFLINE',
      message: 'Backend server is currently unreachable. Please make sure the backend is running.'
    }
  }
}

async function checkBackendHealth () {
  const badge = document.getElementById('serverStatusBadge')
  const text = document.getElementById('serverStatusText')

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (badge) badge.className = 'server-status-badge offline'
    if (text) text.textContent = 'Network: Disconnected (No Internet)'
    return { online: false, reason: 'network_offline' }
  }

  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' })
    const data = await res.json().catch(() => null)

    if (res.ok && data && data.success) {
      if (badge) {
        badge.className = 'server-status-badge online'
        badge.title = 'Node.js Express & MongoDB Atlas are running smoothly!'
      }
      if (text) text.textContent = 'System: Online (Node.js & MongoDB)'
      return { online: true, dbConnected: true }
    } else if (res.status === 503 || (data && data.database && data.database.status === 'disconnected')) {
      if (badge) {
        badge.className = 'server-status-badge warning'
        badge.title = 'Backend is running, but MongoDB connection is currently down.'
      }
      if (text) text.textContent = 'Backend: Online | MongoDB: Offline'
      return { online: true, dbConnected: false }
    }
  } catch (e) {
    // Offline fetch error
  }

  if (badge) {
    badge.className = 'server-status-badge offline'
    badge.title = `Backend server is not running on ${API_BASE}.`
  }
  if (text) text.textContent = 'Backend: Offline (Server Down)'
  return { online: false, dbConnected: false }
}

function normalizeComplaint (c) {
  if (!c) return c
  const id =
    c.complaintId ||
    c.id ||
    `PRB-${c._id ? c._id.slice(-4) : Date.now().toString().slice(-4)}`
  return {
    ...c,
    id: id,
    complaintId: id,
    category: c.category || 'General',
    description: c.description || '',
    location: c.location || '',
    severity: c.severity || 'Medium',
    department: c.department || 'Municipal Corporation',
    status: c.status || 'Submitted',
    upvotes: c.upvotes || 0,
    image: getFullImageUrl(c.imageUrl || c.image || ''),
    user: c.citizenEmail || c.user || '',
    userName: c.citizenName || c.userName || 'Anonymous Citizen',
    createdAt: c.createdAt
      ? new Date(c.createdAt).toLocaleDateString()
      : new Date().toLocaleDateString(),
    history: c.statusHistory ||
      c.history || [
        { status: c.status || 'Submitted', date: new Date().toLocaleDateString() }
      ]
  }
}

/* =========================
   UTILITIES
========================= */
function escapeHTML (str) {
  if (str === null || str === undefined) return ''
  return String(str).replace(
    /[&<>"']/g,
    m =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m])
  )
}

function safeStorage (key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key))
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      showToast('Storage full! Some features may not work.', 'error')
    }
    return null
  }
}

/* =========================
   PAGE NAVIGATION
========================= */
function showPage (pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  const page = document.getElementById(pageId)
  if (page) page.classList.add('active')

  // Sync active navigation link (desktop + mobile)
  document.querySelectorAll('.nav-links a, .mobile-menu a, .mobile-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('data-page') === pageId)
  })

  // Auto-close mobile drawer on navigation
  closeMobileMenu()

  // Update document title per page
  const titles = {
    home: 'NagarMitra | Smart City Complaint Management',
    report: 'Report a Problem | NagarMitra',
    track: 'Track Complaint | NagarMitra',
    myComplaints: 'My Reports | NagarMitra',
    admin: 'Admin Panel | NagarMitra',
    login: 'Login | NagarMitra',
    register: 'Register | NagarMitra'
  }
  document.title = titles[pageId] || 'NagarMitra – Smart City Complaint Management System'

  window.scrollTo({ top: 0, behavior: 'smooth' })

  if (pageId === 'admin') {
    const user = safeStorage('problemXCurrentUser')
    if (!user || user.role !== 'admin') {
      showToast('Access denied: Administrator privileges required.', 'error')
      showPage('login')
      return
    }
    loadAdminDashboard()
  }
  if (pageId === 'myComplaints') loadMyComplaints()
  if (pageId === 'home') loadHeroStats()

  if (pageId === 'report') {
    const user = safeStorage('problemXCurrentUser')
    if (!user) {
      showToast('Please login first to report a problem', 'error')
      setTimeout(() => showPage('login'), 800)
      return
    }
    loadDraft()
  }
}

/* =========================
   MOBILE MENU (HAMBURGER TOGGLE)
========================= */
function toggleMobileMenu () {
  const menu = document.getElementById('mobileMenu')
  const overlay = document.getElementById('mobileMenuOverlay')
  const btn = document.getElementById('hamburgerBtn')
  if (!menu) return

  const isOpen = menu.classList.contains('open')
  if (isOpen) {
    closeMobileMenu()
  } else {
    menu.classList.add('open')
    if (overlay) overlay.classList.add('open')
    if (btn) {
      btn.setAttribute('aria-expanded', 'true')
      btn.classList.add('active')
    }
    document.body.style.overflow = 'hidden'
  }
}

function closeMobileMenu () {
  const menu = document.getElementById('mobileMenu')
  const overlay = document.getElementById('mobileMenuOverlay')
  const btn = document.getElementById('hamburgerBtn')
  if (!menu) return

  menu.classList.remove('open')
  if (overlay) overlay.classList.remove('open')
  if (btn) {
    btn.setAttribute('aria-expanded', 'false')
    btn.classList.remove('active')
  }
  document.body.style.overflow = ''
}

// Close mobile menu on Escape key press
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileMenu()
  })
}

function goToReport () {
  const user = safeStorage('problemXCurrentUser')
  if (!user) {
    showToast('Please login to report a problem', 'error')
    showPage('login')
    return
  }
  showPage('report')
}

function goToTrack () {
  showPage('track')
}

function goToMyComplaints () {
  const user = safeStorage('problemXCurrentUser')
  if (!user) {
    showToast('Please login to view your reports', 'error')
    showPage('login')
    return
  }
  showPage('myComplaints')
}

function goToAdmin () {
  const user = safeStorage('problemXCurrentUser')
  if (!user || user.role !== 'admin') {
    showToast('Admin access required. Please login as admin.', 'error')
    showPage('login')
    return
  }
  showPage('admin')
}

function goToHomeTop () {
  showPage('home')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function quickReport (category) {
  const user = safeStorage('problemXCurrentUser')
  if (!user) {
    showToast('Please login to report a problem', 'error')
    showPage('login')
    return
  }
  showPage('report')
  setTimeout(() => {
    document.getElementById('category').value = category
    showToast(`Category set to "${category}"`, 'info')
  }, 300)
}

/* =========================
   THEME & PALETTE TOGGLE
========================= */
function toggleTheme () {
  const body = document.body
  const current = body.getAttribute('data-theme')
  const newTheme = current === 'dark' ? 'light' : 'dark'

  body.setAttribute('data-theme', newTheme)
  localStorage.setItem('problemXTheme', newTheme)
  applyThemeIcon(newTheme)
}

/** Apply the correct moon/sun icon to ALL theme toggle buttons currently in DOM */
function applyThemeIcon (theme) {
  document.querySelectorAll('#themeIcon').forEach(icon => {
    icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun'
  })
}

function loadTheme () {
  const saved = localStorage.getItem('problemXTheme') || 'dark'
  document.body.setAttribute('data-theme', saved)
  applyThemeIcon(saved)
  loadPalette()
}

function togglePaletteMenu (e) {
  if (e) e.stopPropagation()
  const menu = document.getElementById('paletteMenu')
  if (menu) menu.classList.toggle('show')
}

function setPalette (name) {
  document.body.setAttribute('data-palette', name)
  localStorage.setItem('problemXPalette', name)
  document.querySelectorAll('.palette-opt').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-p') === name)
  })
  const menu = document.getElementById('paletteMenu')
  if (menu) menu.classList.remove('show')
}

function loadPalette () {
  const saved = localStorage.getItem('problemXPalette') || 'azure'
  document.body.setAttribute('data-palette', saved)
  document.querySelectorAll('.palette-opt').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-p') === saved)
  })
}

// Close palette menu on outside click
document.addEventListener('click', e => {
  const wrapper = document.querySelector('.palette-dropdown-wrapper')
  const menu = document.getElementById('paletteMenu')
  if (menu && wrapper && !wrapper.contains(e.target)) {
    menu.classList.remove('show')
  }
})

/* =========================
   TOAST
========================= */
function showToast (message, type = 'info') {
  const container = document.getElementById('toastContainer')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  const icons = {
    info: 'fa-info-circle',
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle'
  }
  toast.innerHTML = `<i class="fas ${
    icons[type] || icons.info
  }"></i> <span>${escapeHTML(message)}</span>`
  container.appendChild(toast)

  setTimeout(() => toast.classList.add('show'), 10)
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 400)
  }, 3200)
}

/* =========================
   MODAL
========================= */
function openModal (html) {
  document.getElementById('modalBox').innerHTML = html
  document.getElementById('modalOverlay').classList.add('active')
}

function closeModal (e) {
  if (e && e.target.id !== 'modalOverlay' && e.target.id !== 'modalBox') return
  document.getElementById('modalOverlay').classList.remove('active')
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal({ target: { id: 'modalOverlay' } })
    closeLightbox()
  }
})

/* =========================
   LIGHTBOX
========================= */
function openLightbox (src) {
  document.getElementById('lightboxImg').src = src
  document.getElementById('lightbox').classList.add('active')
}

function closeLightbox () {
  document.getElementById('lightbox').classList.remove('active')
}

/* =========================
   USERS — Register / Login (API + Local)
========================= */
function getUsers () {
  return safeStorage('problemXUsers') || []
}

async function registerUser (event) {
  event.preventDefault()

  const nameInput = document.getElementById('registerName')
  const emailInput = document.getElementById('registerEmail')
  const passwordInput = document.getElementById('registerPassword')

  const name = nameInput ? nameInput.value.trim() : ''
  const email = emailInput ? emailInput.value.trim().toLowerCase() : ''
  const password = passwordInput ? passwordInput.value : ''

  if (!name || !email || !password) {
    showToast('Please fill all required fields!', 'error')
    return
  }

  if (password.length < 4) {
    showToast('Password must be at least 4 characters', 'error')
    return
  }

  // 1. Submit Registration to Backend API
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password })
  })

  if (res && res.success && res.user) {
    if (res.token) localStorage.setItem('problemXToken', res.token)
    safeStorage('problemXCurrentUser', res.user)
    showToast(`Account created! Welcome, ${res.user.name}.`, 'success')
    updateAuthUI()
    const regForm = document.querySelector('#register form')
    if (regForm) regForm.reset()
    setTimeout(() => showPage('home'), 600)
    return
  }

  if (res && res.dbOffline) {
    showToast('Database is currently offline. User registration cannot be completed right now.', 'error')
    return
  }

  if (res && res.backendOffline) {
    showToast('Backend server is unreachable. Please ensure the backend is running.', 'error')
    return
  }

  showToast((res && res.message) || 'Registration failed!', 'error')
}

async function loginUser (event) {
  event.preventDefault()

  const emailInput = document.getElementById('loginEmail')
  const passwordInput = document.getElementById('loginPassword')

  const email = emailInput ? emailInput.value.trim().toLowerCase() : ''
  const password = passwordInput ? passwordInput.value : ''

  if (!email || !password) {
    showToast('Please fill in both email and password', 'error')
    return
  }

  // 1. Authenticate with Backend API
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })

  if (res && res.success && res.token && res.user) {
    localStorage.setItem('problemXToken', res.token)
    safeStorage('problemXCurrentUser', res.user)
    showToast(`Welcome back, ${res.user.name}!`, 'success')
    updateAuthUI()
    const loginForm = document.querySelector('#login form')
    if (loginForm) loginForm.reset()

    setTimeout(() => {
      if (res.user.role === 'admin') showPage('admin')
      else showPage('home')
    }, 400)
    return
  }

  if (res && res.dbOffline) {
    showToast('Database is currently offline. Unable to sign in right now.', 'error')
    return
  }

  if (res && res.backendOffline) {
    showToast('Backend server is unreachable. Please verify backend is running on http://localhost:5000.', 'error')
    return
  }

  showToast((res && res.message) || 'Invalid email or password!', 'error')
}

function logoutUser () {
  localStorage.removeItem('problemXToken')
  safeStorage('problemXCurrentUser', null)
  localStorage.removeItem('problemXCurrentUser')
  showToast('Logged out successfully', 'success')
  updateAuthUI()
  showPage('home')
}

async function verifySession () {
  const token = localStorage.getItem('problemXToken')
  if (!token) {
    safeStorage('problemXCurrentUser', null)
    updateAuthUI()
    return null
  }

  const res = await apiFetch('/auth/me')
  if (res && res.success && res.user) {
    safeStorage('problemXCurrentUser', res.user)
    updateAuthUI()
    return res.user
  } else if (res && res.authError) {
    // Session token expired or invalid
    localStorage.removeItem('problemXToken')
    safeStorage('problemXCurrentUser', null)
    updateAuthUI()
    showToast('Your session has expired. Please sign in again.', 'info')
    return null
  } else if (res && (res.backendOffline || res.dbOffline)) {
    // Keep local identity displayed during temporary network or DB interruption
    updateAuthUI()
    return safeStorage('problemXCurrentUser')
  }

  return null
}

function updateAuthUI () {
  const user = safeStorage('problemXCurrentUser')
  const navActions = document.getElementById('navActions')

  // Enforce Navigation Item visibility based on verified role
  const isAdmin = user && user.role === 'admin'
  const isLoggedIn = !!user

  const adminNavs = document.querySelectorAll('#navLinkAdmin, #mobileNavLinkAdmin')
  adminNavs.forEach(el => {
    el.style.display = isAdmin ? '' : 'none'
  })

  const myReportNavs = document.querySelectorAll('#navLinkMyReports, #mobileNavLinkMyReports')
  myReportNavs.forEach(el => {
    el.style.display = isLoggedIn ? '' : 'none'
  })

  if (!navActions) return

  const themeControls = `
        <div class="palette-dropdown-wrapper">
          <button class="theme-toggle palette-btn" onclick="togglePaletteMenu(event)" title="Change accent color">
            <i class="fas fa-palette"></i>
          </button>
          <div class="palette-menu" id="paletteMenu">
            <span class="palette-menu-title">Accent Color</span>
            <div class="palette-options">
              <button class="palette-opt active" data-p="azure" onclick="setPalette('azure')" title="Cyber Azure">
                <span class="palette-dot" style="background: linear-gradient(135deg, #0284c7, #00d2ff);"></span>
                <span>Azure (Default)</span>
              </button>
              <button class="palette-opt" data-p="emerald" onclick="setPalette('emerald')" title="Emerald Eco">
                <span class="palette-dot" style="background: linear-gradient(135deg, #059669, #34d399);"></span>
                <span>Emerald</span>
              </button>
              <button class="palette-opt" data-p="indigo" onclick="setPalette('indigo')" title="Neon Indigo">
                <span class="palette-dot" style="background: linear-gradient(135deg, #4f46e5, #818cf8);"></span>
                <span>Indigo</span>
              </button>
              <button class="palette-opt" data-p="sunset" onclick="setPalette('sunset')" title="Sunset Amber">
                <span class="palette-dot" style="background: linear-gradient(135deg, #ea580c, #fb923c);"></span>
                <span>Sunset</span>
              </button>
            </div>
          </div>
        </div>
        <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">
            <i class="fas fa-moon" id="themeIcon"></i>
        </button>`

  const mobileAuth = document.getElementById('mobileAuthActions')

  if (user) {
    const roleBadge = isAdmin
      ? '<span style="font-size:10px;background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 6px;border-radius:99px;margin-left:6px;border:1px solid rgba(239,68,68,0.4);">Admin</span>'
      : '<span style="font-size:10px;background:rgba(14,165,233,0.15);color:#7dd3fc;padding:2px 6px;border-radius:99px;margin-left:6px;border:1px solid rgba(14,165,233,0.3);">User</span>'

    navActions.innerHTML = `
            ${themeControls}
            <div class="user-chip">
                <i class="fas ${isAdmin ? 'fa-user-shield' : 'fa-user-circle'}"></i>
                <span>${escapeHTML(user.name)}</span>
                ${roleBadge}
            </div>
            <button class="nav-btn danger" onclick="logoutUser()">
                <i class="fas fa-sign-out-alt"></i> Logout
            </button>`

    if (mobileAuth) {
      mobileAuth.innerHTML = `
            <div class="user-chip" style="justify-content:center;margin-bottom:8px;padding:9px 14px;">
                <i class="fas ${isAdmin ? 'fa-user-shield' : 'fa-user-circle'}"></i>
                <span>${escapeHTML(user.name)}</span>
                ${roleBadge}
            </div>
            <button class="nav-btn danger full" onclick="logoutUser(); closeMobileMenu();" style="width:100%;justify-content:center;padding:10px;">
                <i class="fas fa-sign-out-alt"></i> Logout
            </button>`
    }
  } else {
    navActions.innerHTML = `
            ${themeControls}
            <button class="nav-btn" onclick="showPage('login')">Login</button>
            <button class="nav-btn primary" onclick="showPage('register')">Register</button>`

    if (mobileAuth) {
      mobileAuth.innerHTML = `
            <button class="nav-btn full" onclick="showPage('login'); closeMobileMenu();" style="width:100%;justify-content:center;margin-bottom:8px;padding:10px;">
                <i class="fas fa-sign-in-alt"></i> Login
            </button>
            <button class="nav-btn primary full" onclick="showPage('register'); closeMobileMenu();" style="width:100%;justify-content:center;padding:10px;">
                <i class="fas fa-user-plus"></i> Register
            </button>`
    }
  }

  const saved = localStorage.getItem('problemXTheme') || 'dark'
  applyThemeIcon(saved)
  loadPalette()
}

/* =========================
   HERO STATS (Live from API)
========================= */
async function loadHeroStats () {
  // 1. Try fetching from Backend API
  const res = await apiFetch('/stats')
  if (res && res.success && res.data) {
    const t = document.getElementById('heroTotal')
    const r = document.getElementById('heroResolved')
    const p = document.getElementById('heroPending')
    if (t) t.textContent = res.data.total
    if (r) r.textContent = res.data.resolved
    if (p) p.textContent = res.data.pending
    return
  }

  // 2. Fallback to Local Storage
  const complaints = getComplaints()
  const total = complaints.length
  const resolved = complaints.filter(
    c => c.status === 'Resolved' || c.status === 'Closed'
  ).length
  const pending = total - resolved

  const t = document.getElementById('heroTotal')
  const r = document.getElementById('heroResolved')
  const p = document.getElementById('heroPending')
  if (t) t.textContent = total
  if (r) r.textContent = resolved
  if (p) p.textContent = pending
}

/* =========================
   IMAGE PREVIEW
========================= */
function previewImage (event) {
  const file = event.target.files[0]
  const preview = document.getElementById('imagePreview')
  preview.innerHTML = ''
  if (!file) return

  const reader = new FileReader()
  reader.onload = e => {
    const img = document.createElement('img')
    img.src = e.target.result
    img.onclick = () => openLightbox(e.target.result)
    preview.appendChild(img)
  }
  reader.readAsDataURL(file)
}

/* =========================
   LOCATION (Multi-Tier GPS & Network Fallback)
========================= */
async function reverseGeocodeCoords (lat, lon) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)
    if (res.ok) {
      const data = await res.json()
      const admin = (data.localityInfo && Array.isArray(data.localityInfo.administrative)) ? data.localityInfo.administrative : []

      // Extract fine-grained local administrative units (wards, zones, subdistricts)
      const localUnits = admin
        .filter(a => a.adminLevel && a.adminLevel >= 8 && a.name)
        .sort((a, b) => b.adminLevel - a.adminLevel)
        .map(a => a.name)

      const suburb = data.locality || ''
      const city = data.city || ''
      const state = data.principalSubdivision || ''
      const pincode = data.postcode || ''
      const country = data.countryName || 'India'

      const parts = [...localUnits.slice(0, 2), suburb, city, state, pincode, country].filter(Boolean)
      const unique = parts.filter((item, idx) => parts.findIndex(p => p.toLowerCase() === item.toLowerCase()) === idx)

      if (unique.length > 0) return unique.join(', ')
    }
  } catch (err) {
    console.warn('Reverse geocode error:', err)
  }
  return `Lat: ${Number(lat).toFixed(5)}, Lon: ${Number(lon).toFixed(5)}`
}

async function fetchNetworkLocationFallback () {
  try {
    const res = await fetch('https://ipwho.is/')
    if (res.ok) {
      const d = await res.json()
      if (d.success !== false) {
        const parts = [d.city, d.region, d.postal, d.country].filter(Boolean)
        const text = parts.join(', ')
        return {
          address: text || `${d.city || ''}, ${d.region || ''}`,
          lat: d.latitude,
          lon: d.longitude,
          source: 'Network'
        }
      }
    }
  } catch (e) {
    console.warn('Network location fallback failed:', e)
  }
  return null
}

function getLocation () {
  const coords = document.getElementById('coordinates')
  const locationInput = document.getElementById('location')
  const locationButton = document.querySelector('.location-btn')

  if (locationButton) {
    locationButton.disabled = true
    locationButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting location...'
  }
  if (coords) {
    coords.className = 'location-status-badge fetching'
    coords.innerHTML = '<i class="fas fa-satellite-dish fa-spin"></i> Requesting GPS / Device Location...'
  }

  const applyLocation = (resolvedAddress, infoText, isSuccess = true) => {
    if (locationInput && resolvedAddress) {
      locationInput.value = resolvedAddress
      saveDraft()
    }
    if (coords) {
      coords.className = isSuccess ? 'location-status-badge success' : 'location-status-badge warn'
      coords.innerHTML = `<i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-info-circle'}"></i> <strong>Location:</strong> ${escapeHTML(resolvedAddress)} <span class="loc-acc">(${escapeHTML(infoText)})</span>`
    }
    if (locationButton) {
      locationButton.disabled = false
      locationButton.innerHTML = '<i class="fas fa-crosshairs"></i> Use My Current Location'
    }
    showToast(isSuccess ? 'Location detected successfully!' : 'Approximate location detected', isSuccess ? 'success' : 'info')
  }

  const handleFallback = async (reason) => {
    if (coords) {
      coords.innerHTML = '<i class="fas fa-network-wired fa-spin"></i> Detecting network location fallback...'
    }
    const netLoc = await fetchNetworkLocationFallback()
    if (netLoc && netLoc.address) {
      let finalAddr = netLoc.address
      if (netLoc.lat && netLoc.lon) {
        const fine = await reverseGeocodeCoords(netLoc.lat, netLoc.lon)
        if (fine && !fine.startsWith('Lat:')) finalAddr = fine
      }
      applyLocation(finalAddr, 'Network detected — please refine street details', false)
    } else {
      if (coords) {
        coords.className = 'location-status-badge error'
        coords.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${escapeHTML(reason || 'Could not auto-detect location.')} Please enter address manually.`
      }
      if (locationButton) {
        locationButton.disabled = false
        locationButton.innerHTML = '<i class="fas fa-crosshairs"></i> Use My Current Location'
      }
      showToast('Could not fetch GPS. Please type address manually.', 'error')
    }
  }

  if (!navigator.geolocation) {
    handleFallback('Geolocation not supported by your browser.')
    return
  }

  // Tier 1: Fast High-Accuracy GPS (7s timeout)
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      const acc = Math.round(pos.coords.accuracy || 0)

      if (coords) {
        coords.innerHTML = `<i class="fas fa-map-pin fa-spin"></i> Resolving address (±${acc}m accuracy)...`
      }

      const address = await reverseGeocodeCoords(lat, lon)
      applyLocation(address, `GPS Accuracy: ±${acc}m`, true)
    },
    err => {
      console.warn('GPS initial attempt error code:', err.code, err.message)
      // Tier 2: Low-accuracy / Wi-Fi triangulation fallback
      if (err.code === 2 || err.code === 3) {
        navigator.geolocation.getCurrentPosition(
          async pos2 => {
            const lat = pos2.coords.latitude
            const lon = pos2.coords.longitude
            const acc = Math.round(pos2.coords.accuracy || 0)
            const address = await reverseGeocodeCoords(lat, lon)
            applyLocation(address, `Accuracy: ±${acc}m`, true)
          },
          () => {
            // Tier 3: Network IP Fallback
            handleFallback(err.code === 3 ? 'GPS request timed out.' : 'GPS signal unavailable.')
          },
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 }
        )
      } else {
        // Permission denied (code 1) -> Jump to Network Fallback
        handleFallback('Location permission denied.')
      }
    },
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
  )
}

/* =========================
   AUTO-SAVE DRAFT
========================= */
function saveDraft () {
  const draft = {
    category: document.getElementById('category')?.value || '',
    description: document.getElementById('description')?.value || '',
    location: document.getElementById('location')?.value || ''
  }
  safeStorage(CONFIG.DRAFT_KEY, draft)
}

function loadDraft () {
  const draft = safeStorage(CONFIG.DRAFT_KEY)
  if (!draft) return

  if (draft.category && document.getElementById('category')) {
    document.getElementById('category').value = draft.category
  }
  if (draft.description && document.getElementById('description')) {
    document.getElementById('description').value = draft.description
    updateCharCount()
  }
  if (draft.location && document.getElementById('location')) {
    document.getElementById('location').value = draft.location
  }
}

function clearDraft () {
  localStorage.removeItem(CONFIG.DRAFT_KEY)
}

function updateCharCount () {
  const desc = document.getElementById('description')
  const counter = document.getElementById('charCount')
  if (desc && counter) counter.textContent = desc.value.length
}

/* =========================
   COMPLAINTS DATA (Local Store)
========================= */
function getComplaints () {
  return safeStorage('problemXComplaints') || []
}
function saveComplaints (complaints) {
  safeStorage('problemXComplaints', complaints)
}

function generateComplaintId () {
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `PRB-${rand}`
}

/* =========================
   PROBLEM ASSESSMENT
========================= */
function assessProblem (category, description) {
  let severity = 'Medium'
  let department = 'Municipal Department'

  const text = (category + ' ' + description).toLowerCase()
  const highWords = [
    'danger',
    'accident',
    'major',
    'broken',
    'overflow',
    'fire',
    'critical',
    'huge',
    'emergency'
  ]

  if (highWords.some(w => text.includes(w))) severity = 'High'

  if (category.includes('Pothole') || category.includes('Road'))
    department = 'Public Works Department (PWD)'
  else if (category.includes('Garbage') || category.includes('Sanitation'))
    department = 'Municipal Sanitation Dept'
  else if (category.includes('Street Light') || category.includes('Electrical'))
    department = 'Electricity & Lighting Board'
  else if (category.includes('Water') || category.includes('Sewage'))
    department = 'Jal Board / Water Supply Division'
  else if (category.includes('Traffic'))
    department = 'Traffic & Transportation Authority'
  else if (category.includes('Park'))
    department = 'Horticulture & Parks Division'
  else department = 'Public Infrastructure Department'

  return { severity, department }
}

/* =========================
   SUBMIT COMPLAINT (API + Local)
========================= */
async function submitComplaint (event) {
  event.preventDefault()

  const currentUser = safeStorage('problemXCurrentUser')
  if (!currentUser) {
    showToast('Please login first!', 'error')
    showPage('login')
    return
  }

  const category = document.getElementById('category').value
  const description = document.getElementById('description').value.trim()
  const location = document.getElementById('location').value.trim()
  const imageInput = document.getElementById('problemImage')

  if (!category || !description || !location) {
    showToast('Please fill all required fields!', 'error')
    return
  }

  const submitBtn = document.getElementById('submitBtn')
  if (submitBtn) {
    submitBtn.disabled = true
    submitBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Submitting to Server...'
  }

  const analysis = assessProblem(category, description)

  // Read image if selected
  let fileDataUrl = null
  if (imageInput.files && imageInput.files.length > 0) {
    const file = imageInput.files[0]
    if (file.size < CONFIG.MAX_IMAGE_SIZE) {
      fileDataUrl = await new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = e => resolve(e.target.result)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })
    }
  }

  // Attach UTM data if available
  const utm = getStoredUTM()

  // 1. Submit to Backend API
  const backendRes = await apiFetch('/complaints', {
    method: 'POST',
    body: JSON.stringify({
      category,
      description,
      location,
      severity: analysis.severity,
      department: analysis.department,
      imageUrl: fileDataUrl,
      citizenName: currentUser.name,
      citizenEmail: currentUser.email,
      ...(utm ? { utm } : {})
    })
  })

  if (backendRes && backendRes.success && backendRes.data) {
    const createdComplaint = normalizeComplaint(backendRes.data)
    clearDraft()
    finishSubmission(createdComplaint)
    return
  }

  // Restore submit button state on failure
  if (submitBtn) {
    submitBtn.disabled = false
    submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Complaint'
  }

  // Preserve complaint draft in localStorage so user data is never lost
  saveDraft()

  if (backendRes && backendRes.dbOffline) {
    showToast('MongoDB is currently offline. Your complaint draft is safely preserved. Please submit again when database is online.', 'error')
    return
  }

  if (backendRes && backendRes.backendOffline) {
    showToast('Backend server is unreachable. Your complaint draft is safely preserved.', 'error')
    return
  }

  if (backendRes && backendRes.authError) {
    showToast('Session expired. Your draft is saved. Please sign in again.', 'error')
    showPage('login')
    return
  }

  showToast((backendRes && backendRes.message) || 'Failed to submit complaint. Your draft is preserved.', 'error')
}

function finishSubmission (complaint) {
  const submitBtn = document.getElementById('submitBtn')
  if (submitBtn) {
    submitBtn.disabled = false
    submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Complaint'
  }

  showToast('Complaint submitted successfully!', 'success')

  // Reset the form fields first
  document.querySelector('#report form').reset()
  document.getElementById('imagePreview').innerHTML = ''
  document.getElementById('coordinates').innerHTML = ''
  const counter = document.getElementById('charCount')
  if (counter) counter.textContent = '0'

  // Show inline success state inside the report section
  const id = complaint.id || complaint.complaintId
  const reportSection = document.getElementById('report')
  const successDiv = document.createElement('div')
  successDiv.className = 'form-success-state'
  successDiv.id = 'formSuccessState'
  successDiv.innerHTML = `
    <div class="form-success-icon">
      <i class="fas fa-circle-check"></i>
    </div>
    <h2>Complaint Submitted</h2>
    <p>Your complaint has been received and routed to the responsible department.</p>
    <div class="form-success-details">
      <div class="form-success-row">
        <span>Complaint ID</span>
        <strong id="successIdDisplay">${escapeHTML(id)}</strong>
      </div>
      <div class="form-success-row">
        <span>Category</span>
        <strong>${escapeHTML(complaint.category)}</strong>
      </div>
      <div class="form-success-row">
        <span>Severity</span>
        <strong>${escapeHTML(complaint.severity)}</strong>
      </div>
      <div class="form-success-row">
        <span>Department</span>
        <strong>${escapeHTML(complaint.department)}</strong>
      </div>
    </div>
    <p class="form-success-note">Save your Complaint ID to track progress.</p>
    <div class="form-success-actions">
      <button class="btn secondary" onclick="copySuccessId('${escapeHTML(id)}')"
        id="copySuccessIdBtn">
        <i class="fas fa-copy"></i> Copy ID
      </button>
      <button class="btn primary" onclick="goToTrackFromSuccess('${escapeHTML(id)}')">
        <i class="fas fa-search"></i> Track Complaint
      </button>
    </div>
    <button class="btn secondary full" style="margin-top:12px;"
      onclick="dismissFormSuccess()">
      <i class="fas fa-plus"></i> Submit Another
    </button>
  `

  // Insert before the report-layout div and scroll to it
  const reportLayout = reportSection.querySelector('.report-layout')
  reportLayout.style.display = 'none'
  reportSection.querySelector('.page-header').style.display = 'none'
  reportSection.insertBefore(successDiv, reportSection.firstChild)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function copySuccessId (id) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(id).then(() => {
      showToast('Complaint ID copied!', 'success')
      const btn = document.getElementById('copySuccessIdBtn')
      if (btn) {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!'
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy ID' }, 2000)
      }
    }).catch(() => {})
  }
}

function goToTrackFromSuccess (id) {
  dismissFormSuccess()
  document.getElementById('trackId').value = id
  showPage('track')
  trackComplaint()
}

function dismissFormSuccess () {
  const el = document.getElementById('formSuccessState')
  if (el) el.remove()
  const reportSection = document.getElementById('report')
  const layout = reportSection.querySelector('.report-layout')
  const header = reportSection.querySelector('.page-header')
  if (layout) layout.style.display = ''
  if (header) header.style.display = ''
}

function copyAndTrack (id) {
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(id)
      .then(() => {
        showToast('ID copied to clipboard!', 'success')
      })
      .catch(() => {})
  }
  closeModal({ target: { id: 'modalOverlay' } })
  document.getElementById('trackId').value = id
  showPage('track')
  trackComplaint()
}

/* =========================
   TRACK COMPLAINT (API + Local)
========================= */
async function trackComplaint () {
  const idInput = document.getElementById('trackId')
  const id = idInput ? idInput.value.trim() : ''
  const result = document.getElementById('trackResult')

  if (!id) {
    if (result)
      result.innerHTML = `<div class="track-card">Please enter a Complaint ID.</div>`
    return
  }

  if (result) {
    result.innerHTML = `<div class="track-card" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Searching database for ${escapeHTML(
      id
    )}...</div>`
  }

  // 1. Try fetching from Backend API
  let complaint = null
  const res = await apiFetch(`/complaints/${encodeURIComponent(id)}`)

  if (res && res.success && res.data) {
    complaint = normalizeComplaint(res.data)
  } else {
    // 2. Fallback to Local Storage
    const complaints = getComplaints()
    complaint = complaints.find(
      c =>
        (c.id || c.complaintId || '').toLowerCase() === id.toLowerCase()
    )
  }

  if (!complaint) {
    if (result) {
      result.innerHTML = `
            <div class="track-card" style="border-color:#ff7070;">
                <p style="color:#ff7070;"><i class="fas fa-times-circle"></i> Complaint not found with ID '${escapeHTML(
                  id
                )}'. Please check the ID.</p>
            </div>`
    }
    return
  }

  const currentIndex = STATUSES.indexOf(complaint.status)
  let statusHTML = ''
  STATUSES.forEach((status, i) => {
    let cls = ''
    if (i < currentIndex) cls = 'completed'
    if (i === currentIndex) cls = 'active'
    statusHTML += `
            <div class="status-item ${cls}">
                <div class="status-dot">${
                  i < currentIndex ? '<i class="fas fa-check"></i>' : i + 1
                }</div>
                <small>${escapeHTML(status)}</small>
            </div>`
  })

  const compId = complaint.id || complaint.complaintId

  result.innerHTML = `
        <div class="track-card">
            <p class="track-id"><i class="fas fa-hashtag"></i> ${escapeHTML(
              compId
            )}</p>
            <h2>${escapeHTML(complaint.category)}</h2>
            <p>${escapeHTML(complaint.description)}</p>
            <br>
            <p><i class="fas fa-map-marker-alt"></i> ${escapeHTML(
              complaint.location
            )}</p>
            <p><i class="fas fa-building"></i> ${escapeHTML(
              complaint.department || 'Municipal Department'
            )}</p>
            <p><i class="fas fa-exclamation-triangle"></i> Severity: <strong>${escapeHTML(
              complaint.severity || 'Medium'
            )}</strong></p>
            <p><i class="fas fa-calendar"></i> ${escapeHTML(
              complaint.createdAt
            )}</p>

            <div class="status-line">${statusHTML}</div>

            <p>Current Status: <strong style="color:var(--primary);">${escapeHTML(
              complaint.status
            )}</strong></p>
        </div>`

  loadUpvoteForComplaint(compId, result, complaint.upvotes || 0)
  loadOwnerActionsForComplaint(complaint, result)
}

/* =========================
   UPVOTE SYSTEM (API + Local)
========================= */
function loadUpvoteForComplaint (complaintId, container, count = 0) {
  const user = safeStorage('problemXCurrentUser')
  const upvotes = safeStorage('problemXUpvotes') || {}

  const voted =
    user && upvotes[user.email] && upvotes[user.email].includes(complaintId)

  const voteHTML = `
        <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
            <button class="btn secondary" onclick="toggleUpvote('${escapeHTML(
              complaintId
            )}')" style="gap:10px;">
                <i class="fas fa-arrow-up"></i> ${
                  voted ? 'Upvoted' : 'Upvote this issue'
                } (${count})
            </button>
            <p style="font-size:12px;color:#8395a9;margin-top:8px;">
                <i class="fas fa-info-circle"></i> More upvotes = Higher priority for municipal dispatch
            </p>
        </div>
    `
  const card = container.querySelector('.track-card')
  if (card) card.insertAdjacentHTML('beforeend', voteHTML)
}

async function toggleUpvote (complaintId) {
  const user = safeStorage('problemXCurrentUser')
  if (!user) {
    showToast('Please login to upvote', 'error')
    return
  }

  // 1. Call Backend API
  const res = await apiFetch(`/complaints/${encodeURIComponent(complaintId)}/upvote`, {
    method: 'POST',
    body: JSON.stringify({ email: user.email })
  })

  if (res && res.success) {
    showToast(res.message || 'Vote updated!', 'success')
    trackComplaint()
    return
  }

  // 2. Fallback to Local Storage
  const upvotes = safeStorage('problemXUpvotes') || {}
  const complaints = getComplaints()
  const complaint = complaints.find(
    c => (c.id || c.complaintId) === complaintId
  )
  if (!complaint) return

  if (!upvotes[user.email]) upvotes[user.email] = []
  const idx = upvotes[user.email].indexOf(complaintId)

  if (idx === -1) {
    upvotes[user.email].push(complaintId)
    complaint.upvotes = (complaint.upvotes || 0) + 1
    showToast('Upvote added!', 'success')
  } else {
    upvotes[user.email].splice(idx, 1)
    complaint.upvotes = Math.max(0, (complaint.upvotes || 0) - 1)
    showToast('Upvote removed', 'info')
  }

  safeStorage('problemXUpvotes', upvotes)
  saveComplaints(complaints)
  trackComplaint()
}

function loadOwnerActionsForComplaint (complaint, container) {
  const currentUser = safeStorage('problemXCurrentUser')
  if (!currentUser) return

  const compId = complaint.id || complaint.complaintId
  const isOwner =
    currentUser.role === 'admin' ||
    (complaint.user && currentUser.email && complaint.user.toLowerCase() === currentUser.email.toLowerCase()) ||
    (complaint.citizenEmail && currentUser.email && complaint.citizenEmail.toLowerCase() === currentUser.email.toLowerCase())

  if (!isOwner) return

  const ownerHTML = `
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <span style="font-size:12px;color:var(--text-dim);">
        <i class="fas ${currentUser.role === 'admin' ? 'fa-user-shield' : 'fa-user-check'}"></i>
        ${currentUser.role === 'admin' ? 'Administrator Options' : 'You submitted this complaint'}
      </span>
      <button class="delete-btn" onclick="confirmDeleteComplaint('${escapeHTML(compId)}', true)">
        <i class="fas fa-trash-alt"></i> Delete Complaint
      </button>
    </div>
  `
  const card = container.querySelector('.track-card')
  if (card) card.insertAdjacentHTML('beforeend', ownerHTML)
}

/* =========================
   DELETE COMPLAINT (API + Local)
========================= */
function confirmDeleteComplaint (id, redirectAfter = false) {
  openModal(`
        <div style="text-align:center;padding:10px 0;">
            <div style="width:60px;height:60px;border-radius:50%;background:rgba(244,63,94,0.15);color:var(--danger);display:grid;place-items:center;font-size:26px;margin:0 auto 16px;">
                <i class="fas fa-trash-alt"></i>
            </div>
            <h2 style="margin-bottom:8px;">Delete Complaint?</h2>
            <p style="color:var(--text-muted);font-size:14px;margin-bottom:20px;line-height:1.6;">
                Are you sure you want to delete complaint <strong style="color:var(--primary);">${escapeHTML(id)}</strong>?<br>
                This action cannot be undone.
            </p>
            <div style="display:flex;gap:12px;justify-content:center;">
                <button class="btn secondary" style="min-width:110px;" onclick="closeModal({target:{id:'modalOverlay'}})">
                    <i class="fas fa-times"></i> Cancel
                </button>
                <button class="danger-btn" id="confirmDeleteBtn" style="min-width:130px;" onclick="executeDeleteComplaint('${escapeHTML(id)}', ${redirectAfter})">
                    <i class="fas fa-trash-alt"></i> Yes, Delete
                </button>
            </div>
        </div>
    `)
}

async function executeDeleteComplaint (id, redirectAfter = false) {
  const btn = document.getElementById('confirmDeleteBtn')
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...'
  }

  // 1. Send DELETE request to Backend API
  const res = await apiFetch(`/complaints/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })

  // If backend responded with an error (e.g. 403 not authorized)
  if (res && !res.offline && !res.success) {
    closeModal({ target: { id: 'modalOverlay' } })
    showToast(res.message || 'Failed to delete complaint', 'error')
    return
  }

  // 2. Remove from Local Storage Cache
  const complaints = getComplaints()
  const filtered = complaints.filter(
    c =>
      (c.id || c.complaintId || '').toUpperCase() !== id.toUpperCase()
  )
  saveComplaints(filtered)

  // Clean up cached upvotes
  const upvotes = safeStorage('problemXUpvotes') || {}
  Object.keys(upvotes).forEach(user => {
    if (Array.isArray(upvotes[user])) {
      upvotes[user] = upvotes[user].filter(
        vId => vId.toUpperCase() !== id.toUpperCase()
      )
    }
  })
  safeStorage('problemXUpvotes', upvotes)

  closeModal({ target: { id: 'modalOverlay' } })
  showToast(
    (res && res.message) || 'Complaint deleted successfully!',
    'success'
  )

  // 3. Refresh relevant UI views
  loadMyComplaints()
  loadAdminDashboard()
  loadHeroStats()

  if (redirectAfter) {
    const trackResult = document.getElementById('trackResult')
    if (trackResult) {
      trackResult.innerHTML = `
        <div class="track-card" style="text-align:center;padding:35px 20px;">
          <i class="fas fa-check-circle" style="font-size:36px;color:var(--success);margin-bottom:12px;display:inline-block;"></i>
          <h3 style="margin-bottom:8px;">Complaint Deleted</h3>
          <p style="color:var(--text-muted);margin-bottom:18px;">Complaint <strong>${escapeHTML(id)}</strong> was successfully removed.</p>
          <button class="btn primary" onclick="goToMyComplaints()">
            <i class="fas fa-list-check"></i> Go to My Reports
          </button>
        </div>`
    }
  }
}

/* =========================
   MY COMPLAINTS (API + Local)
========================= */
async function loadMyComplaints () {
  const user = safeStorage('problemXCurrentUser')
  const container = document.getElementById('myComplaintsList')
  if (!user || !container) return

  container.innerHTML = `<div style="text-align:center;padding:30px;"><i class="fas fa-spinner fa-spin"></i> Loading your reports...</div>`

  let complaints = []

  // 1. Fetch complaints from Backend API
  const res = await apiFetch('/complaints')
  if (res && res.success && Array.isArray(res.data)) {
    complaints = res.data.map(normalizeComplaint)
  } else if (res && res.dbOffline) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-database" style="color:var(--warning, #f59e0b);font-size:32px;margin-bottom:12px;"></i>
        <p>Database is temporarily offline.</p>
        <p style="font-size:13px;color:var(--text-muted);">Your complaints in MongoDB cannot be loaded until the database is online.</p>
        <button class="btn primary" style="margin-top:12px;" onclick="loadMyComplaints()"><i class="fas fa-rotate"></i> Retry</button>
      </div>`
    return
  } else if (res && res.offline) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-server" style="color:var(--danger, #ef4444);font-size:32px;margin-bottom:12px;"></i>
        <p>Backend server is unreachable.</p>
        <p style="font-size:13px;color:var(--text-muted);">Please verify that the backend server is running.</p>
        <button class="btn primary" style="margin-top:12px;" onclick="loadMyComplaints()"><i class="fas fa-rotate"></i> Retry</button>
      </div>`
    return
  } else if (res && res.authError) {
    showToast('Please login to view your reports', 'info')
    showPage('login')
    return
  }

  if (complaints.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>You haven't submitted any complaints yet.</p>
                <p><a onclick="showPage('report')">Report your first problem →</a></p>
            </div>`
    return
  }

  container.innerHTML = complaints
    .map(
      c => `
        <div class="my-complaint-card">
            <div class="header">
                <span class="id"><i class="fas fa-hashtag"></i> ${escapeHTML(
                  c.id || c.complaintId
                )}</span>
                <span class="badge-status badge-${(c.status || '').replace(
                  /\s/g,
                  ''
                )}">${escapeHTML(c.status)}</span>
            </div>
            <h3>${escapeHTML(c.category)}</h3>
            <p>${escapeHTML((c.description || '').substring(0, 120))}${
        (c.description || '').length > 120 ? '...' : ''
      }</p>
            <p><i class="fas fa-map-marker-alt"></i> ${escapeHTML(
              c.location
            )}</p>
            <p style="font-size:12px;color:#6b7f95;">
                <i class="fas fa-calendar"></i> ${escapeHTML(c.createdAt)}
                ${
                  c.upvotes
                    ? ` • <i class="fas fa-arrow-up"></i> ${c.upvotes} upvotes`
                    : ''
                }
            </p>
            ${getLastUpdatedBadge(c)}
            <div class="complaint-card-actions">
                <button class="view-btn" onclick="trackSpecific('${escapeHTML(
                  c.id || c.complaintId
                )}')">
                    <i class="fas fa-eye"></i> View Details
                </button>
                <button class="delete-btn" onclick="confirmDeleteComplaint('${escapeHTML(
                  c.id || c.complaintId
                )}')">
                    <i class="fas fa-trash-alt"></i> Delete Complaint
                </button>
            </div>
        </div>
    `
    )
    .join('')
}

function trackSpecific (id) {
  showPage('track')
  document.getElementById('trackId').value = id
  setTimeout(() => trackComplaint(), 300)
}

/* =========================
   ADMIN DASHBOARD (API + Local)
========================= */
async function loadAdminDashboard () {
  const user = safeStorage('problemXCurrentUser')
  if (!user || user.role !== 'admin') {
    showToast('Administrator privileges required.', 'error')
    showPage('login')
    return
  }

  let complaints = []
  let stats = null

  // 1. Fetch from Backend API
  const compRes = await apiFetch('/complaints')
  const statsRes = await apiFetch('/stats')

  if (compRes && compRes.forbidden) {
    showToast('Access denied: You do not have administrator permissions.', 'error')
    showPage('home')
    return
  }

  if (compRes && compRes.dbOffline) {
    showToast('Database is offline. Unable to load admin complaints.', 'error')
  } else if (compRes && compRes.backendOffline) {
    showToast('Backend server is unreachable.', 'error')
  } else if (compRes && compRes.success && Array.isArray(compRes.data)) {
    complaints = compRes.data.map(normalizeComplaint)
    window._lastAdminComplaints = complaints
  }

  if (statsRes && statsRes.success && statsRes.data) {
    stats = statsRes.data
  }

  const total = stats ? stats.total : complaints.length
  const pending = stats
    ? stats.pending
    : complaints.filter(
        c => c.status !== 'Resolved' && c.status !== 'Closed'
      ).length
  const progress = stats
    ? stats.inProgress
    : complaints.filter(c => c.status === 'In Progress').length
  const resolved = stats
    ? stats.resolved
    : complaints.filter(
        c => c.status === 'Resolved' || c.status === 'Closed'
      ).length

  const totalEl = document.getElementById('totalComplaints')
  if (totalEl) totalEl.textContent = total
  const pendingEl = document.getElementById('pendingComplaints')
  if (pendingEl) pendingEl.textContent = pending
  const progressEl = document.getElementById('progressComplaints')
  if (progressEl) progressEl.textContent = progress
  const resolvedEl = document.getElementById('resolvedComplaints')
  if (resolvedEl) resolvedEl.textContent = resolved

  // Insights by category
  const insights = document.getElementById('adminInsights')
  if (insights) {
    const byCategory = {}
    complaints.forEach(c => {
      byCategory[c.category] = (byCategory[c.category] || 0) + 1
    })
    const topCats = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)

    insights.innerHTML = topCats
      .map(
        ([cat, count]) => `
            <div class="insight-pill">
                <span>${escapeHTML(cat)}</span>
                <strong>${count}</strong>
            </div>
        `
      )
      .join('')
  }

  renderAdminTable(complaints)
}

function renderAdminTable (complaints) {
  const table = document.getElementById('complaintTable')
  if (!table) return

  if (complaints.length === 0) {
    table.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <p>No complaints found.</p>
                        <p style="font-size:12px;color:#56687f;">Complaints will appear here once submitted.</p>
                    </div>
                </td>
            </tr>`
    return
  }

  table.innerHTML = complaints
    .map(
      c => `
        <tr>
            <td>
                ${escapeHTML(c.id || c.complaintId)}
                ${
                  c.image
                    ? '<i class="fas fa-image photo-indicator" title="Has photo"></i>'
                    : ''
                }
                ${
                  c.upvotes
                    ? `<br><small style="color:var(--primary);"><i class="fas fa-arrow-up"></i> ${c.upvotes}</small>`
                    : ''
                }
            </td>
            <td>${escapeHTML(c.category)}</td>
            <td>${escapeHTML(c.location)}</td>
            <td>${escapeHTML(c.severity)}</td>
            <td>${escapeHTML(c.department)}</td>
            <td>
                <div class="status-cell">
                    <span class="badge-status badge-${(c.status || '').replace(
                      /\s/g,
                      ''
                    )}">${escapeHTML(c.status)}</span>
                    <select class="status-select" onchange="updateStatus('${escapeHTML(
                      c.id || c.complaintId
                    )}', this.value)">
                        ${getStatusOptions(c.status)}
                    </select>
                </div>
            </td>
            <td>
                <div style="display:flex;gap:6px;align-items:center;">
                    <button class="view-btn" onclick="viewComplaint('${escapeHTML(
                      c.id || c.complaintId
                    )}')">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="delete-btn" title="Delete complaint" onclick="confirmDeleteComplaint('${escapeHTML(
                      c.id || c.complaintId
                    )}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        </tr>
    `
    )
    .join('')
}

function filterAdminTable () {
  const search = document.getElementById('adminSearch').value.toLowerCase()
  const filter = document.getElementById('adminFilter').value
  let complaints = window._lastAdminComplaints || getComplaints()

  if (search) {
    complaints = complaints.filter(
      c =>
        (c.id || c.complaintId || '').toLowerCase().includes(search) ||
        (c.location || '').toLowerCase().includes(search) ||
        (c.category || '').toLowerCase().includes(search)
    )
  }
  if (filter) {
    complaints = complaints.filter(c => c.status === filter)
  }

  renderAdminTable(complaints)
}

function getStatusOptions (current) {
  return STATUSES.map(
    s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`
  ).join('')
}

async function updateStatus (id, newStatus) {
  // 1. Call Backend API
  const res = await apiFetch(`/complaints/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: newStatus,
      note: `Status updated to ${newStatus} by municipal administrator.`
    })
  })

  if (res && res.success) {
    showToast(`Status updated to "${newStatus}" on Server!`, 'success')
  } else {
    // 2. Local Fallback
    const complaints = getComplaints()
    const c = complaints.find(x => (x.id || x.complaintId) === id)
    if (c) {
      c.status = newStatus
      if (!c.history) c.history = []
      c.history.push({ status: newStatus, date: new Date().toLocaleString() })
      saveComplaints(complaints)
      showToast(`Status updated to "${newStatus}"`, 'success')
    }
  }

  loadAdminDashboard()
}

function viewComplaint (id) {
  const complaints = window._lastAdminComplaints || getComplaints()
  const c = complaints.find(x => (x.id || x.complaintId) === id)
  if (!c) return

  const compId = c.id || c.complaintId
  const currentUser = safeStorage('problemXCurrentUser')
  const canDelete =
    currentUser &&
    (currentUser.role === 'admin' ||
      (c.user &&
        currentUser.email &&
        c.user.toLowerCase() === currentUser.email.toLowerCase()) ||
      (c.citizenEmail &&
        currentUser.email &&
        c.citizenEmail.toLowerCase() === currentUser.email.toLowerCase()))

  openModal(`
        <h2><i class="fas fa-file-alt"></i> Complaint Details</h2>
        <p><strong>ID:</strong> ${escapeHTML(compId)}</p>
        <p><strong>User:</strong> ${escapeHTML(c.userName || c.citizenName || c.user || 'Citizen')}</p>
        <p><strong>Category:</strong> ${escapeHTML(c.category)}</p>
        <p><strong>Description:</strong> ${escapeHTML(c.description)}</p>
        <p><strong>Location:</strong> ${escapeHTML(c.location)}</p>
        <p><strong>Severity:</strong> ${escapeHTML(c.severity)}</p>
        <p><strong>Department:</strong> ${escapeHTML(c.department)}</p>
        <p><strong>Status:</strong> ${escapeHTML(c.status)}</p>
        <p><strong>Upvotes:</strong> ${c.upvotes || 0}</p>
        <p><strong>Created:</strong> ${escapeHTML(c.createdAt)}</p>
        ${
          c.image
            ? `<img src="${c.image}" alt="Complaint Image" onclick="openLightbox('${c.image}')">`
            : ''
        }
        <div style="display:flex;gap:10px;margin-top:20px;">
            <button class="btn secondary full" onclick="closeModal({target:{id:'modalOverlay'}})">
                <i class="fas fa-times"></i> Close
            </button>
            ${
              canDelete
                ? `<button class="danger-btn full" onclick="confirmDeleteComplaint('${escapeHTML(compId)}')">
                    <i class="fas fa-trash-alt"></i> Delete Complaint
                   </button>`
                : ''
            }
        </div>
    `)
}

function clearComplaints () {
  openModal(`
    <div style="text-align:center;padding:10px 0;">
      <div style="width:60px;height:60px;border-radius:50%;background:rgba(245,158,11,0.15);color:var(--warning);display:grid;place-items:center;font-size:26px;margin:0 auto 16px;">
        <i class="fas fa-exclamation-triangle"></i>
      </div>
      <h2 style="margin-bottom:8px;">Clear Local Cache?</h2>
      <p style="color:var(--text-muted);font-size:14px;margin-bottom:20px;line-height:1.6;">
        This removes the local complaints cache from this browser.<br>
        <strong>Server data is not affected.</strong>
      </p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button class="btn secondary" style="min-width:110px;" onclick="closeModal({target:{id:'modalOverlay'}})">
          <i class="fas fa-times"></i> Cancel
        </button>
        <button class="btn primary" style="min-width:130px;" onclick="executeClearComplaints()">
          <i class="fas fa-trash"></i> Yes, Clear Cache
        </button>
      </div>
    </div>
  `)
}

function executeClearComplaints () {
  localStorage.removeItem('problemXComplaints')
  localStorage.removeItem('problemXUpvotes')
  closeModal({ target: { id: 'modalOverlay' } })
  loadAdminDashboard()
  showToast('Local complaints cache cleared', 'success')
}

/* =========================
   EXPORT CSV (API + Local)
========================= */
let isExportingCSV = false

async function exportCSV () {
  // Prevent duplicate clicks while an export is in progress
  if (isExportingCSV) {
    showToast('Export already in progress. Please wait...', 'info')
    return
  }

  // Security check: Only administrators can export admin complaints
  const currentUser = safeStorage('problemXCurrentUser')
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('Access denied: Administrator privileges required to export data.', 'error')
    return
  }

  const exportBtn = document.getElementById('btnExportCSV') || document.querySelector('.btn-export')
  const originalBtnHTML = exportBtn ? exportBtn.innerHTML : ''

  // Set loading state
  isExportingCSV = true
  if (exportBtn) {
    exportBtn.disabled = true
    exportBtn.style.opacity = '0.7'
    exportBtn.style.cursor = 'not-allowed'
    exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...'
  }

  showToast('Preparing complaint export...', 'info')

  const today = new Date().toISOString().slice(0, 10)
  const defaultFilename = `NagarMitra_Complaints_${today}.csv`

  try {
    // 1. Gather active dashboard filter parameters
    const searchInput = document.getElementById('adminSearch')
    const filterSelect = document.getElementById('adminFilter')
    const searchVal = searchInput ? searchInput.value.trim() : ''
    const filterVal = filterSelect ? filterSelect.value : ''

    const queryParams = new URLSearchParams()
    if (searchVal) queryParams.set('search', searchVal)
    if (filterVal) queryParams.set('status', filterVal)

    const token = localStorage.getItem('problemXToken')

    // 2. Try fetching full authenticated export from backend API
    const serverBadge = document.getElementById('serverStatusBadge')
    const isServerOnline = serverBadge && serverBadge.classList.contains('online')

    if (isServerOnline || token) {
      try {
        const url = `${API_BASE}/complaints/export/csv${queryParams.toString() ? '?' + queryParams.toString() : ''}`
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          }
        })

        if (res.status === 401 || res.status === 403) {
          showToast('Access denied: You do not have permission to export complaints.', 'error')
          return
        }

        if (res.status === 503) {
          showToast('Database is currently offline. Trying cached local export...', 'warning')
          throw new Error('Database offline')
        }

        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`)
        }

        // Get filename from header if present
        let filename = defaultFilename
        const disposition = res.headers.get('Content-Disposition')
        if (disposition && disposition.includes('filename=')) {
          const match = disposition.match(/filename=["']?([^"';]+)["']?/)
          if (match && match[1]) filename = match[1].trim()
        }

        const blob = await res.blob()
        if (blob.size === 0) {
          showToast('No complaints found to export.', 'warning')
          return
        }

        downloadBlob(blob, filename)
        showToast(`Exported ${filename} successfully!`, 'success')
        return
      } catch (apiErr) {
        console.warn('API CSV export failed, falling back to client-side generation:', apiErr)
      }
    }

    // 3. Fallback to client-side CSV generator (with full formatting, UTF-8 BOM, and formula injection protection)
    let complaints = window._lastAdminComplaints || getComplaints()
    if (searchVal) {
      const s = searchVal.toLowerCase()
      complaints = complaints.filter(
        c =>
          (c.id || c.complaintId || '').toLowerCase().includes(s) ||
          (c.location || '').toLowerCase().includes(s) ||
          (c.category || '').toLowerCase().includes(s)
      )
    }
    if (filterVal) {
      complaints = complaints.filter(c => c.status === filterVal)
    }

    if (!complaints || complaints.length === 0) {
      showToast('No complaints found matching the current view.', 'warning')
      return
    }

    const formatCell = val => {
      if (val === null || val === undefined) return '""'
      let str = String(val)
      // Protect against Spreadsheet Formula Injection (CSV Injection)
      if (/^[=\+\-@\t\r]/.test(str)) {
        str = "'" + str
      }
      return `"${str.replace(/"/g, '""')}"`
    }

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
    ]

    const rows = complaints.map(c => [
      c.id || c.complaintId || '',
      c.category || '',
      c.description || '',
      c.location || '',
      c.landmark || '',
      c.severity || 'Medium',
      c.department || '',
      c.status || 'Submitted',
      c.upvotes || 0,
      c.citizenName || c.userName || c.user || 'Anonymous Citizen',
      c.citizenEmail || c.email || '',
      c.citizenPhone || c.phone || '',
      c.remarks || c.statusNote || (c.statusHistory && c.statusHistory.length ? c.statusHistory[c.statusHistory.length - 1].note : '') || '',
      c.createdAt || ''
    ])

    const csvContent =
      headers.map(formatCell).join(',') +
      '\r\n' +
      rows.map(r => r.map(formatCell).join(',')).join('\r\n')

    // Include UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility with Indian languages
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    downloadBlob(blob, defaultFilename)
    showToast(`Exported ${defaultFilename} successfully!`, 'success')

  } catch (err) {
    console.error('Error exporting CSV:', err)
    showToast('Failed to export CSV: ' + (err.message || 'Unknown error'), 'error')
  } finally {
    isExportingCSV = false
    if (exportBtn) {
      exportBtn.disabled = false
      exportBtn.style.opacity = '1'
      exportBtn.style.cursor = 'pointer'
      exportBtn.innerHTML = originalBtnHTML
    }
  }
}

function downloadBlob (blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}



/* =========================
   LAST UPDATED HELPER
========================= */
/**
 * Returns an HTML string with the last status-update date
 * drawn from the complaint's history array.
 */
function getLastUpdatedBadge (complaint) {
  const history = complaint.history || complaint.statusHistory
  if (!history || history.length === 0) return ''

  // Find the most recent history entry
  const last = history[history.length - 1]
  if (!last || !last.date) return ''

  // Only show if it differs from the creation date
  const created = (complaint.createdAt || '').toString().trim()
  const updated = (last.date || '').toString().trim()
  if (updated === created) return ''

  return `<p style="font-size:11px;color:var(--text-dim);margin-top:2px;">
    <i class="fas fa-clock"></i> Updated: ${escapeHTML(updated)}
  </p>`
}

/* =========================
   CLEAR COMPLAINTS (ADMIN)
========================= */
function confirmClearComplaints () {
  openModal(`
    <div class="confirm-modal">
      <div class="confirm-icon"><i class="fas fa-exclamation-triangle"></i></div>
      <h3>Clear All Complaints?</h3>
      <p>This will permanently delete ALL complaints from local storage. This action cannot be undone.</p>
      <div class="confirm-actions">
        <button class="btn primary" style="background:linear-gradient(135deg,#f43f5e,#fb7185)" onclick="clearComplaints(); closeModal({target:{id:'modalOverlay'}})">
          <i class="fas fa-trash"></i> Yes, Clear All
        </button>
        <button class="btn secondary" onclick="closeModal({target:{id:'modalOverlay'}})">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
    </div>
  `)
}

function clearComplaints () {
  safeStorage('problemXComplaints', [])
  loadAdminDashboard()
  showToast('All complaints cleared.', 'success')
}

/* =========================
   CONTACT FORM (Web3Forms Integration -> fmdumair07@gmail.com)
========================= */
async function submitContact (event) {
  event.preventDefault()
  const form = event.target
  const btn = form.querySelector('button[type="submit"]')

  // Extract form fields
  const nameEl = form.querySelector('[name="name"]')
  const emailEl = form.querySelector('[name="email"]')
  const phoneEl = form.querySelector('[name="phone"]')
  const msgEl = form.querySelector('[name="message"]')
  const botcheckEl = form.querySelector('[name="botcheck"]')

  // Bot honeypot check
  if (botcheckEl && botcheckEl.checked) {
    return
  }

  const name = (nameEl ? nameEl.value : '').trim()
  const email = (emailEl ? emailEl.value : '').trim()
  const phone = (phoneEl ? phoneEl.value : '').trim()
  const message = (msgEl ? msgEl.value : '').trim()

  // Validation
  if (!name) {
    showToast('Please enter your name.', 'error')
    nameEl?.focus()
    return
  }
  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address.', 'error')
    emailEl?.focus()
    return
  }
  if (!message) {
    showToast('Please enter your message description.', 'error')
    msgEl?.focus()
    return
  }

  // Show loading state
  btn.disabled = true
  const originalBtnHTML = btn.innerHTML
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending message via Web3Forms...'

  const targetEmail = 'fmdumair07@gmail.com'

  // Retrieve Web3Forms access key
  const accessKeyInput = form.querySelector('[name="access_key"]')
  let accessKey = (accessKeyInput && accessKeyInput.value ? accessKeyInput.value.trim() : '')
  if (!accessKey) {
    accessKey = localStorage.getItem('web3formsAccessKey') || 'd6c2fab3-1444-4453-b001-641b1f966dee'
  }

  try {
    // Also log to backend API /api/contact asynchronously
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, message })
    }).catch(() => {})

    // Primary Submission via Web3Forms API
    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        access_key: accessKey,
        name: name,
        email: email,
        phone: phone || 'Not provided',
        message: message,
        subject: `NagarMitra: New Civic Message from ${name}`,
        from_name: 'NagarMitra Civic Grievance Portal'
      })
    })

    const result = await response.json().catch(() => ({}))

    btn.disabled = false
    btn.innerHTML = originalBtnHTML

    if (result.success) {
      // Show success view
      const successDiv = document.getElementById('contactFormSuccess')
      if (successDiv) {
        form.querySelectorAll('label, input, textarea, button[type="submit"]')
          .forEach(el => el.style.display = 'none')
        successDiv.style.display = 'block'
        const successP = successDiv.querySelector('p')
        if (successP) {
          successP.innerHTML = `Thank you <strong>${escapeHTML(name)}</strong>! Your message has been sent via Web3Forms directly to <strong>${targetEmail}</strong>. We will get back to you shortly.`
        }
      }

      showToast(`Message sent via Web3Forms to ${targetEmail}!`, 'success')
      form.reset()
      return
    } else {
      console.warn('Web3Forms returned non-success:', result)
      throw new Error(result.message || 'Web3Forms returned an error')
    }

  } catch (err) {
    console.warn('Web3Forms error, fallback to backup delivery:', err)
    btn.disabled = false
    btn.innerHTML = originalBtnHTML

    // Fallback: FormSubmit endpoint backup
    try {
      await fetch(`https://formsubmit.co/ajax/${targetEmail}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ name, email, phone: phone || 'N/A', message, _subject: `NagarMitra Backup Inquiry from ${name}` })
      })

      const successDiv = document.getElementById('contactFormSuccess')
      if (successDiv) {
        form.querySelectorAll('label, input, textarea, button[type="submit"]')
          .forEach(el => el.style.display = 'none')
        successDiv.style.display = 'block'
      }

      showToast(`Message successfully delivered to ${targetEmail}!`, 'success')
      form.reset()
      return
    } catch {
      // Direct mailto fallback so user message is NEVER lost
      const mailtoSubject = encodeURIComponent(`NagarMitra Inquiry from ${name}`)
      const mailtoBody = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\n\nMessage:\n${message}`)
      window.open(`mailto:${targetEmail}?subject=${mailtoSubject}&body=${mailtoBody}`, '_blank')

      const successDiv = document.getElementById('contactFormSuccess')
      if (successDiv) {
        form.querySelectorAll('label, input, textarea, button[type="submit"]')
          .forEach(el => el.style.display = 'none')
        successDiv.style.display = 'block'
      }

      showToast(`Draft opened for ${targetEmail}. Please press send!`, 'success')
      form.reset()
    }
  }
}

function resetContactForm () {
  const form = document.querySelector('.contact-form')
  const successDiv = document.getElementById('contactFormSuccess')
  if (successDiv) successDiv.style.display = 'none'
  if (form) {
    form.querySelectorAll('label, input, textarea, button[type="submit"]')
      .forEach(el => el.style.display = '')
    form.reset()
  }
}

/* =========================
   PASSWORD VISIBILITY TOGGLE
========================= */
function togglePassword (inputId, btn) {
  const input = document.getElementById(inputId)
  if (!input) return
  const isHidden = input.type === 'password'
  input.type = isHidden ? 'text' : 'password'
  const icon = btn.querySelector('i')
  if (icon) {
    icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye'
  }
  btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password')
}

/* =========================
   COOKIE CONSENT
========================= */
function initCookieBanner () {
  const consent = localStorage.getItem('problemXCookieConsent')
  const banner = document.getElementById('cookieBanner')
  if (!banner) return
  if (!consent) {
    setTimeout(() => banner.classList.add('show'), 800)
  }
}

function acceptCookies () {
  localStorage.setItem('problemXCookieConsent', 'accepted')
  hideCookieBanner()
  showToast('Preferences saved!', 'success')
}

function declineCookies () {
  localStorage.setItem('problemXCookieConsent', 'declined')
  hideCookieBanner()
}

function hideCookieBanner () {
  const banner = document.getElementById('cookieBanner')
  if (banner) {
    banner.classList.remove('show')
    setTimeout(() => banner.style.display = 'none', 400)
  }
}

/* =========================
   SCROLL PROGRESS BAR
========================= */
function initScrollProgress () {
  const bar = document.getElementById('scrollProgress')
  if (!bar) return
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY
    const docHeight = document.documentElement.scrollHeight - window.innerHeight
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0
    bar.style.width = pct + '%'
  }, { passive: true })
}

/* =========================
   CONFIRMATION MODAL HELPER
========================= */
function confirmAction (message, onConfirm, onCancel) {
  openModal(`
    <div class="confirm-modal">
      <div class="confirm-icon"><i class="fas fa-exclamation-triangle"></i></div>
      <h3>Are you sure?</h3>
      <p>${escapeHTML(message)}</p>
      <div class="confirm-actions">
        <button class="btn primary" onclick="(${onConfirm.toString()})(); closeModal({target:{id:'modalOverlay'}})">
          <i class="fas fa-check"></i> Confirm
        </button>
        <button class="btn secondary" onclick="closeModal({target:{id:'modalOverlay'}})">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
    </div>
  `)
}

/* =========================
   INIT
========================= */
document.addEventListener('DOMContentLoaded', () => {
  captureUTM()
  loadTheme()

  // Set copyright year dynamically
  const copyrightEl = document.getElementById('copyrightText')
  if (copyrightEl) {
    copyrightEl.textContent = `\u00a9 ${new Date().getFullYear()} NagarMitra | Building Better Communities.`
  }

  // Set last updated date
  const footerUpdated = document.getElementById('footerUpdated')
  if (footerUpdated) {
    footerUpdated.textContent = `Last updated: ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`
  }

  if (window.history && history.scrollRestoration) {
    history.scrollRestoration = 'manual'
  }

  const resetTop = () =>
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  resetTop()
  window.addEventListener('pageshow', resetTop, { passive: true })

  // Init features
  initCookieBanner()
  initScrollProgress()

  // Check session verification on startup
  verifySession()

  // Check backend and database health
  checkBackendHealth()
  setInterval(checkBackendHealth, 15000)

  loadHeroStats()

  // Auto-save draft on report fields
  ;['category', 'description', 'location'].forEach(id => {
    const el = document.getElementById(id)
    if (el) {
      el.addEventListener('input', () => {
        saveDraft()
        if (id === 'description') updateCharCount()
      })
    }
  })

  // Scroll top button
  const scrollBtn = document.getElementById('scrollTopBtn')
  if (!scrollBtn) return

  const toggleScrollButton = () => {
    if (window.scrollY > 200) {
      scrollBtn.classList.add('visible')
    } else {
      scrollBtn.classList.remove('visible')
    }
  }

  toggleScrollButton()
  window.addEventListener('scroll', toggleScrollButton, { passive: true })
})

