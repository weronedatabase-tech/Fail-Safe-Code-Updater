const fs = require('fs');
let code = fs.readFileSync('index.html', 'utf8');

// Insert a button next to the folder browser
code = code.replace(
    /<span>Google Drive Backup Folder<\/span>/,
    `<span>Google Drive Backup Folder</span>\n<button type="button" id="btn-auth-drive" class="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded shadow transition cursor-pointer z-10">Connect Drive</button>`
);

fs.writeFileSync('index.html', code);

let apiCode = fs.readFileSync('new_drive_api.js', 'utf8');
apiCode = apiCode.replace(/export async function processDriveAction/, `
export async function forceAuthDrive() {
    return await requireGoogleDriveToken();
}
export async function processDriveAction`);
fs.writeFileSync('new_drive_api.js', apiCode);

let updaterCode = fs.readFileSync('updater.js', 'utf8');
updaterCode = updaterCode.replace(/import { processDriveAction } from '.\/new_drive_api.js';/, `import { processDriveAction, forceAuthDrive } from './new_drive_api.js';`);

updaterCode += `\n
document.addEventListener("DOMContentLoaded", () => {
    const authBtn = document.getElementById('btn-auth-drive');
    if (authBtn) {
        authBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            authBtn.textContent = "Connecting...";
            try {
                await forceAuthDrive();
                authBtn.textContent = "Connected \u2713";
                authBtn.classList.remove('bg-blue-600', 'hover:bg-blue-500');
                authBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
                // Re-trigger folder fetch
                const folderInput = document.getElementById('gh-drive-folder');
                if (folderInput.value.trim()) {
                    folderInput.dispatchEvent(new Event('change'));
                }
            } catch(e) {
                authBtn.textContent = "Failed. Try Again";
                console.error(e);
            }
        });
    }
});
`;

fs.writeFileSync('updater.js', updaterCode);
