// ============================================
// AUTH.JS — Username / Password Authentication
// ============================================

// API_BASE is loaded from config.json at the bottom of this file.
// Do NOT hardcode localhost here — set the URL in js/config.json instead.
let API_BASE = 'https://attendance-api-production-ec07.up.railway.app/api'; // fallback until config loads
const SESSION_KEY     = 'attendanceSession';
const MAX_ATTEMPTS    = 5;
const LOCKOUT_MS      = 10 * 60 * 1000; // 10 minutes

// In-memory state for multi-step flows
let _regData      = {};   // registration temp data
let _resetUser    = '';   // forgot-password: verified username
let _resetToken   = '';   // NEW-01 FIX: short-lived token issued after security answer passes

// ============================================
// INIT
// ============================================
window.addEventListener('load', () => {
    // If already logged in, skip to role selector
    const session = getSession();
    if (session && session.sessionId) {
        // Restore sessionStorage flags so role-selector guard passes
        sessionStorage.setItem('pinAuthenticated', 'true');
        sessionStorage.setItem('sessionId', session.sessionId);
        window.location.href = 'role-selector.html';
        return;
    }

    checkLockout();

    // Keyboard shortcuts — Enter submits the active step
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const active = document.querySelector('.panel.active')?.id;
        if (active === 'panelSignIn') handleSignIn();
        if (active === 'panelRegister') {
            if (isVisible('regStep1')) regStep1Next();
            else if (isVisible('regStep2')) regStep2Next();
        }
        if (active === 'panelForgot') {
            if (isVisible('forgotStep1')) forgotStep1Next();
            else if (isVisible('forgotStep2')) forgotStep2Next();
            else if (isVisible('forgotStep3')) forgotStep3Submit();
        }
    });
});

// ============================================
// PANEL NAVIGATION
// ============================================
function showPanel(id) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    clearAllAlerts();

    if (id === 'panelRegister') showRegStep(1);
    if (id === 'panelForgot')   showForgotStep(1);
}

function isVisible(id) {
    const el = document.getElementById(id);
    return el && el.style.display !== 'none';
}

// ============================================
// SIGN IN
// ============================================
async function handleSignIn() {
    const username = val('siUsername');
    const password = val('siPassword');

    if (!username || !password) {
        return showAlert('signInError', 'Please enter your username and password.');
    }
    if (isLockedOut()) return;

    setLoading('signInBtn', true);
    clearAlert('signInError');
    clearAlert('signInSuccess');

    try {
        const result = await apiPost('/authentication/login', { username, password });

        // Store session in sessionStorage only — clears automatically on tab/browser close
        const sessionData = {
            sessionId:    result.sessionId,
            sessionToken: result.sessionToken,
            userId:       result.userId,
            username:     result.username,
            fullName:     result.fullName,
            loginTime:    result.loginTime
        };
        saveSession(sessionData);

        // Set the sessionStorage keys that role-selector.html and dashboards check
        sessionStorage.setItem('pinAuthenticated', 'true');
        sessionStorage.setItem('sessionId',        result.sessionId);
        sessionStorage.setItem('sessionToken',     result.sessionToken);
        sessionStorage.setItem('username',         result.username);
        sessionStorage.setItem('fullName',         result.fullName || result.username);

        resetAttempts();
        showAlert('signInSuccess', '✓ Signed in! Redirecting…', 'success');
        setTimeout(() => window.location.href = 'role-selector.html', 700);

    } catch (err) {
        const attempts = incrementAttempts();
        const left = MAX_ATTEMPTS - attempts;

        if (attempts >= MAX_ATTEMPTS) {
            lockout();
        } else {
            showAlert('signInError', `Incorrect username or password. ${left} attempt${left !== 1 ? 's' : ''} remaining.`);
        }
    } finally {
        setLoading('signInBtn', false);
    }
}

