const DriveService = {
  save(blob, folderId) {
    const folder = DriveApp.getFolderById(folderId);
    blob.setName(this.uniqueName_(folder, blob.getName() || 'attachment'));
    return folder.createFile(blob);
  },

  /** Accepts a folder ID or any Drive folder URL. */
  resolveFolder(input) {
    const value = String(input || '').trim();
    if (!value) throw new Error('Folder is required');
    const fromUrl = value.match(/\/folders\/([a-zA-Z0-9_-]+)/) || value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const id = fromUrl ? fromUrl[1] : value;
    let folder;
    try {
      folder = DriveApp.getFolderById(id);
      folder.getName();
    } catch (e) {
      throw new Error('Drive folder not found or not accessible: ' + id);
    }
    return { id: folder.getId(), name: folder.getName(), url: folder.getUrl() };
  },

  createFolder(name) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Folder name is required');
    const folder = DriveApp.createFolder(clean);
    return { id: folder.getId(), name: folder.getName(), url: folder.getUrl() };
  },

  uniqueName_(folder, name) {
    if (!folder.getFilesByName(name).hasNext()) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    let candidate = base + ' (' + stamp + ')' + ext;
    for (let n = 2; folder.getFilesByName(candidate).hasNext(); n++) {
      candidate = base + ' (' + stamp + '-' + n + ')' + ext;
    }
    return candidate;
  },
};
