/* ============================================================
   DocClassifier — main.js  (Multi-user Personal Vault)
   Auth guard → read session → render user identity →
   Upload → classify → My Files with category tabs
   ============================================================ */

'use strict';

/* ============================================================
   AUTH GUARD — Redirect to /login if no session
   ============================================================ */
const SESSION_KEY = 'docclassifier_session';

function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
}

let session = getSession();
if (!session || !session.email || !session.token) {
    localStorage.removeItem(SESSION_KEY);
    window.location.replace('/login');
}

function setSession(nextSession) {
    session = nextSession;
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession || {}));
}

function clearSessionAndRedirect() {
    localStorage.removeItem(SESSION_KEY);
    window.location.replace('/login');
}

function getAuthHeaders() {
    const token = session?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function tryRefreshSession() {
    const refreshToken = session?.refreshToken;
    if (!refreshToken) return false;

    try {
        const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return false;
        const payload = await res.json();
        const nextAccess = payload?.session?.access_token;
        const nextRefresh = payload?.session?.refresh_token || refreshToken;
        if (!nextAccess) return false;
        setSession({ ...session, token: nextAccess, refreshToken: nextRefresh, loginTime: Date.now() });
        return true;
    } catch (_) {
        return false;
    }
}

async function fetchWithAuth(url, options = {}, retryOn401 = true) {
    const headers = { ...(options.headers || {}), ...getAuthHeaders() };
    const response = await fetch(url, { ...options, headers });

    if (response.status !== 401 || !retryOn401) {
        return response;
    }

    const refreshed = await tryRefreshSession();
    if (!refreshed) {
        clearSessionAndRedirect();
        return response;
    }

    const retryHeaders = { ...(options.headers || {}), ...getAuthHeaders() };
    return fetch(url, { ...options, headers: retryHeaders });
}

/* ---------- Category colour map ---------- */
const CAT_COLORS = {
    report:      { color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)',  border: 'rgba(62,207,142,0.35)' },
    assignment:  { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.35)' },
    invoice:     { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.35)' },
    image:       { color: '#c084fc', bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.35)' },
    legal:       { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' },
    finance:     { color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.35)' },
    uncategorized:{ color: '#94a3b8',bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.35)' },
};

function catStyle(cat) {
    const key = (cat||'').toLowerCase();
    return CAT_COLORS[key] || CAT_COLORS['uncategorized'];
}

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const appLayout     = document.getElementById('appLayout');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarLogo   = document.getElementById('sidebarLogoBtn');

// User identity
const sidebarAvatar   = document.getElementById('sidebarAvatar');
const sidebarUserName = document.getElementById('sidebarUserName');
const sidebarUserEmail= document.getElementById('sidebarUserEmail');
const headerAvatar    = document.getElementById('headerAvatar');
const headerUserName  = document.getElementById('headerUserName');
const greetText       = document.getElementById('greetText');
const logoutBtn       = document.getElementById('logoutBtn');

// Navigation
const navItems   = document.querySelectorAll('.sidebar-nav-item[data-view]');
const headerUploadBtn = document.getElementById('headerUploadBtn');

// Upload view
const dropArea        = document.getElementById('dropArea');
const fileInput       = document.getElementById('fileInput');
const browseBtn       = document.getElementById('browseBtn');
const fileList        = document.getElementById('fileList');
const classifyBtn     = document.getElementById('classifyBtn');
const classifyActions = document.getElementById('classifyActions');
const fileCountEl     = document.getElementById('fileCount');
const statusBanner    = document.getElementById('statusBanner');
const statusText      = document.getElementById('statusText');
const statusProgressBar = document.getElementById('statusProgressBar');
const uploadResults   = document.getElementById('uploadResults');

// My files view
const myFilesContainer = document.getElementById('myFilesContainer');
const categoryTabs     = document.getElementById('categoryTabs');
const categorySidebarNav = document.getElementById('categorySidebarNav');
const modeGrid         = document.getElementById('modeGrid');
const modeList         = document.getElementById('modeList');
const statsTotalFiles  = document.getElementById('statsTotalFiles');
const statsCategories  = document.getElementById('statsCategories');

// Search view
const searchInput     = document.getElementById('searchInput');
const searchBtn       = document.getElementById('searchBtn');
const searchBigInput  = document.getElementById('searchBigInput');
const searchBigBtn    = document.getElementById('searchBigBtn');

// Category view
const categoryBackBtn       = document.getElementById('categoryBackBtn');
const categoryViewTitle     = document.getElementById('categoryViewTitle');
const categoryViewSubtitle  = document.getElementById('categoryViewSubtitle');
const categoryFilesContainer= document.getElementById('categoryFilesContainer');

// Modal
const modalBackdrop    = document.getElementById('modalBackdrop');
const docModal         = document.getElementById('docModal');
const docModalTitle    = document.getElementById('docModalTitle');
const docModalBody     = document.getElementById('docModalBody');
const docModalClose    = document.getElementById('docModalClose');
const docModalCloseBtn = document.getElementById('docModalCloseBtn');
const docModalDeleteBtn = document.getElementById('docModalDeleteBtn');
const docModalDownloadBtn = document.getElementById('docModalDownloadBtn');

// Toast
const toastContainer = document.getElementById('toastContainer');

// State
let uploadedFiles = [];
let activeJobId   = null;
let pollTimer     = null;
let allMyFiles    = [];   // raw documents from API
let activeTab     = 'all';
let viewMode      = 'grid'; // 'grid' | 'list'
let modalDocPath  = '';
let modalDocName  = '';

/* ============================================================
   Greeting + user identity
   ============================================================ */
function setGreeting() {
    const h = new Date().getHours();
    const msg = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    greetText.textContent = msg + ',';
}

function populateUserUI() {
    if (!session) return;
    const name     = session.name     || session.email;
    const initials = session.initials || name.substring(0, 2).toUpperCase();

    sidebarAvatar.textContent   = initials;
    sidebarUserName.textContent = name;
    sidebarUserEmail.textContent= session.email;
    headerAvatar.textContent    = initials;
    headerUserName.textContent  = name.split(' ')[0];
    setGreeting();
}

async function loadStorageStats() {
    if (!session) return;
    try {
        const res = await fetchWithAuth('/api/user/stats');
        const stats = await parseJsonGuarded(res);
        const used = stats.total_bytes_used || 0;
        const total = stats.quota_bytes || (50 * 1024 * 1024);
        
        const storageVal = document.getElementById('storageVal');
        const storageFill = document.getElementById('storageFill');
        const sidebarStorage = document.getElementById('sidebarStorage');
        
        if (storageVal && storageFill && sidebarStorage) {
            storageVal.textContent = `${fmtSize(used)} / ${fmtSize(total)}`;
            const pct = Math.min(100, Math.round((used / total) * 100));
            storageFill.style.width = `${pct}%`;
            sidebarStorage.hidden = false;
        }
    } catch (err) {
        console.error("Storage stats error:", err);
    }
}

populateUserUI();
loadStorageStats();

/* ============================================================
   Logout
   ============================================================ */
async function performLogout() {
    stopPolling();
    localStorage.removeItem(SESSION_KEY);
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: getAuthHeaders(),
        });
    } catch (_) {
        // Best effort only; local session is already removed.
    }
    window.location.replace('/login');
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (!confirm('Sign out of DocClassifier?')) return;
        await performLogout();
    });
}

