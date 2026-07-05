const BACKEND_CORE_API = 'https://cloud-photo-gallery.onrender.com/api';
let activeUiMode = 'login';
let loggedInUserId = localStorage.getItem('userId') || null;
let loggedInUserName = localStorage.getItem('userName') || null;

// Wait completely until the DOM is parsed before attaching events
document.addEventListener("DOMContentLoaded", () => {
    // 1. Check for active session
    if (loggedInUserId) {
        routeToDashboard();
    }

    // 2. Attach Tab Click Observers
    document.getElementById('loginTabBtn').addEventListener('click', () => switchAuthDisplay('login'));
    document.getElementById('registerTabBtn').addEventListener('click', () => switchAuthDisplay('register'));

    // 3. Attach Form Submission Observer
    document.getElementById('authPipelineForm').addEventListener('submit', executeAuthSubmit);

    // 4. Attach Action Button Observers
    document.getElementById('logoutBtn').addEventListener('click', triggerSessionDrop);
    document.getElementById('uploadBtn').addEventListener('click', executeMediaUploadPipeline);
});

function switchAuthDisplay(targetMode) {
    activeUiMode = targetMode;
    
    // Toggle active tab buttons visuals
    document.getElementById('loginTabBtn').classList.toggle('active', targetMode === 'login');
    document.getElementById('registerTabBtn').classList.toggle('active', targetMode === 'register');
    
    // Show or hide name input field smoothly
    const nameField = document.getElementById('nameInputWrapper');
    if (targetMode === 'login') {
        nameField.classList.add('hidden');
    } else {
        nameField.classList.remove('hidden');
    }
    
    document.getElementById('submitActionBtn').innerText = targetMode === 'login' ? 'Access Interface' : 'Establish Profile';
}

