const fs = require('fs');
let code = fs.readFileSync('updater.js', 'utf8');

const importStatement = `import { processDriveAction } from './new_drive_api.js';\n`;
if (!code.startsWith('import')) {
    code = importStatement + code;
}

code = code.replace(/async function gasCall\(gasUrl, payload\) \{[\s\S]*?\n\}/m, `async function gasCall(gasUrl, payload) {
    console.log("Intercepting gasCall", payload);
    return await processDriveAction(payload);
}`);

fs.writeFileSync('updater.js', code);
