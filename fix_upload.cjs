const fs = require('fs');
let code = fs.readFileSync('new_drive_api.js', 'utf8');

code = code.replace(/const form = new FormData\(\);[\s\S]*?const data = await res\.json\(\);/m, `
        const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
            method: 'POST',
            headers: { 
                Authorization: \`Bearer \${token}\`,
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
`);

fs.writeFileSync('new_drive_api.js', code);