/* ============================================================
   Sidebar & Navigation
   ============================================================ */
sidebarToggle.addEventListener('click', () => appLayout.classList.toggle('sidebar-expanded'));
sidebarLogo.addEventListener(  'click', () => appLayout.classList.toggle('sidebar-expanded'));

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.hidden = true);
    const target = document.getElementById('view-' + viewId);
    if (target) target.hidden = false;

    document.querySelectorAll('.sidebar-nav-item[data-view]').forEach(n => {
        n.classList.toggle('active', n.dataset.view === viewId);
    });

    // Side-effects per view
    if (viewId === 'myfiles') loadMyFiles();
}

navItems.forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        switchView(item.dataset.view);
    });
});

headerUploadBtn.addEventListener('click', () => switchView('upload'));
categoryBackBtn.addEventListener('click', () => switchView('myfiles'));

// Header search bar → go to search view
searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        switchView('search');
        searchBigInput.value = searchInput.value.trim();
        doSearch(searchInput.value.trim());
    }
});
searchBtn.addEventListener('click', () => {
    switchView('search');
    searchBigInput.value = searchInput.value.trim();
    doSearch(searchInput.value.trim());
});

// Big search
searchBigBtn.addEventListener('click', () => doSearch(searchBigInput.value.trim()));
searchBigInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(searchBigInput.value.trim()); });

