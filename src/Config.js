/**
 * Rules and settings, stored as one JSON value in Script Properties.
 * Secrets (PIN, log sink keys) are separate properties and never leave the server.
 */
const Config = {
  KEY: 'CONFIG_JSON',
  LAST_RUN_KEY: 'LAST_RUN',

  DEFAULTS: {
    rules: [],
    defaultFolderId: null,
    defaultFolderName: null,
    maxAttempts: 5,
    lookbackDays: 7,
  },

  get() {
    const raw = PropertiesService.getScriptProperties().getProperty(this.KEY);
    const stored = raw ? JSON.parse(raw) : {};
    return Object.assign({}, this.DEFAULTS, stored);
  },

  save(config) {
    PropertiesService.getScriptProperties().setProperty(this.KEY, JSON.stringify(config));
  },

  secret(name) {
    return PropertiesService.getScriptProperties().getProperty(name);
  },

  /** Exact address match wins over a *@domain wildcard. */
  matchRule(config, address) {
    if (!address) return null;
    const enabled = config.rules.filter(r => r.enabled);
    const exact = enabled.find(r => r.sender === address);
    if (exact) return exact;
    const domain = address.split('@')[1];
    return enabled.find(r => r.sender === '*@' + domain) || null;
  },

  upsertRule(input) {
    const sender = String(input.sender || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender) && !/^\*@[^@\s]+\.[^@\s]+$/.test(sender)) {
      throw new Error('Sender must be an email address or *@domain.com');
    }
    if (!Processors.exists(input.processor || 'none')) {
      throw new Error('Unknown processor: ' + input.processor);
    }
    const folder = DriveService.resolveFolder(input.folder);

    const config = this.get();
    const duplicate = config.rules.find(r => r.sender === sender && r.id !== input.id);
    if (duplicate) throw new Error('A rule for ' + sender + ' already exists');

    const rule = {
      id: input.id || Utilities.getUuid(),
      sender: sender,
      folderId: folder.id,
      folderName: folder.name,
      enabled: input.enabled !== false,
      processor: input.processor || 'none',
    };
    const index = config.rules.findIndex(r => r.id === rule.id);
    if (index >= 0) config.rules[index] = rule;
    else config.rules.push(rule);
    this.save(config);
    return rule;
  },

  deleteRule(id) {
    const config = this.get();
    config.rules = config.rules.filter(r => r.id !== id);
    this.save(config);
  },

  saveSettings(input) {
    const maxAttempts = Number(input.maxAttempts);
    const lookbackDays = Number(input.lookbackDays);
    if (!(maxAttempts >= 1 && maxAttempts <= 20)) throw new Error('Max attempts must be 1-20');
    if (!(lookbackDays >= 1 && lookbackDays <= 60)) throw new Error('Lookback days must be 1-60');

    const config = this.get();
    if (input.defaultFolder) {
      const folder = DriveService.resolveFolder(input.defaultFolder);
      config.defaultFolderId = folder.id;
      config.defaultFolderName = folder.name;
    } else {
      config.defaultFolderId = null;
      config.defaultFolderName = null;
    }
    config.maxAttempts = maxAttempts;
    config.lookbackDays = lookbackDays;
    this.save(config);
    return config;
  },

  getLastRun() {
    const raw = PropertiesService.getScriptProperties().getProperty(this.LAST_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  setLastRun(summary) {
    PropertiesService.getScriptProperties().setProperty(this.LAST_RUN_KEY, JSON.stringify(summary));
  },
};