// ============================================
// REGISTER — STEP 1 (credentials)
// ============================================
function regStep1Next() {
    clearAlert('regError1');

    const fullName = val('regFullName');
    const username = val('regUsername');
    const password = val('regPassword');
    const confirm  = val('regConfirm');

    if (!fullName)              return showAlert('regError1', 'Full name is required.');
    if (fullName.length < 2)    return showAlert('regError1', 'Full name must be at least 2 characters.');
    if (!username)              return showAlert('regError1', 'Username is required.');
    if (username.length < 3)    return showAlert('regError1', 'Username must be at least 3 characters.');
    if (!/^[a-zA-Z0-9._-]+$/.test(username))
                                return showAlert('regError1', 'Username may only contain letters, numbers, dots, dashes, or underscores.');
    if (!password)              return showAlert('regError1', 'Password is required.');

    const strength = passwordStrength(password);
    if (strength.score < 2)    return showAlert('regError1', 'Password is too weak. Add uppercase letters, numbers, and symbols.');
    if (password !== confirm)   return showAlert('regError1', 'Passwords do not match.');

    _regData.fullName = fullName;
    _regData.username = username;
    _regData.password = password;

    showRegStep(2);
}

// ============================================
// REGISTER — STEP 2 (security question)
// ============================================
function toggleCustomSecQuestion() {
    const sel = document.getElementById('regSecQuestion');
    const customField = document.getElementById('customSecQuestionField');
    if (customField) {
        customField.style.display = (sel.value === '__custom__') ? 'block' : 'none';
    }
}

function regStep2Next() {
    clearAlert('regError2');

    const sel      = document.getElementById('regSecQuestion');
    const answer   = val('regSecAnswer');
    let question   = sel.value;

    if (!question) return showAlert('regError2', 'Please select a security question.');

    // Custom question path
    if (question === '__custom__') {
        question = val('regSecQuestionCustom');
        if (!question || question.length < 5)
            return showAlert('regError2', 'Your custom question must be at least 5 characters.');
    }

    if (!answer || answer.length < 2)
        return showAlert('regError2', 'Answer must be at least 2 characters.');

    _regData.securityQuestion = question;
    _regData.securityAnswer   = answer.toLowerCase().trim();

    submitRegistration();
}

