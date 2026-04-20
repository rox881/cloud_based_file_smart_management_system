/* ============================================================
    DocClassifier — login.js
    Handles Sign-In and Registration with real Supabase Auth.
    ============================================================ */

'use strict';

/* ============================================================
   TAB SWITCHING
   ============================================================ */
function switchTab(mode) {
    const paneLogin    = document.getElementById('paneLogin');
    const paneRegister = document.getElementById('paneRegister');
    const tabLogin     = document.getElementById('tabLogin');
    const tabRegister  = document.getElementById('tabRegister');
    const errorEl      = document.getElementById('loginError');
    const successEl    = document.getElementById('regSuccess');

    errorEl.hidden   = true;
    successEl.hidden = true;

    if (mode === 'register') {
        paneLogin.classList.remove('active-pane');
        paneLogin.classList.add('hidden-pane');
        paneRegister.classList.remove('hidden-pane');
        paneRegister.classList.add('active-pane');
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
        tabRegister.setAttribute('aria-selected', 'true');
        tabLogin.setAttribute('aria-selected', 'false');
    } else {
        paneRegister.classList.remove('active-pane');
        paneRegister.classList.add('hidden-pane');
        paneLogin.classList.remove('hidden-pane');
        paneLogin.classList.add('active-pane');
        tabRegister.classList.remove('active');
        tabLogin.classList.add('active');
        tabLogin.setAttribute('aria-selected', 'true');
        tabRegister.setAttribute('aria-selected', 'false');
    }
}

/* ============================================================
   UTILITIES
   ============================================================ */
function nameFromEmail(email) {
    const local = email.split('@')[0];
    return local.replace(/[._-]+/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
}

function showError(msg) {
    const el = document.getElementById('loginError');
    document.getElementById('loginErrorMsg').textContent = msg;
    el.hidden = false;
}

function hideError() {
    document.getElementById('loginError').hidden = true;
}

function shakePanel() {
    const p = document.getElementById('formPanel');
    p.style.animation = 'none'; p.offsetHeight;
    p.style.animation = 'shakeX 0.5s cubic-bezier(.36,.07,.19,.97) both';
    setTimeout(() => p.style.animation = '', 600);
}

function setFieldError(groupId, errorId, msg) {
    const g = document.getElementById(groupId);
    const e = document.getElementById(errorId);
    if (g) g.classList.toggle('has-error', !!msg);
    if (e) e.textContent = msg || '';
}

function clearFieldError(groupId, errorId) {
    setFieldError(groupId, errorId, '');
}

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

/* ---------- Write session to localStorage + redirect ---------- */
function handleSuccess(email, name, token, refreshToken = null) {
    const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    localStorage.setItem('docclassifier_session', JSON.stringify({
        email, name, initials,
        token: token || null,
        refreshToken: refreshToken || null,
        loginTime: Date.now(),
    }));

    const successTitle   = document.getElementById('successTitle');
    const successOverlay = document.getElementById('successOverlay');
    if (successTitle)   successTitle.textContent = `Welcome, ${name.split(' ')[0]}!`;
    if (successOverlay) successOverlay.hidden = false;

    setTimeout(() => { window.location.href = '/'; }, 1800);
}

/* ============================================================
   SIGN-IN FORM
   ============================================================ */
const loginForm = document.getElementById('loginForm');
const loginBtn  = document.getElementById('loginBtn');

loginForm && loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideError();
    clearFieldError('loginEmailGroup', 'loginEmailError');
    clearFieldError('loginPasswordGroup', 'loginPasswordError');

    const identifier = document.getElementById('loginEmailInput').value.trim();
    const password = document.getElementById('loginPasswordInput').value;

    // Basic validation
    if (!identifier) {
        setFieldError('loginEmailGroup', 'loginEmailError', 'Enter your email or username.');
        return;
    }
    if (identifier.includes('@') && !isValidEmail(identifier.toLowerCase())) {
        setFieldError('loginEmailGroup', 'loginEmailError', 'Enter a valid email address.');
        return;
    }
    if (!identifier.includes('@') && identifier.length < 3) {
        setFieldError('loginEmailGroup', 'loginEmailError', 'Username must be at least 3 characters.');
        return;
    }
    if (password.length < 4) {
        setFieldError('loginPasswordGroup', 'loginPasswordError', 'Password must be at least 4 characters.');
        return;
    }

    setBtnLoading(loginBtn, true, 'Opening vault…');

    try {
        const res  = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: identifier.toLowerCase(), password }),
        });
        const data = await res.json();

        if (res.ok && data.user && data.session?.access_token) {
            const email = String(data.user?.email || identifier).toLowerCase();
            const name = data.user?.user_metadata?.full_name || nameFromEmail(email);
            handleSuccess(email, name, data.session?.access_token, data.session?.refresh_token);
            return;
        }

        const errMsg = data.error || '';
        throw new Error(errMsg || 'Login failed. No authenticated session returned.');
    } catch (err) {
        setBtnLoading(loginBtn, false, 'Sign in to my vault');
        showError(err.message);
        shakePanel();
    }
});