async function executeAuthSubmit(event) {
    event.preventDefault();
    
    const email = document.getElementById('formInputEmail').value.trim();
    const password = document.getElementById('formInputPassword').value;
    const name = document.getElementById('formInputName').value.trim();

    const currentRoute = activeUiMode === 'login' ? '/auth/login' : '/auth/register';
    const postPayload = activeUiMode === 'login' ? { email, password } : { name, email, password };

    try {
        const networkResponse = await fetch(`${BACKEND_CORE_API}${currentRoute}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postPayload)
        });
        
        const dataJson = await networkResponse.json();

        if (!networkResponse.ok) {
            throw new Error(dataJson.message || `HTTP Execution Dropped: ${networkResponse.status}`);
        }

        if (activeUiMode === 'login') {
            localStorage.setItem('userId', dataJson.userId);
            localStorage.setItem('userName', dataJson.name);
            loggedInUserId = dataJson.userId;
            loggedInUserName = dataJson.name;
            routeToDashboard();
        } else {
            alert("🎉 Profile established cleanly! Please switch over to the Sign In tab.");
            switchAuthDisplay('login');
        }
    } catch (pipelineException) {
        console.error("Auth Exception Details:", pipelineException);
        alert(`❌ Access Aborted: ${pipelineException.message}`);
    }
}

function routeToDashboard() {
    document.getElementById('authPanelBlock').classList.add('hidden');
    document.getElementById('dashboardPanelBlock').classList.remove('hidden');
    document.getElementById('sessionHeader').classList.remove('hidden');
    document.getElementById('welcomeUserName').innerText = `Operator: ${loggedInUserName}`;
    loadLiveGalleryGrid();
}

function triggerSessionDrop() {
    localStorage.clear();
    location.reload();
}

async function executeMediaUploadPipeline() {
    const fileNode = document.getElementById('mediaObjectPicker');
    const statusReporter = document.getElementById('pipelineStatusReporter');

        if (fileNode.files.length === 0) return alert("Select an image payload structure first.");

        const workingFileObject = fileNode.files[0];
        const description = document.getElementById("photoDescription").value;

        statusReporter.innerText = "🔄 Initializing single-use S3 transmission handshake token...";
    try {
        const tokenFetchResponse = await fetch(`${BACKEND_CORE_API}/photos/presign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: workingFileObject.name, filetype: workingFileObject.type, userId: loggedInUserId })
        });
        const tokenPayload = await tokenFetchResponse.json();
        if (!tokenFetchResponse.ok) throw new Error(tokenPayload.message);

        statusReporter.innerText = "🚀 Streaming binary data blocks directly to Amazon S3 Bucket...";

        const s3DirectResponse = await fetch(tokenPayload.uploadURL, {
            method: 'PUT',
            headers: { 'Content-Type': workingFileObject.type },
            body: workingFileObject
        });

        if (!s3DirectResponse.ok) throw new Error("AWS Infrastructure rejected direct storage payload stream.");

        statusReporter.innerText = "💾 Mapping S3 resource location tracking pointers onto MongoDB...";

        const loggingPayloadResponse = await fetch(`${BACKEND_CORE_API}/photos/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                    userId: loggedInUserId,
                    photoName: workingFileObject.name,
                    description: description,
                    s3Key: tokenPayload.key,
                    fileSize: workingFileObject.size
                })
        });

        if (loggingPayloadResponse.ok) {
            statusReporter.innerText = "✅ Object pipeline structural transaction finalized successfully.";
            fileNode.value = "";
            loadLiveGalleryGrid();
            setTimeout(() => statusReporter.innerText = "", 4000);
        }
    } catch (pipelineFailureErr) {
        statusReporter.innerText = `❌ Pipeline Fault: ${pipelineFailureErr.message}`;
    }
}

async function loadLiveGalleryGrid() {
    const gridDisplayNode = document.getElementById('photoGalleryDisplayGrid');
    gridDisplayNode.innerHTML = "";

    try {
        const responseArrayFetch = await fetch(`${BACKEND_CORE_API}/photos/${loggedInUserId}`);
        const parsedArrayItems = await responseArrayFetch.json();

        if (parsedArrayItems.length === 0) {
            gridDisplayNode.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--font-dimmed); padding: 4rem 1rem;">S3 storage partition contains zero reference items.</div>`;
            return;
        }

        parsedArrayItems.forEach(photoDocument => {
            const wrapperCardNode = document.createElement('div');
            wrapperCardNode.className = "gallery-item";
            wrapperCardNode.innerHTML = `
                <img src="${photoDocument.s3_Url}" alt="AWS S3 Asset" loading="lazy">
                <div class="gallery-info">
                            <h4>${photoDocument.photoName}</h4>
                            <p>${photoDocument.description || "No description"}</p>
                            <span>Capacity: ${(photoDocument.fileSize / 1024).toFixed(1)} KB</span>

                    <button class="download-btn" data-id="${photoDocument._id}">
                        Download
                    </button>

                    <button class="delete-btn" data-id="${photoDocument._id}">
                        Purge Cloud File
                    </button>
                </div>
            `;
            gridDisplayNode.appendChild(wrapperCardNode);
        });

        // Attach event listeners dynamically to newly created deletion buttons
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                executeAssetRemoval(id);
            });
        });
        document.querySelectorAll('.download-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.getAttribute('data-id');
                    downloadPhoto(id);
                });
            });

    } catch (syncGridErr) {
        console.error("Gallery data array parsing exception:", syncGridErr);
    }
}

async function downloadPhoto(photoId) {
    try {
        const response = await fetch(
            `${BACKEND_CORE_API}/photos/download/${photoId}`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message);
        }

        // Opens the secure download link
       const link = document.createElement("a");
            link.href = data.downloadURL;
            link.download = "";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

    } catch (err) {
        alert("Download failed.");
        console.error(err);
    }
}

async function executeAssetRemoval(photoId) {
    if (!confirm("Confirm complete structural drop removal of cloud item asset?")) return;
    try {
        const dropNetworkRequest = await fetch(`${BACKEND_CORE_API}/photos/${photoId}`, { method: 'DELETE' });
        if (dropNetworkRequest.ok) loadLiveGalleryGrid();
    } catch (err) {
        alert("Wipe payload request dropped down.");
    }
}