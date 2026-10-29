/**
 * Logging front end. Code logs generic events; the sinks in LogSinks.js decide where they go.
 *
 * Event shape handed to every sink:
 *   { timestamp: ISO string, level: 'info'|'warn'|'error', app: 'drive-drop', event: 'file_saved', ...fields }
 *
 * Active sinks come from the LOG_SINKS Script Property, comma separated (e.g. "axiom" or "axiom,datadog").
 * Defaults to "axiom". Every event is also written to the Apps Script execution log.
 * A sink failure never fails the caller and never stops the other sinks.
 *
 * Named AppLog because Apps Script already has a built-in global called Logger.
 */
const AppLog = {
  APP: 'drive-drop',
  DEFAULT_SINKS: 'axiom',

  /** Batched logger: collect events during a run, send them all with flush(). */
  create() {
    const events = [];
    const write = level => (event, fields) => events.push(AppLog.entry_(level, event, fields));
    return {
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      flush() {
        AppLog.send_(events.splice(0, events.length));
      },
    };
  },

  /** One-off events outside a run (logins, config changes). Sent immediately. */
  info(event, fields) { this.send_([this.entry_('info', event, fields)]); },
  warn(event, fields) { this.send_([this.entry_('warn', event, fields)]); },
  error(event, fields) { this.send_([this.entry_('error', event, fields)]); },

  /** Active sinks and whether each has its secrets set, for the dashboard. */
  status() {
    return this.activeKeys_().map(key => {
      const sink = LOG_SINKS[key];
      return sink
        ? { key: key, name: sink.name, configured: sink.isConfigured() }
        : { key: key, name: key, configured: false, unknown: true };
    });
  },

  entry_(level, event, fields) {
    const entry = Object.assign(
      { timestamp: new Date().toISOString(), level: level, app: this.APP, event: event },
      fields || {});
    const line = event + ' ' + JSON.stringify(fields || {});
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return entry;
  },

  activeKeys_() {
    return (Config.secret('LOG_SINKS') || this.DEFAULT_SINKS)
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  },

  send_(events) {
    if (!events.length) return;
    this.activeKeys_().forEach(key => {
      const sink = LOG_SINKS[key];
      if (!sink) {
        console.warn('Unknown log sink "' + key + '" in LOG_SINKS');
        return;
      }
      if (!sink.isConfigured()) {
        console.warn(sink.name + ' not configured; skipped ' + events.length + ' event(s)');
        return;
      }
      try {
        Retry.run(() => sink.send(events));
      } catch (e) {
        console.error(sink.name + ' send failed, ' + events.length + ' event(s) lost: ' + e.message);
      }
    });
  },
};
