import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

let auth;
let provider;
let cachedAccessToken = null;

async function initFirebase() {
    if (auth) return;
    try {
        const res = await fetch('firebase-applet-config.json');
        const config = await res.json();
        const app = initializeApp(config);
        auth = getAuth(app);
        provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/drive');
    } catch (e) {
        console.error("Failed to load firebase config", e);
    }
}

async function requireGoogleDriveToken() {
    await initFirebase();
    if (cachedAccessToken) return cachedAccessToken;
    try {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential?.accessToken) throw new Error('No access token');
        cachedAccessToken = credential.accessToken;
        return cachedAccessToken;
    } catch(err) {
        console.error(err);
        throw new Error("Failed to authenticate with Google Drive.");
    }
}


export async function forceAuthDrive() {
    return await requireGoogleDriveToken();
}
export async function processDriveAction(payload) {
    const token = await requireGoogleDriveToken();
    const action = payload.action;

    if (action === 'getFolderInfo') {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${payload.folderId}?fields=id,name`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Folder not found or inaccessible");
        const data = await res.json();
        return { id: data.id, name: data.name, path: data.name };
    }

    if (action === 'getFolders') {
        const parentId = payload.parentId === 'root' ? 'root' : payload.parentId;
        const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=name`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to load folders");
        const data = await res.json();
        
        let parentData = null;
        let currentName = 'My Drive';
        if (parentId !== 'root') {
            const curRes = await fetch(`https://www.googleapis.com/drive/v3/files/${parentId}?fields=id,name,parents`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const curData = await curRes.json();
            currentName = curData.name;
            if (curData.parents && curData.parents.length > 0) {
                parentData = { id: curData.parents[0] };
            } else {
                parentData = { id: 'root' };
            }
        }
        return {
            folders: data.files || [],
            current: { id: parentId, name: currentName },
            parent: parentData
        };
    }

    if (action === 'backupCode') {
        const docName = `${payload.repoName} Code Backup - ${new Date().toISOString()}`;
        let content = `--- START OF FILE ${docName} ---\n`;
        content += "#####*****\nFull File Hierarchy\n#####*****\n";
        content += (payload.hierarchy || "No hierarchy provided.") + "\n\n";

        payload.files.forEach(file => {
            content += `@@@===FILE_PATH: ${file.path} ===@@@\n`;
            content += "@@@===CODE_START===@@@\n";
            content += file.content + "\n";
            content += "@@@===CODE_END===@@@\n\n";
        });

        const metadata = {
            name: docName,
            mimeType: 'application/vnd.google-apps.document',
            parents: [payload.folderId]
        };

        
        const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
            method: 'POST',
            headers: { 
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(metadata)
        });
        if (!initRes.ok) throw new Error("Failed to init upload");
        const uploadUrl = initRes.headers.get('Location');
        
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: content
        });
        if (!uploadRes.ok) throw new Error("Failed to upload content");
        const data = await uploadRes.json();

        return {
            url: `https://docs.google.com/document/d/${data.id}/edit`,
            id: data.id
        };
    }

    if (action === 'getBackups') {
        const q = `'${payload.folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=createdTime desc`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to list backups");
        const data = await res.json();
        const backups = (data.files || []).map(f => ({
            id: f.id,
            name: f.name,
            time: new Date(f.createdTime).getTime()
        }));
        return { backups };
    }

    if (action === 'getBackupContent') {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${payload.fileId}/export?mimeType=text/plain`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to fetch backup content");
        const content = await res.text();
        return { content };
    }

    throw new Error("Unknown action");
}