/* ============================================================
   REGISTER FORM
   ============================================================ */
const registerForm = document.getElementById('registerForm');
const registerBtn  = document.getElementById('registerBtn');

registerForm && registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideError();
    clearFieldError('nameGroup',        'regNameError');
    clearFieldError('regEmailGroup',    'regEmailError');
    clearFieldError('regPasswordGroup', 'regPasswordError');

    const name     = document.getElementById('regNameInput').value.trim();
    const email    = document.getElementById('regEmailInput').value.trim().toLowerCase();
    const password = document.getElementById('regPasswordInput').value;

    // Validation
    let ok = true;
    if (!name) {
        setFieldError('nameGroup', 'regNameError', 'Please enter your name.');
        ok = false;
    }
    if (!isValidEmail(email)) {
        setFieldError('regEmailGroup', 'regEmailError', 'Enter a valid email address.');
        ok = false;
    }
    if (password.length < 6) {
        setFieldError('regPasswordGroup', 'regPasswordError', 'Password must be at least 6 characters.');
        ok = false;
    }
    if (!ok) return;

    setBtnLoading(registerBtn, true, 'Creating account…');

    try {
        const res  = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();

        if (!res.ok) {
            // If user already exists, tell them to sign in
            const errMsg = data.error || '';
            if (errMsg.toLowerCase().includes('already registered') || errMsg.toLowerCase().includes('already exists')) {
                throw new Error('An account with this email already exists. Please sign in instead.');
            }
            throw new Error(errMsg || 'Registration failed. Please try again.');
        }

        // ── Success ──
        setBtnLoading(registerBtn, false, 'Create my account');
        registerForm.reset();
        document.getElementById('strengthFill').style.width = '0%';
        document.getElementById('strengthLabel').textContent = '';

        // If Supabase requires email confirmation, show success + switch to login tab
        const needsConfirm = !data.session;
        if (needsConfirm) {
            document.getElementById('regSuccess').hidden = false;
            // Switch to login tab after short delay
            setTimeout(() => switchTab('login'), 1800);
        } else {
            // Session available immediately — log straight in
            handleSuccess(email, name, data.session?.access_token, data.session?.refresh_token);
        }
    } catch (err) {
        setBtnLoading(registerBtn, false, 'Create my account');
        showError(err.message);
        shakePanel();
    }
});

/* ============================================================
   DEMO BUTTON
   ============================================================ */
const demoUserBtn = document.getElementById('demoUser');
demoUserBtn && demoUserBtn.addEventListener('click', () => {
    showToast('Demo quick-login is disabled in secure multi-user mode. Please sign in with a real account.');
});

/* ============================================================
   PASSWORD STRENGTH METER (register pane)
   ============================================================ */
