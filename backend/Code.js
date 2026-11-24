function doPost(e) {
  try {
    // Enable CORS by handling preflight in doOptions if necessary
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No payload provided.");
    }

    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    let result = {};

    if (action === 'backupCode') {
      result = handleBackup(params);
    } else if (action === 'backupStart') {
      result = handleBackupStart(params);
    } else if (action === 'backupAppend') {
      result = handleBackupAppend(params);
    } else if (action === 'backupFinish') {
      result = handleBackupFinish(params);
    } else if (action === 'renameBackup') {
      result = handleRenameBackup(params);
    } else if (action === 'getBackups') {
      result = handleGetBackups(params);
    } else if (action === 'getBackupContent') {
      result = handleGetBackupContent(params);
    } else if (action === 'getFolders') {
      result = handleGetFolders(params);
    } else if (action === 'getFolderInfo') {
      result = handleGetFolderInfo(params);
    } else {
      throw new Error("Invalid action specified.");
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message || error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  // Handle CORS preflight requests
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

var MAX_DOC_CHARS = 950000; // Safe ceiling below Google Docs ~1.02M character limit
var MAX_PARAGRAPH_CHARS = 45000; // Fast batched paragraph size for DocumentApp

function sanitizeDocText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\r\n|\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function formatFilesBlock(files) {
  const parts = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const safePath = sanitizeDocText(file && file.path ? file.path : "unknown");
    const safeContent = sanitizeDocText(file && file.content !== undefined ? file.content : "");
    parts.push(
      `@@@===FILE_PATH: ${safePath} ===@@@\n` +
      `@@@===CODE_START===@@@\n` +
      `${safeContent}\n` +
      `@@@===CODE_END===@@@\n`
    );
  }
  return parts.join("\n");
}

function appendTextInBatches(body, text) {
  if (!text) return;
  let offset = 0;
  const totalLen = text.length;
  while (offset < totalLen) {
    let end = Math.min(offset + MAX_PARAGRAPH_CHARS, totalLen);
    if (end < totalLen) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > offset + 1000) {
        end = lastNewline;
      }
    }
    const segment = text.slice(offset, end);
    body.appendParagraph(segment);
    offset = end;
    if (offset < totalLen && text.charAt(offset) === '\n') {
      offset++;
    }
  }
}

function trySetPublicViewSharing(driveFile) {
  try {
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // Non-fatal: Workspace domains may restrict ANYONE_WITH_LINK sharing
  }
}

function handleBackupStart(params) {
  const folderId = params.folderId;
  const hierarchy = params.hierarchy;
  const repoName = params.repoName || "App";
  const customBackupName = params.backupName ? String(params.backupName).trim() : "";

  if (!folderId) {
    throw new Error("Missing required parameter: folderId.");
  }

  const folder = DriveApp.getFolderById(folderId);
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const docName = customBackupName || `${repoName} Code Backup - ${dateStr}`;

  const doc = DocumentApp.create(docName);
  const fileId = doc.getId();

  // Move into target folder immediately so interrupted uploads never pollute Drive root
  const driveFile = DriveApp.getFileById(fileId);
  driveFile.moveTo(folder);

  const body = doc.getBody();
  body.insertParagraph(0, `--- START OF FILE ${docName} ---`);
  const headerBlock =
    "#####*****\nFull File Hierarchy\n#####*****\n" +
    sanitizeDocText(hierarchy || "No hierarchy provided.") + "\n";
  appendTextInBatches(body, headerBlock);

  doc.saveAndClose();
  trySetPublicViewSharing(driveFile);

  return {
    url: driveFile.getUrl(),
    id: fileId,
    name: docName
  };
}

function handleBackupAppend(params) {
  const fileId = params.fileId;
  const files = params.files;
  const chunkKey = params.chunkKey ? String(params.chunkKey) : "";

  if (!fileId || !Array.isArray(files)) {
    throw new Error("Missing required parameters: fileId or files.");
  }

  // Idempotency guard so network retries never duplicate content
  const cacheKey = chunkKey ? `acm_bk_${fileId}_${chunkKey}` : null;
  if (cacheKey) {
    try {
      const cache = CacheService.getScriptCache();
      if (cache.get(cacheKey)) {
        return { id: fileId, appended: 0, deduplicated: true };
      }
    } catch (e) {}
  }

  const chunkText = formatFilesBlock(files);
  const doc = DocumentApp.openById(fileId);
  const body = doc.getBody();
  const currentLength = body.getText().length;

  if (currentLength + chunkText.length > MAX_DOC_CHARS) {
    doc.saveAndClose();
    return {
      id: fileId,
      limitReached: true,
      currentLength: currentLength,
      chunkLength: chunkText.length
    };
  }

  appendTextInBatches(body, chunkText);
  doc.saveAndClose();

  if (cacheKey) {
    try {
      CacheService.getScriptCache().put(cacheKey, '1', 600);
    } catch (e) {}
  }

  return {
    id: fileId,
    appended: files.length,
    totalLength: currentLength + chunkText.length
  };
}

