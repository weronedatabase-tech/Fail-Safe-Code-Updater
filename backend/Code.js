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

  const doc = DocumentApp.create(docName);
  const fileId = doc.getId();
  const body = doc.getBody();

  body.insertParagraph(0, `--- START OF FILE ${docName} ---`);
  body.appendParagraph("#####*****\nFull File Hierarchy\n#####*****");
  body.appendParagraph(hierarchy || "No hierarchy provided.");
  body.appendParagraph("\n");

  files.forEach(file => {
    body.appendParagraph(`@@@===FILE_PATH: ${file.path} ===@@@`);
    body.appendParagraph("@@@===CODE_START===@@@");
    body.appendParagraph(file.content);
    body.appendParagraph("@@@===CODE_END===@@@\n\n");
  });

  doc.saveAndClose();

  // Move the newly created document to the designated Drive folder
  const driveFile = DriveApp.getFileById(fileId);
  driveFile.moveTo(folder);

  // Ensure the backup file has permissions set to anyone with the link can view
  driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

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