/* ============================================================
   VIEW MODE (grid / list)
   ============================================================ */
modeGrid.addEventListener('click', () => {
    viewMode = 'grid';
    modeGrid.classList.add('active');
    modeList.classList.remove('active');
    renderFileCards(filteredFiles(allMyFiles, activeTab));
});

modeList.addEventListener('click', () => {
    viewMode = 'list';
    modeList.classList.add('active');
    modeGrid.classList.remove('active');
    renderFileCards(filteredFiles(allMyFiles, activeTab));
});

/* ============================================================
   UPLOAD
   ============================================================ */
browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
dropArea.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => processFiles(e.target.files));
dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('dragover'); });
dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
dropArea.addEventListener('drop', e => { e.preventDefault(); dropArea.classList.remove('dragover'); processFiles(e.dataTransfer.files); });

function processFiles(files) {
    if (!files || !files.length) return;
    uploadedFiles = Array.from(files);
    renderFileList();
    classifyBtn.disabled = false;
    classifyActions.style.display = 'flex';
    fileCountEl.textContent = `${uploadedFiles.length} file${uploadedFiles.length !== 1 ? 's' : ''} selected`;
}

function renderFileList() {
    fileList.innerHTML = '';
    uploadedFiles.forEach(f => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-icon">${getFileTypeIcon(f.name)}</div>
            <div class="file-info">
                <div class="file-name">${escH(f.name)}</div>
                <div class="file-meta">${fmtSize(f.size)} · ${f.type || 'unknown'}</div>
            </div>
            <span class="badge badge-pending">Ready</span>
        `;
        fileList.appendChild(item);
    });
}

classifyBtn.addEventListener('click', classifyAll);

async function classifyAll() {
    if (!uploadedFiles.length) return;

    statusBanner.hidden = false;
    statusText.textContent = 'Uploading…';
    statusProgressBar.style.width = '0%';
    classifyBtn.disabled = true;
    uploadResults.innerHTML = '';

    try {
        const formData = new FormData();
        uploadedFiles.forEach(f => formData.append('files', f));

        const res  = await fetchWithAuth('/api/classify', {
            method: 'POST',
            body: formData,
        });
        const data = await parseJsonGuarded(res);

        if (data.job_id) {
            activeJobId = data.job_id;
            statusText.textContent = 'Processing files…';
            startJobPolling(data.job_id);
            return;
        }
        statusBanner.hidden = true;
        renderUploadResults(data);
    } catch (err) {
        statusBanner.hidden = true;
        showToast('error', 'Upload Failed', err.message);
    } finally {
        if (!activeJobId) classifyBtn.disabled = false;
    }
}

/* ---- Job polling ---- */
function stopPolling() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

function startJobPolling(jobId) {
    stopPolling();
    const poll = async () => {
        try {
            const res = await fetchWithAuth(`/api/jobs/${encodeURIComponent(jobId)}`);
            const job = await parseJsonGuarded(res);

            if (job.status === 'completed') {
                activeJobId = null; stopPolling();
                statusBanner.hidden = true;
                classifyBtn.disabled = false;
                renderUploadResults({ details: job.details || [] });
                (job.warnings || []).forEach(w => showToast('error', `Warning: ${w.file}`, w.error));
                return;
            }
            if (job.status === 'failed') {
                activeJobId = null; stopPolling();
                statusBanner.hidden = true;
                classifyBtn.disabled = false;
                showToast('error', 'Processing Failed', job.error || 'Background processing failed.');
                return;
            }
            const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
            statusText.textContent = `Classifying… (${job.processed}/${job.total})`;
            statusProgressBar.style.width = `${pct}%`;
            pollTimer = setTimeout(poll, 1500);
        } catch (err) {
            activeJobId = null; stopPolling();
            statusBanner.hidden = true;
            classifyBtn.disabled = false;
            showToast('error', 'Polling Error', err.message);
        }
    };
    poll();
}

function renderUploadResults(data) {
    const details = Array.isArray(data.details) ? data.details : [];
    if (!details.length) return;

    showToast('success', 'Classification Complete', `${details.length} file${details.length !== 1 ? 's' : ''} processed.`);

    const rows = details.map(d => {
        const cat  = d.category || 'uncategorized';
        const cs   = catStyle(cat);
        const conf = Math.min(100, d.confidence ?? 0);
        return `
        <div class="upload-result-row">
            <div style="width:32px;height:32px;border-radius:6px;background:${cs.bg};border:1px solid ${cs.border};display:grid;place-items:center;flex-shrink:0;">
                ${getFileTypeIcon(d.file)}
            </div>
            <div class="upload-result-file">${escH(d.file || 'Unknown')}</div>
            <span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;
                background:${cs.bg};border:1px solid ${cs.border};color:${cs.color};white-space:nowrap;">
                ${escH(cat)}
            </span>
            <div class="conf-bar-wrap" style="width:80px;flex-shrink:0;">
                <div class="conf-bar-track"><div class="conf-bar-fill" style="width:${conf}%;background:${cs.color}"></div></div>
                <span class="conf-val">${conf}%</span>
            </div>
        </div>`;
    }).join('');

    uploadResults.innerHTML = `
        <div class="upload-result-panel">
            <div class="upload-result-header">
                <span class="upload-result-title">✅ ${details.length} file${details.length !== 1 ? 's' : ''} classified</span>
                <button class="btn btn-outline btn-sm" onclick="switchView('myfiles')">View My Files →</button>
            </div>
            <div class="upload-result-body">${rows}</div>
        </div>`;
}

/* ============================================================
   MY FILES — load from API + render
   ============================================================ */
async function loadMyFiles() {
    myFilesContainer.innerHTML = `<div class="empty-state"><div class="status-spinner" style="margin:0 auto 8px;"></div><div class="empty-state-text">Loading your files…</div></div>`;

    try {
        const res  = await fetchWithAuth('/api/my-documents');
        const json = await parseJsonGuarded(res);
        allMyFiles = Array.isArray(json.data) ? json.data : [];

        buildCategoryTabs(allMyFiles);
        buildCategorySidebarNav(allMyFiles);
        renderFileCards(filteredFiles(allMyFiles, activeTab));
        updateStats(allMyFiles);
    } catch (err) {
        myFilesContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-text">Could not load files</div>
                <div class="empty-state-subtext">${escH(err.message)}</div>
            </div>`;
        showToast('error', 'Load Failed', err.message);
    }
}

