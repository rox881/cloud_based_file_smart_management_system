/* ============================================================
   Smart Document Classifier — main.js
   Dark Enterprise Dashboard — UI Logic
   ============================================================ */

// --- DOM References ---
const appLayout     = document.getElementById("appLayout");
const sidebar       = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarLogo   = document.getElementById("sidebarLogoBtn");

const dropArea      = document.getElementById("dropArea");
const fileInput     = document.getElementById("fileInput");
const browseBtn     = document.getElementById("browseBtn");
const fileList      = document.getElementById("fileList");
const classifyBtn   = document.getElementById("classifyBtn");
const classifyActions = document.getElementById("classifyActions");
const fileCountEl   = document.getElementById("fileCount");

const searchInput   = document.getElementById("searchInput");
const searchBtn     = document.getElementById("searchBtn");

const statusBanner     = document.getElementById("statusBanner");
const statusText       = document.getElementById("statusText");
const statusProgressBar = document.getElementById("statusProgressBar");

const resultsSection   = document.getElementById("section-results");
const resultsTitle     = document.getElementById("resultsTitle");
const resultsCount     = document.getElementById("resultsCount");
const resultsContainer = document.getElementById("resultsContainer");

const searchSection          = document.getElementById("section-search");
const searchResultsTitle     = document.getElementById("searchResultsTitle");
const searchResultsCount     = document.getElementById("searchResultsCount");
const searchResultsContainer = document.getElementById("searchResultsContainer");

const toastContainer = document.getElementById("toastContainer");
const shareModal = document.getElementById("shareModal");
const shareForm = document.getElementById("shareForm");
const shareModalClose = document.getElementById("shareModalClose");
const shareCancelBtn = document.getElementById("shareCancelBtn");
const shareRecipientEmail = document.getElementById("shareRecipientEmail");
const sharePermission = document.getElementById("sharePermission");
const shareMessageInput = document.getElementById("shareMessage");
const shareSubmitBtn = document.getElementById("shareSubmitBtn");

// --- State ---
let uploadedFiles = [];
let activeJobId   = null;
let pollTimer     = null;
let currentClassificationDetails = [];
let currentSearchResults = [];
let pendingShareEntry = null;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

shareForm.addEventListener("submit", submitShareForm);
shareModalClose.addEventListener("click", closeShareModal);
shareCancelBtn.addEventListener("click", closeShareModal);
shareModal.addEventListener("click", (event) => {
    if (event.target === shareModal) {
        closeShareModal();
    }
});

resultsContainer.addEventListener("click", (event) => {
    const button = event.target.closest(".share-result-btn");
    if (!button) return;

    const index = Number(button.dataset.index);
    const entry = currentClassificationDetails[index];
    if (!entry) return;

    shareResultEntry(entry);
});

searchResultsContainer.addEventListener("click", (event) => {
    const button = event.target.closest(".share-search-btn");
    if (!button) return;

    const index = Number(button.dataset.index);
    const entry = currentSearchResults[index];
    if (!entry) return;

    shareResultEntry({
        file: entry.file_name || "Unknown file",
        destination: entry.folder_location || "",
    });
});

// --- Sidebar ---
sidebarToggle.addEventListener("click", () => {
    appLayout.classList.toggle("sidebar-expanded");
});

sidebarLogo.addEventListener("click", () => {
    appLayout.classList.toggle("sidebar-expanded");
});

// Sidebar nav — smooth scroll & active state
document.querySelectorAll(".sidebar-nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
        e.preventDefault();
        const sectionId = item.getAttribute("data-section");
        const section = document.getElementById(sectionId);

        // Make section visible if hidden
        if (section && section.hidden) {
            section.hidden = false;
        }

        if (section) {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        // Set active
        document.querySelectorAll(".sidebar-nav-item").forEach((n) => n.classList.remove("active"));
        item.classList.add("active");
    });
});

// --- Upload ---
browseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
});

dropArea.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => processFiles(e.target.files));
dropArea.addEventListener("dragover", handleDragOver);
dropArea.addEventListener("dragleave", handleDragLeave);
dropArea.addEventListener("drop", handleFileDrop);