function handleBackupFinish(params) {
  const fileId = params.fileId;
  if (!fileId) {
    throw new Error("Missing required parameter: fileId.");
  }
  const driveFile = DriveApp.getFileById(fileId);
  trySetPublicViewSharing(driveFile);
  return {
    url: driveFile.getUrl(),
    id: driveFile.getId(),
    name: driveFile.getName()
  };
}

function handleBackup(params) {
  const folderId = params.folderId;
  const hierarchy = params.hierarchy;
  const files = params.files;
  // Use the dynamically passed repo name from the frontend, fallback to a generic name if missing
  const repoName = params.repoName || "App";
  const customBackupName = params.backupName ? String(params.backupName).trim() : "";

  if (!folderId || !files) {
    throw new Error("Missing required parameters: folderId or files.");
  }

  const folder = DriveApp.getFolderById(folderId);
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // Use user-supplied backupName if provided, otherwise use the default naming convention
  const docName = customBackupName || `${repoName} Code Backup - ${dateStr}`;

  const headerBlock =
    "#####*****\nFull File Hierarchy\n#####*****\n" +
    sanitizeDocText(hierarchy || "No hierarchy provided.") + "\n";
  const filesBlock = formatFilesBlock(files);

  if (headerBlock.length + filesBlock.length > MAX_DOC_CHARS) {
    throw new Error("Backup content exceeds single Google Doc character limit. Please use chunked backup.");
  }

  const doc = DocumentApp.create(docName);
  const fileId = doc.getId();

  // Move the newly created document to the designated Drive folder immediately
  const driveFile = DriveApp.getFileById(fileId);
  driveFile.moveTo(folder);

  const body = doc.getBody();
  body.insertParagraph(0, `--- START OF FILE ${docName} ---`);
  appendTextInBatches(body, headerBlock);
  appendTextInBatches(body, filesBlock);

  doc.saveAndClose();

  // Ensure the backup file has permissions set to anyone with the link can view
  trySetPublicViewSharing(driveFile);

  return {
    url: driveFile.getUrl(),
    id: fileId,
    name: docName
  };
}

function handleRenameBackup(params) {
  const fileId = params.fileId;
  const newName = params.newName ? String(params.newName).trim() : "";

  if (!fileId || !newName) {
    throw new Error("Missing required parameters: fileId or newName.");
  }

  const file = DriveApp.getFileById(fileId);
  file.setName(newName);

  // Also update the header line inside the Google Doc if applicable
  try {
    const doc = DocumentApp.openById(fileId);
    const body = doc.getBody();
    if (body.getNumChildren() > 0) {
      const firstPara = body.getChild(0).asParagraph();
      if (firstPara.getText().indexOf("--- START OF FILE ") === 0) {
        firstPara.setText(`--- START OF FILE ${newName} ---`);
      }
    }
    doc.saveAndClose();
  } catch (e) {}

  return {
    id: file.getId(),
    name: file.getName(),
    url: file.getUrl()
  };
}

function handleGetBackups(params) {
  const folderId = params.folderId;
  if (!folderId) throw new Error("Missing folderId parameter.");

  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  const backups = [];

  while (files.hasNext()) {
    const file = files.next();
    backups.push({
      id: file.getId(),
      name: file.getName(),
      time: file.getDateCreated().getTime()
    });
  }

  // Sort backups so the newest ones appear at the top
  backups.sort((a, b) => b.time - a.time);

  return { backups: backups };
}

function handleGetBackupContent(params) {
  const fileId = params.fileId;
  if (!fileId) throw new Error("Missing fileId parameter.");

  const doc = DocumentApp.openById(fileId);
  return { content: doc.getBody().getText() };
}

function handleGetFolders(params) {
  const parentId = params.parentId || 'root';
  let folder;

  if (parentId === 'root') {
    folder = DriveApp.getRootFolder();
  } else {
    folder = DriveApp.getFolderById(parentId);
  }

  const subFolders = folder.getFolders();
  const folders = [];

  while (subFolders.hasNext()) {
    const f = subFolders.next();
    folders.push({
      id: f.getId(),
      name: f.getName()
    });
  }

  // Sort folders alphabetically
  folders.sort((a, b) => a.name.localeCompare(b.name));

  let parent = null;
  if (parentId !== 'root') {
    try {
      const parents = folder.getParents();
      if (parents.hasNext()) {
        parent = { id: parents.next().getId() };
      } else {
        parent = { id: 'root' };
      }
    } catch (e) {
      parent = { id: 'root' };
    }
  }

  return {
    folders: folders,
    current: {
      id: parentId === 'root' ? folder.getId() : parentId,
      name: parentId === 'root' ? 'My Drive' : folder.getName()
    },
    parent: parent
  };
}

function handleGetFolderInfo(params) {
  const folderId = params.folderId;
  if (!folderId) throw new Error("Missing folderId parameter.");

  try {
    const folder = DriveApp.getFolderById(folderId);
    let pathName = folder.getName();
    let current = folder;

    // Attempt to retrieve full path tree
    try {
      while (current.getParents().hasNext()) {
        current = current.getParents().next();
        pathName = current.getName() + ' / ' + pathName;
      }
    } catch (e) {}

    return { name: folder.getName(), path: pathName, id: folder.getId() };
  } catch (e) {
    throw new Error("Folder not found or inaccessible.");
  }
}