function filteredFiles(files, cat) {
    if (cat === 'all') return files;
    return files.filter(f => (f.category || 'uncategorized').toLowerCase() === cat.toLowerCase());
}

/* ---- Category tabs ---- */
function buildCategoryTabs(files) {
    const counts = { all: files.length };
    files.forEach(f => {
        const c = (f.category || 'uncategorized').toLowerCase();
        counts[c] = (counts[c] || 0) + 1;
    });

    // Update "All" count
    const allCountEl = document.getElementById('count-all');
    if (allCountEl) allCountEl.textContent = files.length;

    // Remove previously injected tabs
    categoryTabs.querySelectorAll('.cat-tab:not(#tab-all)').forEach(t => t.remove());

    const cats = [...new Set(files.map(f => (f.category || 'uncategorized').toLowerCase()))].sort();
    cats.forEach(cat => {
        if (cat === 'all') return;
        const cs  = catStyle(cat);
        const btn = document.createElement('button');
        btn.className = `cat-tab${activeTab === cat ? ' active' : ''}`;
        btn.dataset.cat = cat;
        btn.innerHTML = `
            <span style="width:8px;height:8px;border-radius:50%;background:${cs.color};flex-shrink:0;display:inline-block;"></span>
            ${capFirst(cat)}
            <span class="cat-tab-count">${counts[cat] || 0}</span>`;
        btn.addEventListener('click', () => selectTab(cat));
        categoryTabs.appendChild(btn);
    });

    // Bind all-tab
    document.getElementById('tab-all').onclick = () => selectTab('all');
}