function handleDragOver(event) {
    event.preventDefault();
    dropArea.classList.add("dragover");
}

function handleDragLeave() {
    dropArea.classList.remove("dragover");
}

function handleFileDrop(event) {
    event.preventDefault();
    dropArea.classList.remove("dragover");
    processFiles(event.dataTransfer.files);
}

function processFiles(files) {
    if (!files || files.length === 0) return;
    uploadedFiles = Array.from(files);
    renderFileList();
    classifyBtn.disabled = false;
    classifyActions.style.display = "flex";
    fileCountEl.textContent = `${uploadedFiles.length} file${uploadedFiles.length !== 1 ? "s" : ""} selected`;
}

// --- File List ---
function getFileTypeIcon(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const icons = {
        pdf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        docx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        txt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        png: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
        jpg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
        jpeg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    };
    return icons[ext] || icons.txt;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function renderFileList() {
    fileList.innerHTML = "";
    uploadedFiles.forEach((file) => {
        const item = document.createElement("div");
        item.className = "file-item";
        item.innerHTML = `
            <div class="file-icon">${getFileTypeIcon(file.name)}</div>
            <div class="file-info">
                <div class="file-name">${escapeHtml(file.name)}</div>
                <div class="file-meta">${formatFileSize(file.size)} · ${file.type || "unknown"}</div>
            </div>
            <span class="badge badge-pending">Pending</span>
        `;
        fileList.appendChild(item);
    });
}

// --- Search ---
searchBtn.addEventListener("click", searchDocuments);
searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchDocuments();
});

// --- Classify ---
classifyBtn.addEventListener("click", classifyAll);

async function classifyAll() {
    if (uploadedFiles.length === 0) return;

    // Show status banner
    statusBanner.hidden = false;
    statusText.textContent = "Submitting upload...";
    statusProgressBar.style.width = "0%";
    classifyBtn.disabled = true;
    searchBtn.disabled = true;

    // Hide previous results
    resultsSection.hidden = true;

    try {
        const formData = new FormData();
        uploadedFiles.forEach((file) => formData.append("files", file));

        const response = await fetch("/api/classify", {
            method: "POST",
            body: formData,
        });

        const data = await parseJsonGuarded(response);

        if (data.job_id) {
            activeJobId = data.job_id;
            statusText.textContent = data.message || "Upload received. Processing in background.";
            startJobPolling(activeJobId);
            return;
        }

        // Synchronous result
        statusBanner.hidden = true;
        renderClassifyResults(data);
    } catch (error) {
        statusBanner.hidden = true;
        showToast("error", "Upload Failed", error.message);
    } finally {
        if (!activeJobId) {
            classifyBtn.disabled = false;
            searchBtn.disabled = false;
        }
    }
}

// --- Job Polling ---
function stopPolling() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

function startJobPolling(jobId) {
    stopPolling();

    const poll = async () => {
        try {
            const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
            const job = await parseJsonGuarded(response);

            if (job.status === "completed") {
                activeJobId = null;
                statusBanner.hidden = true;
                stopPolling();
                classifyBtn.disabled = false;
                searchBtn.disabled = false;

                renderClassifyResults({ details: job.details || [] });

                if (Array.isArray(job.warnings) && job.warnings.length > 0) {
                    job.warnings.forEach((w) => {
                        showToast("error", `Warning: ${w.file}`, w.error);
                    });
                }
                return;
            }

            if (job.status === "failed") {
                activeJobId = null;
                statusBanner.hidden = true;
                stopPolling();
                classifyBtn.disabled = false;
                searchBtn.disabled = false;

                showToast("error", "Processing Failed", job.error || "Background processing failed.");
                return;
            }

            // Still processing
            const processed = job.processed || 0;
            const total = job.total || 0;
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
            statusText.textContent = `Processing... (${processed}/${total})`;
            statusProgressBar.style.width = `${pct}%`;

            pollTimer = setTimeout(poll, 1500);
        } catch (error) {
            activeJobId = null;
            statusBanner.hidden = true;
            stopPolling();
            classifyBtn.disabled = false;
            searchBtn.disabled = false;
            showToast("error", "Polling Error", error.message);
        }
    };

    poll();
}

