const BACKEND_CORE_API = 'https://cloud-photo-gallery.onrender.com/api';

let activeUiMode = 'login';
let loggedInUserId = localStorage.getItem('userId') || null;
let loggedInUserName = localStorage.getItem('userName') || null;

document.addEventListener("DOMContentLoaded", () => {
    if (loggedInUserId) routeToDashboard();

    document.getElementById('loginTabBtn')?.addEventListener('click', () => switchAuthDisplay('login'));
    document.getElementById('registerTabBtn')?.addEventListener('click', () => switchAuthDisplay('register'));
    document.getElementById('authPipelineForm')?.addEventListener('submit', executeAuthSubmit);
    document.getElementById('logoutBtn')?.addEventListener('click', triggerSessionDrop);
    document.getElementById('uploadBtn')?.addEventListener('click', executeMediaUploadPipeline);
});

function switchAuthDisplay(targetMode) {
    activeUiMode = targetMode;

    document.getElementById('loginTabBtn')?.classList.toggle('active', targetMode === 'login');
    document.getElementById('registerTabBtn')?.classList.toggle('active', targetMode === 'register');

    const nameField = document.getElementById('nameInputWrapper');
    if (nameField) {
        nameField.classList.toggle('hidden', targetMode === 'login');
    }

    const btn = document.getElementById('submitActionBtn');
    if (btn) {
        btn.innerText = targetMode === 'login' ? 'Access Interface' : 'Establish Profile';
    }
}

async function executeAuthSubmit(event) {
    event.preventDefault();

    const email = document.getElementById('formInputEmail')?.value.trim();
    const password = document.getElementById('formInputPassword')?.value;
    const name = document.getElementById('formInputName')?.value.trim();

    const route = activeUiMode === 'login' ? '/auth/login' : '/auth/register';

    const payload =
        activeUiMode === 'login'
            ? { email, password }
            : { name, email, password };

    try {
        const res = await fetch(`${BACKEND_CORE_API}${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.message || `Server Error: ${res.status}`);
        }

        if (activeUiMode === 'login') {
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('userName', data.name);

            loggedInUserId = data.userId;
            loggedInUserName = data.name;

            routeToDashboard();
        } else {
            alert("🎉 Registration successful! Please login.");
            switchAuthDisplay('login');
        }

    } catch (err) {
        console.error("AUTH ERROR:", err);
        alert(`❌ Auth failed: ${err.message}`);
    }
}

function routeToDashboard() {
    document.getElementById('authPanelBlock')?.classList.add('hidden');
    document.getElementById('dashboardPanelBlock')?.classList.remove('hidden');
    document.getElementById('sessionHeader')?.classList.remove('hidden');

    const welcome = document.getElementById('welcomeUserName');
    if (welcome) welcome.innerText = `Operator: ${loggedInUserName}`;

    loadLiveGalleryGrid();
}

function triggerSessionDrop() {
    localStorage.clear();
    location.reload();
}

async function executeMediaUploadPipeline() {
    const fileNode = document.getElementById('mediaObjectPicker');
    const statusReporter = document.getElementById('pipelineStatusReporter');

    if (!fileNode || fileNode.files.length === 0) {
        alert("Please select an image first.");
        return;
    }

    const file = fileNode.files[0];
    const description = document.getElementById("photoDescription")?.value || "";

    try {
        statusReporter.innerText = "🔄 Requesting upload token...";

        // STEP 1: Get presigned URL
        const presignRes = await fetch(`${BACKEND_CORE_API}/photos/presign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: file.name,
                filetype: file.type,
                userId: loggedInUserId
            })
        });

        const presignData = await presignRes.json().catch(() => ({}));

        if (!presignRes.ok) {
            throw new Error(presignData.message || "Failed to get presigned URL");
        }

        if (!presignData.uploadURL) {
            throw new Error("Invalid presigned response");
        }

        statusReporter.innerText = "🚀 Uploading to S3...";

        // STEP 2: Upload to S3
        const uploadRes = await fetch(presignData.uploadURL, {
            method: 'PUT',
            headers: {
                'Content-Type': file.type
            },
            body: file
        });

        if (!uploadRes.ok) {
            throw new Error("S3 upload failed");
        }

        statusReporter.innerText = "💾 Saving metadata...";

        // STEP 3: Save metadata
        const saveRes = await fetch(`${BACKEND_CORE_API}/photos/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: loggedInUserId,
                photoName: file.name,
                description,
                s3Key: presignData.key,
                fileSize: file.size
            })
        });

        if (!saveRes.ok) {
            const err = await saveRes.json().catch(() => ({}));
            throw new Error(err.message || "Failed to save metadata");
        }

        statusReporter.innerText = "✅ Upload successful!";

        fileNode.value = "";
        loadLiveGalleryGrid();

        setTimeout(() => statusReporter.innerText = "", 3000);

    } catch (err) {
        console.error("PIPELINE ERROR:", err);
        statusReporter.innerText = `❌ Error: ${err.message}`;
    }
}

async function loadLiveGalleryGrid() {
    const grid = document.getElementById('photoGalleryDisplayGrid');
    if (!grid) return;

    grid.innerHTML = "";

    try {
        const res = await fetch(`${BACKEND_CORE_API}/photos/${loggedInUserId}`);
        const photos = await res.json().catch(() => []);

        if (!res.ok) throw new Error("Failed to load gallery");

        if (photos.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#888;padding:3rem;">
                No images found in cloud storage.
            </div>`;
            return;
        }

        photos.forEach(photo => {
            const div = document.createElement("div");
            div.className = "gallery-item";

            div.innerHTML = `
                <img src="${photo.s3_Url}" loading="lazy">
                <div class="gallery-info">
                    <h4>${photo.photoName}</h4>
                    <p>${photo.description || "No description"}</p>
                    <span>${(photo.fileSize / 1024).toFixed(1)} KB</span>

                    <button class="download-btn" data-id="${photo._id}">Download</button>
                    <button class="delete-btn" data-id="${photo._id}">Delete</button>
                </div>
            `;

            grid.appendChild(div);
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', e => executeAssetRemoval(e.target.dataset.id));
        });

        document.querySelectorAll('.download-btn').forEach(btn => {
            btn.addEventListener('click', e => downloadPhoto(e.target.dataset.id));
        });

    } catch (err) {
        console.error("Gallery error:", err);
    }
}

async function downloadPhoto(photoId) {
    try {
        const res = await fetch(`${BACKEND_CORE_API}/photos/download/${photoId}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.message);

        const a = document.createElement("a");
        a.href = data.downloadURL;
        a.click();

    } catch (err) {
        console.error(err);
        alert("Download failed");
    }
}

async function executeAssetRemoval(photoId) {
    if (!confirm("Delete this file permanently?")) return;

    try {
        const res = await fetch(`${BACKEND_CORE_API}/photos/${photoId}`, {
            method: 'DELETE'
        });

        if (res.ok) loadLiveGalleryGrid();

    } catch (err) {
        alert("Delete failed");
    }
}