function selectTab(cat) {
    activeTab = cat;
    categoryTabs.querySelectorAll('.cat-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
    renderFileCards(filteredFiles(allMyFiles, cat));
}

/* ---- Category sidebar nav ---- */
function buildCategorySidebarNav(files) {
    const counts = {};
    files.forEach(f => { const c = (f.category||'uncategorized').toLowerCase(); counts[c]=(counts[c]||0)+1; });

    categorySidebarNav.innerHTML = '';
    const cats = [...new Set(files.map(f => (f.category||'uncategorized').toLowerCase()))].sort();
    cats.forEach(cat => {
        const cs = catStyle(cat);
        const a  = document.createElement('a');
        a.href = '#';
        a.className = 'sidebar-nav-item';
        a.title = capFirst(cat);
        a.innerHTML = `
            <span class="sidebar-cat-dot" style="background:${cs.color};"></span>
            <span class="sidebar-nav-label">${capFirst(cat)}</span>
            <span class="sidebar-cat-count">${counts[cat]||0}</span>`;
        a.addEventListener('click', e => {
            e.preventDefault();
            openCategoryView(cat, counts[cat]||0, cs);
        });
        categorySidebarNav.appendChild(a);
    });
}

/* ---- Category dedicated view ---- */
function openCategoryView(cat, count, cs) {
    categoryViewTitle.textContent = capFirst(cat);
    categoryViewTitle.style.color = cs.color;
    categoryViewSubtitle.textContent = `${count} file${count !== 1 ? 's' : ''} classified as ${capFirst(cat)}`;

    categoryFilesContainer.className = viewMode === 'grid' ? 'files-grid-view' : 'files-list-view';
    const subset = filteredFiles(allMyFiles, cat);
    categoryFilesContainer.innerHTML = '';
    if (!subset.length) {
        categoryFilesContainer.innerHTML = `<div class="empty-state"><div class="empty-state-text">No files in this category</div></div>`;
    } else {
        const grid = document.createElement('div');
        grid.className = 'file-cards-grid';
        subset.forEach(f => grid.appendChild(buildFileCard(f)));
        categoryFilesContainer.appendChild(grid);
    }

    switchView('category');
}

/* ---- Render file cards ---- */
function renderFileCards(files) {
    myFilesContainer.className = viewMode === 'grid' ? 'files-grid-view' : 'files-list-view';
    myFilesContainer.innerHTML = '';

    if (!files.length) {
        const msg = activeTab === 'all' ? 'No files yet' : `No ${capFirst(activeTab)} files`;
        const sub = activeTab === 'all' ? 'Upload your first file to get started' : 'Upload files and they will appear here after classification';
        myFilesContainer.innerHTML = `
            <div class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <div class="empty-state-text">${escH(msg)}</div>
                <div class="empty-state-subtext">${escH(sub)}</div>
                ${activeTab === 'all' ? '<button class="btn btn-primary" onclick="switchView(\'upload\')" style="margin-top:12px;">Upload Now</button>' : ''}
            </div>`;
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'file-cards-grid';
    files.forEach((f, idx) => { grid.appendChild(buildFileCard(f, idx)); });
    myFilesContainer.appendChild(grid);
}

function buildFileCard(f) {
    const cat  = (f.category || 'uncategorized').toLowerCase();
    const cs   = catStyle(cat);
    const conf = Math.min(100, f.confidence ?? 0);
    const size = typeof f.file_size === 'number' ? fmtSize(f.file_size) : (f.file_size || '—');
    const path = f.folder_location || '';

    const card = document.createElement('div');
    card.className = 'file-card';
    card.style.setProperty('--card-accent', cs.color);

    card.innerHTML = `
        <div class="file-card-top">
            <div class="file-card-icon" style="color:${cs.color};background:${cs.bg};border-color:${cs.border};">
                ${getFileTypeIcon(f.file_name || '')}
            </div>
            <span class="file-card-badge" style="background:${cs.bg};border-color:${cs.border};color:${cs.color};">
                ${escH(capFirst(cat))}
            </span>
        </div>
        <div class="file-card-name" title="${escH(f.file_name || '')}">${escH(f.file_name || 'Unknown')}</div>
        <div class="conf-bar-wrap">
            <div class="conf-bar-track">
                <div class="conf-bar-fill" style="width:${conf}%;background:${cs.color};"></div>
            </div>
            <span class="conf-val">${conf}%</span>
        </div>
        <div class="file-card-meta">
            <span>${size}</span>
            <div class="file-card-actions">
                <button class="icon-btn icon-btn-view"     title="View details"  onclick="event.stopPropagation();openDocModal(${JSON.stringify(f)})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="icon-btn icon-btn-share"    title="Copy share link" onclick="event.stopPropagation();shareDoc('${escH(path)}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
                <button class="icon-btn icon-btn-download" title="Download"       onclick="event.stopPropagation();downloadDoc('${escH(path)}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="icon-btn icon-btn-delete"   title="Delete"         onclick="event.stopPropagation();deleteDoc('${escH(path)}', '${escH(f.file_name || '')}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
            </div>
        </div>`;

    card.addEventListener('click', () => openDocModal(f));
    return card;
}

function updateStats(files) {
    const cats = new Set(files.map(f => (f.category || 'uncategorized').toLowerCase()));
    statsTotalFiles.textContent  = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    statsCategories.textContent  = `${cats.size} categor${cats.size !== 1 ? 'ies' : 'y'}`;
}

/* ============================================================
   DOCUMENT MODAL
   ============================================================ */
function openDocModal(doc) {
    const cat = (doc.category || 'uncategorized').toLowerCase();
    const cs  = catStyle(cat);
    modalDocPath = doc.folder_location || '';
    modalDocName = doc.file_name || 'this file';

    docModalTitle.textContent = doc.file_name || 'Document';
    docModalDownloadBtn.onclick = () => downloadDoc(modalDocPath);
    if (docModalDeleteBtn) {
        docModalDeleteBtn.onclick = () => deleteDoc(modalDocPath, modalDocName);
    }

    const preview = (doc.content_text || '').substring(0, 1500);
    const hasMore  = (doc.content_text || '').length > 1500;
    const summary = (doc.summary_text || '').trim();

    docModalBody.innerHTML = `
        <div class="detail-grid">
            <div class="detail-row"><div class="detail-label">Category</div>
                <div class="detail-value">
                    <span style="display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;
                        background:${cs.bg};border:1px solid ${cs.border};color:${cs.color};">
                        ${escH(capFirst(cat))}
                    </span>
                </div>
            </div>
            <div class="detail-row"><div class="detail-label">Confidence</div>
                <div class="detail-value">
                    <div class="conf-bar-wrap" style="width:160px;">
                        <div class="conf-bar-track"><div class="conf-bar-fill" style="width:${Math.min(100,doc.confidence??0)}%;background:${cs.color};"></div></div>
                        <span class="conf-val">${doc.confidence ?? 0}%</span>
                    </div>
                </div>
            </div>
            <div class="detail-row"><div class="detail-label">File Size</div><div class="detail-value">${typeof doc.file_size==='number' ? fmtSize(doc.file_size) : '—'}</div></div>
            <div class="detail-row"><div class="detail-label">MIME Type</div><div class="detail-value">${escH(doc.mime_type || '—')}</div></div>
            <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${escH(doc.status || '—')}</div></div>
            ${summary ? `
            <div class="detail-row"><div class="detail-label">Summary</div><div class="detail-value" style="line-height:1.6;">${escH(summary)}</div></div>
            ` : ''}
            ${preview ? `
            <div class="detail-row">
                <div class="detail-label">Content Preview</div>
                <div class="detail-value">
                    <div style="max-height:160px;overflow-y:auto;padding:10px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;font-size:12px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.6;">
                        ${escH(preview)}${hasMore ? '\n\n… (truncated)' : ''}
                    </div>
                </div>
            </div>` : ''}
        </div>`;

    modalBackdrop.hidden = false;
    docModal.hidden = false;
}

function closeDocModal() { docModal.hidden = true; modalBackdrop.hidden = true; }

docModalClose.addEventListener('click', closeDocModal);
docModalCloseBtn.addEventListener('click', closeDocModal);
modalBackdrop.addEventListener('click', closeDocModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDocModal(); });

/* ============================================================
   SEARCH
   ============================================================ */
async function doSearch(query) {
    if (!query) { showToast('error', 'Search', 'Enter a search term.'); return; }

    const section   = document.getElementById('section-search');
    const container = document.getElementById('searchResultsContainer');
    const countEl   = document.getElementById('searchResultsCount');
    const titleEl   = document.getElementById('searchResultsTitle');

    section.hidden = false;
    container.innerHTML = `<div class="empty-state"><div class="status-spinner" style="margin:0 auto 8px;"></div><div class="empty-state-text">Searching…</div></div>`;
    countEl.textContent = '';

    try {
        const url = `/search?q=${encodeURIComponent(query)}`;
        const res  = await fetchWithAuth(url);
        const data = await parseJsonGuarded(res);
        const results = data.results || [];

        titleEl.textContent  = `Results for "${query}"`;
        countEl.textContent  = `${results.length} result${results.length !== 1 ? 's' : ''}`;

        if (!results.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <div class="empty-state-text">No matches for "${escH(query)}"</div>
                    <div class="empty-state-subtext">Try different keywords or upload more files.</div>
                </div>`;
            return;
        }

        const rows = results.map((r, i) => {
            const cat = (r.category||'uncategorized').toLowerCase();
            const cs  = catStyle(cat);
            return `
            <tr>
                <td class="cell-file">${escH(r.file_name||'Unknown')}</td>
                <td><span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${cs.bg};border:1px solid ${cs.border};color:${cs.color};">${escH(capFirst(cat))}</span></td>
                <td>${r.confidence??0}%</td>
                <td>${typeof r.file_size==='number' ? fmtSize(r.file_size) : (r.file_size||'—')}</td>
                <td class="cell-actions">
                    <button class="action-btn action-view" title="View" onclick="openDocModal(${JSON.stringify(r).replace(/"/g,'&quot;')})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="action-btn action-download" title="Download" onclick="downloadDoc('${escH(r.folder_location||'')}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button class="action-btn action-delete" title="Delete" onclick="deleteDoc('${escH(r.folder_location||'')}', '${escH(r.file_name||'')}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>File</th><th>Category</th><th>Confidence</th><th>Size</th><th>Actions</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${escH(err.message)}</div></div>`;
    }
}

