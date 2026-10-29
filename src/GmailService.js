/**
 * Search and labelling go through the Gmail advanced service so they work per message,
 * not per thread: a new reply in an already-processed thread still gets picked up.
 */
const GmailService = {
  LABEL_ROOT: 'DriveDrop',
  LABEL_PROCESSED: 'DriveDrop/Processed',
  LABEL_FAILED: 'DriveDrop/Failed',
  MAX_MESSAGES_PER_RUN: 300,

  /** Returns null when there is nothing to watch (no enabled rules and no default folder). */
  buildQuery(config) {
    const senders = config.rules
      .filter(r => r.enabled)
      .map(r => (r.sender.indexOf('*@') === 0 ? r.sender.slice(2) : r.sender));
    if (!senders.length && !config.defaultFolderId) return null;

    const parts = [
      'has:attachment',
      '-label:drivedrop-processed',
      '-label:drivedrop-failed',
      'newer_than:' + config.lookbackDays + 'd',
    ];
    if (!config.defaultFolderId) parts.push('from:(' + senders.join(' OR ') + ')');
    return parts.join(' ');
  },

  /** Oldest first, so a backlog drains in arrival order. */
  listMessageIds(query) {
    const ids = [];
    let pageToken;
    do {
      const page = Gmail.Users.Messages.list('me', { q: query, maxResults: 100, pageToken: pageToken });
      (page.messages || []).forEach(m => ids.push(m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < this.MAX_MESSAGES_PER_RUN);
    return ids.slice(0, this.MAX_MESSAGES_PER_RUN).reverse();
  },

  getLabelIds(messageId) {
    return Gmail.Users.Messages.get('me', messageId, { format: 'minimal' }).labelIds || [];
  },

  /** Creates the DriveDrop labels if missing and returns { processed, failed } label IDs. */
  ensureLabels() {
    const existing = Gmail.Users.Labels.list('me').labels || [];
    const find = name => existing.find(l => l.name === name);
    const create = name => find(name) || Gmail.Users.Labels.create(
      { name: name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }, 'me');

    create(this.LABEL_ROOT);
    return {
      processed: create(this.LABEL_PROCESSED).id,
      failed: create(this.LABEL_FAILED).id,
    };
  },

  markProcessed(messageId, labels, archive) {
    Gmail.Users.Messages.modify({
      addLabelIds: [labels.processed],
      removeLabelIds: archive ? ['INBOX', 'UNREAD'] : [],
    }, 'me', messageId);
  },

  markFailed(messageId, labels) {
    Gmail.Users.Messages.modify({ addLabelIds: [labels.failed] }, 'me', messageId);
  },

  /** Removes the Failed label so the next run picks those messages up again. */
  clearFailed(labels) {
    const ids = [];
    let pageToken;
    do {
      const page = Gmail.Users.Messages.list('me', { labelIds: [labels.failed], maxResults: 500, pageToken: pageToken });
      (page.messages || []).forEach(m => ids.push(m.id));
      pageToken = page.nextPageToken;
    } while (pageToken);

    for (let i = 0; i < ids.length; i += 1000) {
      Gmail.Users.Messages.batchModify({ ids: ids.slice(i, i + 1000), removeLabelIds: [labels.failed] }, 'me');
    }
    ids.forEach(id => MessageState.clear(id));
    return ids.length;
  },

  /** "Jane <jane@x.com>" -> "jane@x.com" */
  parseAddress(from) {
    const match = String(from || '').match(/<([^>]+)>/);
    return (match ? match[1] : String(from || '')).trim().toLowerCase();
  },
};