// --- Search ---
async function searchDocuments() {
    const query = searchInput.value.trim();
    if (!query) {
        showToast("error", "Search", "Please enter a search term.");
        return;
    }

    // Show search section
    searchSection.hidden = false;
    searchResultsContainer.innerHTML = `<div class="empty-state"><div class="status-spinner" style="margin:0 auto 8px;"></div><div class="empty-state-text">Searching...</div></div>`;
    searchResultsCount.textContent = "";
    searchBtn.disabled = true;

    // Scroll to search
    searchSection.scrollIntoView({ behavior: "smooth", block: "start" });

    // Set active nav
    document.querySelectorAll(".sidebar-nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById("nav-search").classList.add("active");

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
        const data = await parseJsonGuarded(response);
        renderSearchResults(query, data.results || []);
    } catch (error) {
        searchResultsContainer.innerHTML = "";
        showToast("error", "Search Failed", error.message);
    } finally {
        searchBtn.disabled = false;
    }
}

async function shareResultEntry(entry) {
    const storagePath = entry.destination || "";
    if (!storagePath) {
        showToast("error", "Share Failed", "Missing storage path for this file.");
        return;
    }

    pendingShareEntry = {
        file: entry.file || "",
        destination: storagePath,
    };
    openShareModal();
}

function openShareModal() {
    shareForm.reset();
    sharePermission.value = "view";
    shareModal.hidden = false;
    shareRecipientEmail.focus();
}

function closeShareModal() {
    shareModal.hidden = true;
    pendingShareEntry = null;
}

async function submitShareForm(event) {
    event.preventDefault();

    if (!pendingShareEntry) {
        showToast("error", "Share Failed", "No file selected for sharing.");
        closeShareModal();
        return;
    }

    const recipientEmail = shareRecipientEmail.value.trim().toLowerCase();
    const permission = sharePermission.value.trim().toLowerCase() || "view";
    const noteMessage = shareMessageInput.value.trim() || null;

    if (!recipientEmail) {
        showToast("error", "Share Failed", "Recipient email is required.");
        return;
    }
    if (!EMAIL_REGEX.test(recipientEmail)) {
        showToast("error", "Share Failed", "Please enter a valid email address.");
        return;
    }
    if (!["view", "download"].includes(permission)) {
        showToast("error", "Share Failed", "Permission must be either view or download.");
        return;
    }

    shareSubmitBtn.disabled = true;

    try {
        const response = await fetch("/api/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                file_name: pendingShareEntry.file || "",
                storage_path: pendingShareEntry.destination,
                recipient_email: recipientEmail,
                permission,
                message: noteMessage,
            }),
        });

        const data = await parseJsonGuarded(response);
        const responseMessage = data.message || `Share record created for ${recipientEmail}.`;
        showToast("success", "Share Created", responseMessage);
        if (data.warning) {
            showToast("error", "Share Warning", String(data.warning));
        }
        closeShareModal();
    } catch (error) {
        showToast("error", "Share Failed", error.message);
    } finally {
        shareSubmitBtn.disabled = false;
    }
}