/* ============================================================
   FILE ACTIONS
   ============================================================ */
async function downloadDoc(path) {
    if (!path) return showToast('error', 'Download', 'No file path available.');
    try {
        const res  = await fetchWithAuth(`/api/download?path=${encodeURIComponent(path)}`);
        const json = await parseJsonGuarded(res);
        if (json.url) window.open(json.url, '_blank');
        else showToast('error', 'Download', 'Could not generate download URL.');
    } catch (e) { showToast('error', 'Download Failed', e.message); }
}

async function shareDoc(path) {
    if (!path) return showToast('error', 'Share', 'No file path available.');
    try {
        const res  = await fetchWithAuth(`/api/share?path=${encodeURIComponent(path)}`);
        const json = await parseJsonGuarded(res);
        if (json.url) { await navigator.clipboard.writeText(json.url); showToast('success', 'Link Copied', 'Share link copied (valid 7 days).'); }
        else showToast('error', 'Share', 'Could not generate link.');
    } catch (e) { showToast('error', 'Share Failed', e.message); }
}

async function deleteDoc(path, fileName = 'this file') {
    if (!path) {
        showToast('error', 'Delete', 'No file path available.');
        return;
    }

    const ok = window.confirm(`Delete ${fileName}? This cannot be undone.`);
    if (!ok) return;

    try {
        const res = await fetchWithAuth('/api/my-documents', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const payload = await parseJsonGuarded(res);
        showToast('success', 'Deleted', payload.message || 'File deleted successfully.');
        closeDocModal();
        await loadMyFiles();
    } catch (e) {
        showToast('error', 'Delete Failed', e.message);
    }
}

// Expose to inline onclick handlers
window.openDocModal = openDocModal;
window.downloadDoc  = downloadDoc;
window.shareDoc     = shareDoc;
window.deleteDoc    = deleteDoc;
window.switchView   = switchView;

/* ============================================================
   TOAST
   ============================================================ */
function showToast(type, title, message) {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icon = type === 'error'
        ? `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
        : `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    t.innerHTML = `${icon}<div class="toast-body"><div class="toast-title">${escH(title)}</div><div class="toast-message">${escH(message)}</div></div><button class="toast-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    t.querySelector('.toast-close').addEventListener('click', () => dismiss(t));
    toastContainer.appendChild(t);
    setTimeout(() => dismiss(t), 5000);
}

function dismiss(t) {
    if (!t || !t.parentNode) return;
    t.classList.add('toast-dismiss');
    setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 200);
}

/* ============================================================
   UTILITIES
   ============================================================ */
function escH(str) {
    const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML;
}

function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1048576).toFixed(1)} MB`;
}

function capFirst(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function getFileTypeIcon(filename) {
    const ext = (filename||'').split('.').pop().toLowerCase();
    const docIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    const imgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    return ['png','jpg','jpeg','gif','webp','svg'].includes(ext) ? imgIcon : docIcon;
}

async function parseJsonGuarded(res) {
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Request failed (${res.status}): ${txt || res.statusText}`);
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) throw new Error('Server returned non-JSON.');
    return res.json();
}

/* ============================================================
   INIT — Start on upload view
   ============================================================ */
switchView('upload');
