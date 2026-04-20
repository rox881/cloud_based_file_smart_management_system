/* ============================================================
   Admin Dashboard — admin.js
   All CRUD, modal, tab, and rendering logic
   ============================================================ */

// --- DOM ---
const appLayout     = document.getElementById("appLayout");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarLogo   = document.getElementById("sidebarLogoBtn");
const toastContainer = document.getElementById("toastContainer");

// Stats
const statDocsValue       = document.getElementById("statDocsValue");
const statCatsValue       = document.getElementById("statCatsValue");
const statClassifiedValue = document.getElementById("statClassifiedValue");
const statSizeValue       = document.getElementById("statSizeValue");
const breakdownPanel      = document.getElementById("breakdownPanel");
const breakdownBars       = document.getElementById("breakdownBars");

// Tabs
const tabDocuments  = document.getElementById("tabDocuments");
const tabCategories = document.getElementById("tabCategories");
const panelDocuments  = document.getElementById("panelDocuments");
const panelCategories = document.getElementById("panelCategories");

// Tables
const docsTableWrap = document.getElementById("docsTableWrap");
const docsCount     = document.getElementById("docsCount");
const catsTableWrap = document.getElementById("catsTableWrap");
const catsCount     = document.getElementById("catsCount");

// Modals
const modalBackdrop = document.getElementById("modalBackdrop");

const viewDocModal    = document.getElementById("viewDocModal");
const viewDocBody     = document.getElementById("viewDocBody");
const viewDocClose    = document.getElementById("viewDocClose");
const viewDocCloseBtn = document.getElementById("viewDocCloseBtn");

const editDocModal     = document.getElementById("editDocModal");
const editDocForm      = document.getElementById("editDocForm");
const editDocClose     = document.getElementById("editDocClose");
const editDocCancelBtn = document.getElementById("editDocCancelBtn");
const editDocId        = document.getElementById("editDocId");
const editDocFileName  = document.getElementById("editDocFileName");
const editDocCategory  = document.getElementById("editDocCategory");
const editDocConfidence = document.getElementById("editDocConfidence");
const editDocStatus    = document.getElementById("editDocStatus");
const editDocMime      = document.getElementById("editDocMime");

const catModal       = document.getElementById("catModal");
const catForm        = document.getElementById("catForm");
const catModalTitle  = document.getElementById("catModalTitle");
const catModalClose  = document.getElementById("catModalClose");
const catCancelBtn   = document.getElementById("catCancelBtn");
const catSubmitBtn   = document.getElementById("catSubmitBtn");
const catModalId     = document.getElementById("catModalId");
const catName        = document.getElementById("catName");
const catKeywords    = document.getElementById("catKeywords");
const catExtensions  = document.getElementById("catExtensions");
const catWeight      = document.getElementById("catWeight");
const addCategoryBtn = document.getElementById("addCategoryBtn");

const deleteModal      = document.getElementById("deleteModal");
const deleteMessage    = document.getElementById("deleteMessage");
const deleteModalClose = document.getElementById("deleteModalClose");
const deleteCancelBtn  = document.getElementById("deleteCancelBtn");
const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");

// --- State ---
let documentsData = [];
let categoriesData = [];
let pendingDelete = null; // { type: "document"|"category", id: number, name: string }

// ============================================================
//  Sidebar
// ============================================================
sidebarToggle.addEventListener("click", () => appLayout.classList.toggle("sidebar-expanded"));
sidebarLogo.addEventListener("click", () => appLayout.classList.toggle("sidebar-expanded"));

// ============================================================
//  Tabs
// ============================================================
tabDocuments.addEventListener("click", () => switchTab("documents"));
tabCategories.addEventListener("click", () => switchTab("categories"));

function switchTab(tab) {
    tabDocuments.classList.toggle("active", tab === "documents");
    tabCategories.classList.toggle("active", tab === "categories");
    panelDocuments.classList.toggle("active", tab === "documents");
    panelCategories.classList.toggle("active", tab === "categories");
}