async function submitRegistration() {
    // ── FIX 2: Disable the Continue button while submitting to prevent double-submit ──
    const btn = document.querySelector('#regStep2 .btn-primary');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }

    try {
        await apiPost('/authentication/register', {
            fullName:         _regData.fullName,
            username:         _regData.username,
            password:         _regData.password,
            securityQuestion: _regData.securityQuestion,
            securityAnswer:   _regData.securityAnswer
        });

        showRegStep(3);
        _regData = {};

    } catch (err) {
        showAlert('regError2', err.message || 'Registration failed. Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
}

function showRegStep(n) {
    [1, 2, 3].forEach(i => {
        document.getElementById('regStep' + i).style.display = (i === n) ? 'block' : 'none';
        const dot = document.getElementById('rDot' + i);
        if (!dot) return;
        dot.classList.remove('active', 'done');
        if (i < n)  dot.classList.add('done');
        if (i === n) dot.classList.add('active');
    });
    const labels = ['Account details', 'Security question', 'All done!'];
    document.getElementById('rStepLabel').textContent = labels[n - 1];
}

// ============================================
// FORGOT PASSWORD — STEP 1 (find account)
// ============================================
async function forgotStep1Next() {
    clearAlert('forgotError1');
    const username = val('forgotUsername');
    if (!username) return showAlert('forgotError1', 'Please enter your username.');

    // ── FIX 3: Target the actual button, not the div ──
    const btn = document.querySelector('#forgotStep1 .btn-primary');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }

    try {
        const result = await apiGet(`/authentication/security-question/${encodeURIComponent(username)}`);
        _resetUser = username;
        document.getElementById('forgotSecQuestion').textContent = result.question;
        showForgotStep(2);
    } catch (err) {
        showAlert('forgotError1', 'No account found with that username.');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
}

// ============================================
// FORGOT PASSWORD — STEP 2 (verify answer)
// ============================================
async function forgotStep2Next() {
    clearAlert('forgotError2');
    const answer = val('forgotSecAnswer');
    if (!answer) return showAlert('forgotError2', 'Please enter your answer.');

    const btn = document.querySelector('#forgotStep2 .btn-primary');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }

    try {
        const result = await apiPost('/authentication/verify-security-answer', {
            username: _resetUser,
            answer:   answer.toLowerCase().trim()
        });
        // NEW-01 FIX: store the server-issued reset token for step 3
        _resetToken = result.resetToken || '';
        showForgotStep(3);
    } catch (err) {
        showAlert('forgotError2', 'Incorrect answer. Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
}

// ============================================
// FORGOT PASSWORD — STEP 3 (new password)
// ============================================
async function forgotStep3Submit() {
    clearAlert('forgotError3');
    const newPw    = val('forgotNewPw');
    const confirm  = val('forgotConfirmPw');

    if (!newPw)          return showAlert('forgotError3', 'Please enter a new password.');
    const strength = passwordStrength(newPw);
    if (strength.score < 2) return showAlert('forgotError3', 'Password is too weak. Add uppercase letters, numbers, and symbols.');
    if (newPw !== confirm) return showAlert('forgotError3', 'Passwords do not match.');

    const btn = document.querySelector('#forgotStep3 .btn-primary');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }

    try {
        await apiPost('/authentication/reset-password', {
            username:    _resetUser,
            resetToken:  _resetToken,   // NEW-01 FIX: include server-issued token
            newPassword: newPw
        });

        _resetUser  = '';
        _resetToken = '';   // NEW-01 FIX: clear token after use
        showAlert('signInSuccess', '✓ Password reset! Sign in with your new password.', 'success');
        showPanel('panelSignIn');
    } catch (err) {
        showAlert('forgotError3', err.message || 'Reset failed. Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
}

function showForgotStep(n) {
    [1, 2, 3].forEach(i => {
        document.getElementById('forgotStep' + i).style.display = (i === n) ? 'block' : 'none';
        const dot = document.getElementById('fDot' + i);
        if (!dot) return;
        dot.classList.remove('active', 'done');
        if (i < n)  dot.classList.add('done');
        if (i === n) dot.classList.add('active');
    });
    const labels = ['Find account', 'Verify identity', 'New password'];
    document.getElementById('fStepLabel').textContent = labels[n - 1];
}

// ============================================
// PASSWORD STRENGTH
// ============================================
function passwordStrength(pw) {
    let score = 0;
    const checks = {
        len:  pw.length >= 8,
        up:   /[A-Z]/.test(pw),
        num:  /[0-9]/.test(pw),
        sym:  /[^A-Za-z0-9]/.test(pw)
    };
    score = Object.values(checks).filter(Boolean).length;
    return { score, checks };
}

function checkPasswordStrength() {
    const pw = document.getElementById('regPassword').value;
    const { score, checks } = passwordStrength(pw);

    document.getElementById('pwReqs').classList.toggle('show', pw.length > 0);

    const map = { len: 'req-len', up: 'req-up', num: 'req-num', sym: 'req-sym' };
    for (const [k, id] of Object.entries(map)) {
        document.getElementById(id)?.classList.toggle('met', checks[k]);
    }

    const segs = ['seg1','seg2','seg3','seg4'];
    const classes = ['','weak','medium','medium','strong'];
    segs.forEach((id, i) => {
        const el = document.getElementById(id);
        el.classList.remove('weak','medium','strong');
        if (i < score) el.classList.add(classes[score]);
    });

    const labels = ['','Weak','Fair','Good','Strong'];
    document.getElementById('strengthLabel').textContent = pw.length > 0 ? labels[score] : '';
}

function checkResetStrength() {
    const pw = document.getElementById('forgotNewPw').value;
    const { score } = passwordStrength(pw);
    const segs = ['rSeg1','rSeg2','rSeg3','rSeg4'];
    const classes = ['','weak','medium','medium','strong'];
    segs.forEach((id, i) => {
        const el = document.getElementById(id);
        el.classList.remove('weak','medium','strong');
        if (i < score) el.classList.add(classes[score]);
    });
}

// ============================================
// USERNAME AVAILABILITY CHECK (debounced)
// ============================================
let _usernameTimer = null;
function checkUsernameAvailability() {
    clearTimeout(_usernameTimer);
    const username = val('regUsername');
    const statusEl = document.getElementById('usernameStatus');
    statusEl.className = 'alert';
    statusEl.style.display = 'none';

    if (username.length < 3) return;

    _usernameTimer = setTimeout(async () => {
        try {
            const result = await apiGet(`/authentication/check-username/${encodeURIComponent(username)}`);
            if (result.available) {
                statusEl.className = 'alert success show';
                statusEl.innerHTML = '<i class="fas fa-circle-check"></i> Username available';
                statusEl.style.display = 'flex';
            } else {
                statusEl.className = 'alert error show';
                statusEl.innerHTML = '<i class="fas fa-circle-xmark"></i> Username already taken';
                statusEl.style.display = 'flex';
            }
        } catch { /* backend offline, skip check */ }
    }, 500);
}

// ============================================
// PASSWORD TOGGLE
// ============================================
function togglePw(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon  = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// ============================================
// LOCKOUT (client-side rate limiting)
// ============================================
const LOCKOUT_STORE  = 'authLockout';
const ATTEMPTS_STORE = 'authAttempts';
let _lockoutInterval = null;

function getAttempts()       { return parseInt(localStorage.getItem(ATTEMPTS_STORE) || '0'); }
function incrementAttempts() { const n = getAttempts() + 1; localStorage.setItem(ATTEMPTS_STORE, n); return n; }
function resetAttempts()     { localStorage.removeItem(ATTEMPTS_STORE); localStorage.removeItem(LOCKOUT_STORE); }

function isLockedOut() {
    const until = parseInt(localStorage.getItem(LOCKOUT_STORE) || '0');
    if (!until) return false;
    if (Date.now() < until) return true;
    resetAttempts();
    return false;
}

function lockout() {
    const until = Date.now() + LOCKOUT_MS;
    localStorage.setItem(LOCKOUT_STORE, until);
    applyLockoutUI();
}

function checkLockout() {
    if (isLockedOut()) applyLockoutUI();
}

function applyLockoutUI() {
    const bar = document.getElementById('lockoutBar');
    const btn = document.getElementById('signInBtn');
    bar.classList.add('show');
    if (btn) btn.disabled = true;

    clearInterval(_lockoutInterval);
    _lockoutInterval = setInterval(() => {
        const rem = Math.ceil((parseInt(localStorage.getItem(LOCKOUT_STORE)) - Date.now()) / 1000);
        if (rem <= 0) {
            clearInterval(_lockoutInterval);
            bar.classList.remove('show');
            if (btn) btn.disabled = false;
            resetAttempts();
            return;
        }
        const m = Math.floor(rem / 60), s = rem % 60;
        document.getElementById('lockoutTimer').textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
    }, 500);
}

// ============================================
// SESSION HELPERS
// ============================================
function saveSession(data)  { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
}

// ============================================
// API HELPERS
// ============================================
async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

async function apiGet(path) {
    const res = await fetch(API_BASE + path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

// ============================================
// UI HELPERS
// ============================================
function val(id) {
    return (document.getElementById(id)?.value || '').trim();
}

// ── FIX 4: Unified showAlert — always rebuilds innerHTML so it works on fresh or reused elements ──
function showAlert(id, msg, type = 'error') {
    const el = document.getElementById(id);
    if (!el) return;
    const icon = type === 'success' ? 'fa-circle-check' : type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-xmark';
    el.className = `alert ${type} show`;
    el.style.display = 'flex';
    el.innerHTML = `<i class="fas ${icon}"></i><span>${msg}</span>`;
}

function clearAlert(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none';
}

function clearAllAlerts() {
    document.querySelectorAll('.alert').forEach(el => {
        el.classList.remove('show');
        el.style.display = 'none';
    });
}

function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    loading ? btn.classList.add('loading') : btn.classList.remove('loading');
}

console.log('🔐 Auth System Ready');

// ============================================
// CONFIG LOADER
// Reads baseURL from js/config.json so you only
// need to change one file when deploying.
// ============================================
(async function loadConfig() {
    try {
        const res = await fetch('js/config.json');
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg?.api?.baseURL && !cfg.api.baseURL.includes('REPLACE_WITH')) {
            API_BASE = cfg.api.baseURL;
        }
    } catch (e) {
        console.warn('Could not load config.json, using fallback API_BASE:', API_BASE);
    }
})();