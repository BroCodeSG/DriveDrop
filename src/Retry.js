/**
 * In-run retry with exponential backoff. Throw a NonRetryableError to stop early.
 */
class NonRetryableError extends Error {}

const Retry = {
  run(fn, options) {
    const tries = (options && options.tries) || 3;
    const baseMs = (options && options.baseMs) || 1000;
    let lastError;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return fn(attempt);
      } catch (e) {
        lastError = e;
        if (e instanceof NonRetryableError || attempt === tries) break;
        Utilities.sleep(baseMs * Math.pow(2, attempt - 1));
      }
    }
    throw lastError;
  },
};

/**
 * Cross-run state per Gmail message: attempt count and which attachments were already saved,
 * so a retry never duplicates files that made it to Drive on an earlier run.
 */
const MessageState = {
  PREFIX: 'STATE_',

  get(messageId) {
    const raw = PropertiesService.getScriptProperties().getProperty(this.PREFIX + messageId);
    return raw ? JSON.parse(raw) : { attempts: 0, saved: [], firstSeen: Date.now() };
  },

  save(messageId, state) {
    PropertiesService.getScriptProperties().setProperty(this.PREFIX + messageId, JSON.stringify(state));
  },

  clear(messageId) {
    PropertiesService.getScriptProperties().deleteProperty(this.PREFIX + messageId);
  },

  /** Drops state for messages that have aged out of the search window (deleted, moved, etc.). */
  prune(maxAgeDays) {
    const props = PropertiesService.getScriptProperties();
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const all = props.getProperties();
    Object.keys(all)
      .filter(key => key.indexOf(this.PREFIX) === 0)
      .forEach(key => {
        try {
          if (JSON.parse(all[key]).firstSeen < cutoff) props.deleteProperty(key);
        } catch (e) {
          props.deleteProperty(key);
        }
      });
  },
};
