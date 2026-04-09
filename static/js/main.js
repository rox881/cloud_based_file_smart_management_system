const dropArea = document.getElementById("dropArea");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const fileList = document.getElementById("fileList");
const classifyBtn = document.getElementById("classifyBtn");
const resultsSection = document.getElementById("resultsSection");
const resultsContainer = document.getElementById("resultsContainer");
const resultsTableBody = document.getElementById("resultsTableBody");
const loadingIndicator = document.getElementById("loadingIndicator");
const loadingText = document.getElementById("loadingText");

let uploadedFiles = [];
let activeJobId = null;
let pollTimer = null;

browseBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    fileInput.click();
});

dropArea.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (event) => processFiles(event.target.files));
dropArea.addEventListener("dragover", handleDragOver);
dropArea.addEventListener("dragleave", handleDragLeave);
dropArea.addEventListener("drop", handleFileDrop);
searchBtn.addEventListener("click", searchDocuments);
searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        searchDocuments();
    }
});
classifyBtn.addEventListener("click", classifyAll);

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
    if (!files || files.length === 0) {
        return;
    }

    uploadedFiles = Array.from(files);
    renderFileList();
    classifyBtn.disabled = false;
}

function stopPolling() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

function renderFileList() {
    fileList.innerHTML = "";
    uploadedFiles.forEach((file) => {
        const item = document.createElement("div");
        item.className = "file-item";
        item.innerHTML = `<span class="file-name">${file.name}</span><span class="file-status">Pending</span>`;
        fileList.appendChild(item);
    });
}

async function extractErrorText(response) {
    const rawText = await response.text();
    console.error("HTTP error", {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        body: rawText
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
            body: rawText
        });
        throw new Error("Server returned a non-JSON response.");
    }

    return response.json();
}

function setLoading(active, text = "Loading...") {
    loadingText.textContent = text;
    loadingIndicator.hidden = !active;
    classifyBtn.disabled = active || uploadedFiles.length === 0;
    searchBtn.disabled = active;
}

async function classifyAll() {
    if (uploadedFiles.length === 0) {
        return;
    }

    resultsSection.hidden = false;
    resultsContainer.textContent = "Processing files...";
    resultsTableBody.innerHTML = "";
    setLoading(true, "Submitting upload...");

    try {
        const formData = new FormData();
        uploadedFiles.forEach((file) => formData.append("files", file));

        const response = await fetch("/api/classify", {
            method: "POST",
            body: formData
        });

        const data = await parseJsonGuarded(response);
        if (data.job_id) {
            activeJobId = data.job_id;
            resultsContainer.textContent = data.message || "Upload received. Processing in background.";
            setLoading(false);
            startJobPolling(activeJobId);
            return;
        }

        renderClassifyResults(data);
    } catch (error) {
        resultsContainer.textContent = `Error: ${error.message}`;
    } finally {
        if (!activeJobId) {
            setLoading(false);
        }
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
                loadingIndicator.hidden = true;
                stopPolling();
                renderClassifyResults({ details: job.details || [] });
                if (Array.isArray(job.warnings) && job.warnings.length > 0) {
                    console.warn("Extraction warnings:", job.warnings);
                }
                return;
            }

            if (job.status === "failed") {
                activeJobId = null;
                loadingIndicator.hidden = true;
                stopPolling();
                resultsContainer.textContent = `Error: ${job.error || "Background processing failed."}`;
                return;
            }

            resultsContainer.textContent = `${job.message || "Processing..."} (${job.processed || 0}/${job.total || 0})`;
            loadingIndicator.hidden = false;
            loadingText.textContent = "Processing in background...";
            pollTimer = setTimeout(poll, 1500);
        } catch (error) {
            activeJobId = null;
            loadingIndicator.hidden = true;
            stopPolling();
            resultsContainer.textContent = `Error: ${error.message}`;
        }
    };

    poll();
}

async function searchDocuments() {
    const query = searchInput.value.trim();
    if (!query) {
        resultsSection.hidden = false;
        resultsContainer.textContent = "Please enter a search term.";
        resultsTableBody.innerHTML = "";
        return;
    }

    resultsSection.hidden = false;
    resultsContainer.textContent = "Searching...";
    resultsTableBody.innerHTML = "";
    setLoading(true, "Searching indexed text...");

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
        const data = await parseJsonGuarded(response);
        renderSearchResults(query, data.results || []);
    } catch (error) {
        resultsContainer.textContent = `Error: ${error.message}`;
    } finally {
        setLoading(false);
    }
}

function renderClassifyResults(data) {
    const details = Array.isArray(data.details) ? data.details : [];

    if (details.length === 0) {
        resultsContainer.textContent = "No files were classified.";
        resultsTableBody.innerHTML = "";
        return;
    }

    resultsTableBody.innerHTML = "";
    resultsContainer.innerHTML = `
        <p>Successfully processed ${details.length} files.</p>
        <div class="result-grid">
            ${details
                .map(
                    (entry) => `
                        <div class="result-card">
                            <div><strong>${entry.file || "Unknown file"}</strong></div>
                            <div>Category: ${entry.category || "Uncategorized"}</div>
                            <div>Confidence: ${entry.confidence ?? "-"}</div>
                            <div>Location: ${entry.destination || "-"}</div>
                        </div>
                    `
                )
                .join("")}
        </div>
    `;
}

function renderSearchResults(query, results) {
    if (!results.length) {
        resultsContainer.textContent = `No matches found for \"${query}\".`;
        return;
    }

    resultsContainer.textContent = `Search results for \"${query}\" (${results.length} found):`;
    resultsTableBody.innerHTML = "";

    results.forEach((entry) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${entry.file_name || "Unknown file"}</td>
            <td>${entry.folder_location || "-"}</td>
            <td>${typeof entry.file_size === "number" ? entry.file_size : entry.file_size || "-"}</td>
            <td>${entry.mime_type || "-"}</td>
        `;
        resultsTableBody.appendChild(row);
    });
}