// ============================================================
//  Init
// ============================================================
loadStats();
loadDocuments();
loadCategories();

// ============================================================
//  Stats
// ============================================================
async function loadStats() {
    try {
        const res = await fetch("/api/admin/stats");
        const data = await parseJson(res);
        statDocsValue.textContent = data.total_documents ?? "—";
        statCatsValue.textContent = data.total_categories ?? "—";
        statClassifiedValue.textContent = data.classified_count ?? "—";
        statSizeValue.textContent = formatSize(data.total_size_bytes || 0);

        // Breakdown
        const bd = data.category_breakdown || {};
        const entries = Object.entries(bd).sort((a, b) => b[1] - a[1]);
        if (entries.length > 0) {
            breakdownPanel.hidden = false;
            const maxVal = entries[0][1];
            breakdownBars.innerHTML = entries.map(([cat, count], i) => `
                <div class="breakdown-row">
                    <span class="breakdown-label">${esc(cat)}</span>
                    <div class="breakdown-track">
                        <div class="breakdown-fill cat-${i % 8}" style="width:${Math.round((count / maxVal) * 100)}%"></div>
                    </div>
                    <span class="breakdown-count">${count}</span>
                </div>
            `).join("");
        }
    } catch (e) {
        console.error("Failed to load stats:", e);
    }
}

// ============================================================
//  Documents Table
// ============================================================
async function loadDocuments() {
    docsTableWrap.innerHTML = `<div class="empty-state"><div class="status-spinner" style="margin:0 auto 8px;"></div><div class="empty-state-text">Loading documents…</div></div>`;
    try {
        const res = await fetch("/api/admin/documents");
        const json = await parseJson(res);
        documentsData = json.data || [];
        renderDocumentsTable();
    } catch (e) {
        docsTableWrap.innerHTML = `<div class="empty-state"><div class="empty-state-text">Failed to load documents.</div></div>`;
        showToast("error", "Load Error", e.message);
    }
}