const regPasswordInput = document.getElementById('regPasswordInput');
regPasswordInput && regPasswordInput.addEventListener('input', () => {
    const val   = regPasswordInput.value;
    const score = getStrength(val);
    const fill  = document.getElementById('strengthFill');
    const label = document.getElementById('strengthLabel');
    const colours = ['', '#ef4444', '#f97316', '#eab308', '#22c55e'];
    const labels  = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    fill.style.width           = `${score * 25}%`;
    fill.style.backgroundColor = colours[score] || '';
    label.textContent          = score ? labels[score] : '';
    label.style.color          = colours[score] || '';
});

function getStrength(pw) {
    if (!pw) return 0;
    let s = 0;
    if (pw.length >= 8)               s++;
    if (/[A-Z]/.test(pw))             s++;
    if (/[0-9]/.test(pw))             s++;
    if (/[^A-Za-z0-9]/.test(pw))      s++;
    return s;
}

/* ============================================================
   PASSWORD VISIBILITY TOGGLES
   ============================================================ */
function setupToggle(btnId, inputId) {
    const btn   = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.querySelector('.eye-open').style.display  = show ? 'none'  : '';
        btn.querySelector('.eye-closed').style.display= show ? ''      : 'none';
    });
}
setupToggle('togglePassword',    'loginPasswordInput');
setupToggle('toggleRegPassword', 'regPasswordInput');

/* ============================================================
   FORGOT PASSWORD
   ============================================================ */
const forgotLink = document.getElementById('forgotLink');
forgotLink && forgotLink.addEventListener('click', e => {
    e.preventDefault();
    showToast('Password reset is not available in this version.');
});

/* ============================================================
   MISC
   ============================================================ */
function setBtnLoading(btn, on, loadingText) {
    if (!btn) return;
    btn.disabled = on;
    btn.querySelector('.btn-login-text').textContent = on ? loadingText : btn.querySelector('.btn-login-text').dataset.default || 'Submit';
    btn.querySelector('.btn-login-spinner').hidden = !on;
}

// Store default button labels
document.querySelectorAll('.btn-login-text').forEach(el => {
    el.dataset.default = el.textContent;
});

function showToast(msg) {
    const t = document.createElement('div');
    Object.assign(t.style, {
        position:'fixed', bottom:'28px', left:'50%',
        transform:'translateX(-50%) translateY(20px)',
        background:'#232323', border:'1px solid #333', color:'#ededed',
        padding:'10px 20px', borderRadius:'8px', fontSize:'13px',
        fontFamily:'Inter,sans-serif', boxShadow:'0 8px 32px rgba(0,0,0,.5)',
        zIndex:'9999', opacity:'0', transition:'all .3s ease', whiteSpace:'nowrap',
    });
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; });
    setTimeout(() => {
        t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(20px)';
        setTimeout(() => t.remove(), 400);
    }, 3500);
}

/* ============================================================
   ANIMATED BACKGROUND  (grid canvas + particles + counter)
   ============================================================ */

// ── Grid canvas ──
const canvas = document.getElementById('gridCanvas');
if (canvas) {
    const ctx = canvas.getContext('2d');
    function resizeCanvas() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        drawGrid();
    }
    function drawGrid() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(108,99,255,0.07)';
        ctx.lineWidth   = 1;
        const step = 48;
        for (let x = 0; x < canvas.width; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        }
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
}

// ── Floating particles ──
(function () {
    const container = document.getElementById('particles');
    if (!container) return;
    for (let i = 0; i < 18; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 4 + 2;
        Object.assign(p.style, {
            width: size + 'px', height: size + 'px',
            left: Math.random() * 100 + '%',
            top: Math.random() * 100 + '%',
            animationDuration: (8 + Math.random() * 12) + 's',
            animationDelay: -(Math.random() * 10) + 's',
        });
        container.appendChild(p);
    }
}());

// ── Animated counters ──
document.querySelectorAll('.stat-num[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target, 10);
    let current  = 0;
    const step   = Math.ceil(target / 60);
    const timer  = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current.toLocaleString();
        if (current >= target) clearInterval(timer);
    }, 20);
});

/* ============================================================
   INITIALIZATION
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const mode   = params.get('mode');
    const path   = window.location.pathname;

    if (mode === 'register' || path === '/signup') {
        switchTab('register');
    }
});