// --- Render: Classification Results ---
function renderClassifyResults(data) {
    const details = Array.isArray(data.details) ? data.details : [];
    currentClassificationDetails = details;

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });

    // Set active nav
    document.querySelectorAll(".sidebar-nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById("nav-results").classList.add("active");

    if (details.length === 0) {
        resultsCount.textContent = "";
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <div class="empty-state-text">No files were classified.</div>
            </div>
        `;
        return;
    }

    resultsTitle.textContent = "Classification Results";
    resultsCount.textContent = `${details.length} file${details.length !== 1 ? "s" : ""} processed`;

    resultsContainer.innerHTML = `
        <div class="result-grid">
            ${details.map((entry, index) => {
                const confidence = entry.confidence ?? 0;
                const confidencePct = Math.min(100, confidence);
                const category = entry.category || "uncategorized";
                const isUncategorized = category.toLowerCase() === "uncategorized";
                const canShare = Boolean(entry.destination);

                return `
                    <div class="result-card">
                        <div class="result-card-header">
                            <div class="result-card-file">${escapeHtml(entry.file || "Unknown file")}</div>
                            <span class="badge ${isUncategorized ? "badge-pending" : "badge-classified"}">${escapeHtml(category)}</span>
                        </div>
                        <div class="result-card-body">
                            <div class="result-card-row">
                                <span class="result-card-label">Confidence</span>
                                <div class="confidence-bar">
                                    <div class="confidence-track">
                                        <div class="confidence-fill" style="width: ${confidencePct}%"></div>
                                    </div>
                                    <span class="result-card-value">${confidence}%</span>
                                </div>
                            </div>
                        </div>
                        <div class="result-card-actions" style="margin-top:10px;">
                            <button class="btn btn-outline btn-sm share-result-btn" type="button" data-index="${index}" ${canShare ? "" : "disabled"}>Share</button>
                        </div>
                        ${entry.destination ? `<div class="result-card-destination">📂 ${escapeHtml(entry.destination)}</div>` : ""}
                    </div>
                `;
            }).join("")}
        </div>
    `;

    showToast("success", "Classification Complete", `${details.length} file${details.length !== 1 ? "s" : ""} classified successfully.`);
}

// --- Render: Search Results ---
function renderSearchResults(query, results) {
    currentSearchResults = results;

    if (!results.length) {
        searchResultsCount.textContent = "";
        searchResultsContainer.innerHTML = `
            <div class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    <line x1="8" y1="11" x2="14" y2="11"/>
                </svg>
                <div class="empty-state-text">No matches found for "${escapeHtml(query)}"</div>
                <div class="empty-state-subtext">Try different keywords or check spelling.</div>
            </div>
        `;
        return;
    }

    searchResultsTitle.textContent = `Search: "${escapeHtml(query)}"`;
    searchResultsCount.textContent = `${results.length} result${results.length !== 1 ? "s" : ""}`;

    searchResultsContainer.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>File</th>
                        <th>Location</th>
                        <th>Category</th>
                        <th>Size</th>
                        <th>Type</th>
                        <th>Share</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.map((entry, index) => `
                        <tr>
                            <td class="cell-file">${escapeHtml(entry.file_name || "Unknown")}</td>
                            <td>${escapeHtml(entry.folder_location || "-")}</td>
                            <td><span class="badge-category">${escapeHtml(entry.category || "-")}</span></td>
                            <td>${typeof entry.file_size === "number" ? formatFileSize(entry.file_size) : (entry.file_size || "-")}</td>
                            <td>${escapeHtml(entry.mime_type || "-")}</td>
                            <td>
                                <button class="btn btn-outline btn-sm share-search-btn" type="button" data-index="${index}" ${entry.folder_location ? "" : "disabled"}>Share</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

// --- Toast Notifications ---
function showToast(type, title, message) {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const iconSvg = type === "error"
        ? `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
        : `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;

    toast.innerHTML = `
        ${iconSvg}
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;

    toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
    toastContainer.appendChild(toast);

    // Auto dismiss after 5 seconds
    setTimeout(() => dismissToast(toast), 5000);
}

function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add("toast-dismiss");
    setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
}

// --- Utilities ---
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

async function extractErrorText(response) {
    const rawText = await response.text();
    console.error("HTTP error", {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        body: rawText,
    });
    return rawText;
}

async function parseJsonGuarded(response) {
    if (!response.ok) {
        const rawText = await extractErrorText(response);
        throw new Error(`Request failed (${response.status}): ${rawText || response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
        const rawText = await response.text();
        console.error("Expected JSON but received:", {
            url: response.url,
            status: response.status,
            contentType,
            body: rawText,
        });
        throw new Error("Server returned a non-JSON response.");
    }

    return response.json();
}

// --- Scroll-based active nav tracking ---
const mainEl = document.querySelector(".app-main");
const sectionIds = ["section-upload", "section-results", "section-search"];

mainEl.addEventListener("scroll", () => {
    let activeId = sectionIds[0];
    for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (el && !el.hidden) {
            const rect = el.getBoundingClientRect();
            if (rect.top <= 120) {
                activeId = id;
            }
        }
    }
    document.querySelectorAll(".sidebar-nav-item").forEach((item) => {
        item.classList.toggle("active", item.getAttribute("data-section") === activeId);
    });
});