function renderDocumentsTable() {
    if (documentsData.length === 0) {
        docsCount.textContent = "";
        docsTableWrap.innerHTML = `<div class="empty-state"><div class="empty-state-text">No documents found.</div></div>`;
        return;
    }
    docsCount.textContent = `${documentsData.length} record${documentsData.length !== 1 ? "s" : ""}`;
    docsTableWrap.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>File Name</th>
                    <th>Category</th>
                    <th>Confidence</th>
                    <th>Size</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${documentsData.map(doc => {
                    const isClassified = (doc.status || "").toLowerCase() === "classified";
                    return `
                    <tr>
                        <td>${doc.id ?? ""}</td>
                        <td class="cell-file">${esc(doc.file_name || "—")}</td>
                        <td><span class="badge-category">${esc(doc.category || "—")}</span></td>
                        <td>${doc.confidence ?? 0}%</td>
                        <td>${formatSize(doc.file_size || 0)}</td>
                        <td>${esc(doc.mime_type || "—")}</td>
                        <td><span class="badge ${isClassified ? "badge-classified" : "badge-pending"}">${esc(doc.status || "—")}</span></td>
                        <td class="cell-actions">
                            <button class="action-btn action-view" title="View details" onclick="viewDocument(${doc.id})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                            <button class="action-btn action-edit" title="Edit" onclick="openEditDoc(${doc.id})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button class="action-btn action-download" title="Download" onclick="downloadFile('${esc(doc.folder_location || "")}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </button>
                            <button class="action-btn action-share" title="Copy share link" onclick="shareFile('${esc(doc.folder_location || "")}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                            </button>
                            <button class="action-btn action-delete" title="Delete" onclick="confirmDelete('document',${doc.id},'${esc(doc.file_name || "")}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </td>
                    </tr>`;
                }).join("")}
            </tbody>
        </table>
    `;
}

// ============================================================
//  Categories Table
// ============================================================
async function loadCategories() {
    catsTableWrap.innerHTML = `<div class="empty-state"><div class="status-spinner" style="margin:0 auto 8px;"></div><div class="empty-state-text">Loading categories…</div></div>`;
    try {
        const res = await fetch("/api/admin/categories");
        const json = await parseJson(res);
        categoriesData = json.data || [];
        renderCategoriesTable();
    } catch (e) {
        catsTableWrap.innerHTML = `<div class="empty-state"><div class="empty-state-text">Failed to load categories.</div></div>`;
        showToast("error", "Load Error", e.message);
    }
}

function renderCategoriesTable() {
    if (categoriesData.length === 0) {
        catsCount.textContent = "";
        catsTableWrap.innerHTML = `<div class="empty-state"><div class="empty-state-text">No categories found.</div></div>`;
        return;
    }
    catsCount.textContent = `${categoriesData.length} record${categoriesData.length !== 1 ? "s" : ""}`;
    catsTableWrap.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Category Name</th>
                    <th>Keywords</th>
                    <th>Extensions</th>
                    <th>Weight</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${categoriesData.map(cat => `
                    <tr>
                        <td>${cat.id ?? ""}</td>
                        <td class="cell-file">${esc(cat.category_name || "—")}</td>
                        <td>${renderTags(cat.keywords)}</td>
                        <td>${renderTags(cat.extensions)}</td>
                        <td>${cat.score_weight ?? 1}</td>
                        <td class="cell-actions">
                            <button class="action-btn action-edit" title="Edit" onclick="openEditCategory(${cat.id})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button class="action-btn action-delete" title="Delete" onclick="confirmDelete('category',${cat.id},'${esc(cat.category_name || "")}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function renderTags(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return '<span class="tag">—</span>';
    const maxShow = 5;
    const displayed = arr.slice(0, maxShow);
    const remaining = arr.length - maxShow;
    let html = '<div class="tag-list">';
    html += displayed.map(t => `<span class="tag">${esc(String(t))}</span>`).join("");
    if (remaining > 0) html += `<span class="tag-more">+${remaining} more</span>`;
    html += '</div>';
    return html;
}

// ============================================================
//  View Document
// ============================================================
async function viewDocument(id) {
    openModal(viewDocModal);
    viewDocBody.innerHTML = `<div class="empty-state"><div class="status-spinner" style="margin:0 auto 8px;"></div><div class="empty-state-text">Loading…</div></div>`;
    try {
        const res = await fetch(`/api/admin/documents/${id}`);
        const json = await parseJson(res);
        const doc = json.data;
        if (!doc) throw new Error("Document not found.");

        const contentPreview = (doc.content_text || "").substring(0, 2000);
        const hasMore = (doc.content_text || "").length > 2000;

        viewDocBody.innerHTML = `
            <div class="detail-grid">
                <div class="detail-row"><div class="detail-label">ID</div><div class="detail-value">${doc.id ?? "—"}</div></div>
                <div class="detail-row"><div class="detail-label">File Name</div><div class="detail-value">${esc(doc.file_name || "—")}</div></div>
                <div class="detail-row"><div class="detail-label">Category</div><div class="detail-value"><span class="badge-category">${esc(doc.category || "—")}</span></div></div>
                <div class="detail-row"><div class="detail-label">Confidence</div><div class="detail-value">${doc.confidence ?? 0}%</div></div>
                <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${esc(doc.status || "—")}</div></div>
                <div class="detail-row"><div class="detail-label">MIME Type</div><div class="detail-value">${esc(doc.mime_type || "—")}</div></div>
                <div class="detail-row"><div class="detail-label">File Size</div><div class="detail-value">${formatSize(doc.file_size || 0)}</div></div>
                <div class="detail-row"><div class="detail-label">Location</div><div class="detail-value">${esc(doc.folder_location || "—")}</div></div>
                <div class="detail-row"><div class="detail-label">Content</div><div class="detail-value text-preview">${esc(contentPreview) || "(empty)"}${hasMore ? "\n\n… (truncated)" : ""}</div></div>
            </div>
        `;
    } catch (e) {
        viewDocBody.innerHTML = `<div class="empty-state"><div class="empty-state-text">${esc(e.message)}</div></div>`;
    }
}

viewDocClose.addEventListener("click", () => closeModal(viewDocModal));
viewDocCloseBtn.addEventListener("click", () => closeModal(viewDocModal));

// ============================================================
//  Edit Document
// ============================================================
function openEditDoc(id) {
    const doc = documentsData.find(d => d.id === id);
    if (!doc) return showToast("error", "Error", "Document not found in local data.");
    editDocId.value = id;
    editDocFileName.value = doc.file_name || "";
    editDocCategory.value = doc.category || "";
    editDocConfidence.value = doc.confidence ?? 0;
    editDocStatus.value = doc.status || "uncategorized";
    editDocMime.value = doc.mime_type || "";
    openModal(editDocModal);
}

editDocClose.addEventListener("click", () => closeModal(editDocModal));
editDocCancelBtn.addEventListener("click", () => closeModal(editDocModal));

editDocForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = editDocId.value;
    const payload = {
        file_name: editDocFileName.value.trim(),
        category: editDocCategory.value.trim(),
        confidence: Number(editDocConfidence.value) || 0,
        status: editDocStatus.value,
        mime_type: editDocMime.value.trim(),
    };
    try {
        const res = await fetch(`/api/admin/documents/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        await parseJson(res);
        closeModal(editDocModal);
        showToast("success", "Updated", "Document updated successfully.");
        loadDocuments();
        loadStats();
    } catch (e) {
        showToast("error", "Update Failed", e.message);
    }
});

// ============================================================
//  Download & Share File
// ============================================================
async function downloadFile(path) {
    if (!path) return showToast("error", "Download", "No file path available.");
    try {
        const res = await fetch(`/api/download?path=${encodeURIComponent(path)}`);
        const json = await parseJson(res);
        if (json.url) {
            window.open(json.url, "_blank");
        } else {
            showToast("error", "Download", "Could not generate download URL.");
        }
    } catch (e) {
        showToast("error", "Download Failed", e.message);
    }
}

async function shareFile(path) {
    if (!path) return showToast("error", "Share", "No file path available.");
    try {
        const res = await fetch(`/api/share?path=${encodeURIComponent(path)}`);
        const json = await parseJson(res);
        if (json.url) {
            await navigator.clipboard.writeText(json.url);
            showToast("success", "Link Copied", "Share link copied to clipboard (valid for 7 days).");
        } else {
            showToast("error", "Share", "Could not generate share link.");
        }
    } catch (e) {
        showToast("error", "Share Failed", e.message);
    }
}

// ============================================================
//  Category Create / Edit
// ============================================================
addCategoryBtn.addEventListener("click", () => {
    catModalId.value = "";
    catModalTitle.textContent = "Add Category";
    catSubmitBtn.textContent = "Create Category";
    catName.value = "";
    catKeywords.value = "";
    catExtensions.value = "";
    catWeight.value = "1";
    openModal(catModal);
});

function openEditCategory(id) {
    const cat = categoriesData.find(c => c.id === id);
    if (!cat) return showToast("error", "Error", "Category not found.");
    catModalId.value = id;
    catModalTitle.textContent = "Edit Category";
    catSubmitBtn.textContent = "Save Changes";
    catName.value = cat.category_name || "";
    catKeywords.value = (cat.keywords || []).join(", ");
    catExtensions.value = (cat.extensions || []).join(", ");
    catWeight.value = cat.score_weight ?? 1;
    openModal(catModal);
}

catModalClose.addEventListener("click", () => closeModal(catModal));
catCancelBtn.addEventListener("click", () => closeModal(catModal));

catForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = catModalId.value;
    const payload = {
        category_name: catName.value.trim(),
        keywords: catKeywords.value.split(",").map(s => s.trim()).filter(Boolean),
        extensions: catExtensions.value.split(",").map(s => s.trim()).filter(Boolean),
        score_weight: Number(catWeight.value) || 1,
    };

    try {
        if (id) {
            // Update
            const res = await fetch(`/api/admin/categories/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            await parseJson(res);
            showToast("success", "Updated", "Category updated successfully.");
        } else {
            // Create
            const res = await fetch("/api/admin/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            await parseJson(res);
            showToast("success", "Created", "Category created successfully.");
        }
        closeModal(catModal);
        loadCategories();
        loadStats();
    } catch (e) {
        showToast("error", "Save Failed", e.message);
    }
});

// ============================================================
//  Delete Confirmation
// ============================================================
function confirmDelete(type, id, name) {
    pendingDelete = { type, id, name };
    deleteMessage.textContent = `Are you sure you want to delete "${name || "this item"}"? This action cannot be undone.`;
    openModal(deleteModal);
}

deleteModalClose.addEventListener("click", () => { pendingDelete = null; closeModal(deleteModal); });
deleteCancelBtn.addEventListener("click", () => { pendingDelete = null; closeModal(deleteModal); });

deleteConfirmBtn.addEventListener("click", async () => {
    if (!pendingDelete) return;
    const { type, id } = pendingDelete;
    try {
        const endpoint = type === "document"
            ? `/api/admin/documents/${id}`
            : `/api/admin/categories/${id}`;
        const res = await fetch(endpoint, { method: "DELETE" });
        await parseJson(res);
        closeModal(deleteModal);
        showToast("success", "Deleted", `${type === "document" ? "Document" : "Category"} deleted.`);
        pendingDelete = null;
        if (type === "document") loadDocuments();
        else loadCategories();
        loadStats();
    } catch (e) {
        showToast("error", "Delete Failed", e.message);
    }
});

// ============================================================
//  Modal Helpers
// ============================================================
function openModal(modal) {
    modalBackdrop.hidden = false;
    modal.hidden = false;
}

function closeModal(modal) {
    modal.hidden = true;
    // Close backdrop if no other modal is open
    const allModals = [viewDocModal, editDocModal, catModal, deleteModal];
    if (allModals.every(m => m.hidden)) {
        modalBackdrop.hidden = true;
    }
}

modalBackdrop.addEventListener("click", () => {
    [viewDocModal, editDocModal, catModal, deleteModal].forEach(m => m.hidden = true);
    modalBackdrop.hidden = true;
    pendingDelete = null;
});

// Close on Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        [viewDocModal, editDocModal, catModal, deleteModal].forEach(m => m.hidden = true);
        modalBackdrop.hidden = true;
        pendingDelete = null;
    }
});

// ============================================================
//  Toast Notifications
// ============================================================
function showToast(type, title, message) {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const iconSvg = type === "error"
        ? `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
        : `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    toast.innerHTML = `
        ${iconSvg}
        <div class="toast-body">
            <div class="toast-title">${esc(title)}</div>
            <div class="toast-message">${esc(message)}</div>
        </div>
        <button class="toast-close" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;
    toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
    toastContainer.appendChild(toast);
    setTimeout(() => dismissToast(toast), 5000);
}

function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add("toast-dismiss");
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200);
}

// ============================================================
//  Utilities
// ============================================================
function esc(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function formatSize(bytes) {
    if (typeof bytes !== "number" || bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

async function parseJson(response) {
    if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Request failed (${response.status}): ${raw || response.statusText}`);
    }
    const ct = response.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) {
        const raw = await response.text();
        throw new Error("Server returned a non-JSON response.");
    }
    return response.json();
}
