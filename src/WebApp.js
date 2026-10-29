/*
 * Every top-level function in an Apps Script project is callable from the browser via
 * google.script.run, so the only public ones are doGet, login and api (plus the trigger and
 * editor-only setup functions). Everything else lives on objects, which the browser can't reach.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('DriveDrop')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function login(username, pin) {
  return WebApp.respond_(() => ({ token: Auth.login(username, pin) }));
}

function api(token, action, payload) {
  if (!Auth.check(token)) return { ok: false, code: 'AUTH', error: 'Session expired. Please log in again.' };
  const handler = WebApp.ACTIONS[action];
  if (!handler) return { ok: false, error: 'Unknown action: ' + action };
  return WebApp.respond_(() => handler(payload || {}, token));
}

const WebApp = {
  ACTIONS: {
    getState: () => WebApp.state_(),

    saveRule: payload => {
      const rule = Config.upsertRule(payload);
      AppLog.info('config_changed', { change: 'rule_saved', rule: rule });
      return WebApp.state_();
    },

    deleteRule: payload => {
      Config.deleteRule(payload.id);
      AppLog.info('config_changed', { change: 'rule_deleted', ruleId: payload.id });
      return WebApp.state_();
    },

    saveSettings: payload => {
      const config = Config.saveSettings(payload);
      AppLog.info('config_changed', {
        change: 'settings_saved',
        defaultFolderId: config.defaultFolderId,
        maxAttempts: config.maxAttempts,
        lookbackDays: config.lookbackDays,
      });
      return WebApp.state_();
    },

    resolveFolder: payload => DriveService.resolveFolder(payload.folder),

    createFolder: payload => DriveService.createFolder(payload.name),

    runNow: () => ({ summary: Poller.run('dashboard'), state: WebApp.state_() }),

    retryFailed: () => {
      const count = GmailService.clearFailed(GmailService.ensureLabels());
      AppLog.info('retry_failed_requested', { messages: count });
      return { count: count, state: WebApp.state_() };
    },

    installTrigger: () => {
      Setup.install();
      return WebApp.state_();
    },

    logout: (payload, token) => {
      Auth.logout(token);
      return true;
    },
  },

  state_() {
    return {
      config: Config.get(),
      processors: Processors.list(),
      status: {
        account: Session.getEffectiveUser().getEmail(),
        triggerInstalled: Setup.isInstalled(),
        logSinks: AppLog.status(),
        lastRun: Config.getLastRun(),
      },
    };
  },

  respond_(fn) {
    try {
      return { ok: true, data: fn() };
    } catch (e) {
      console.error(e && e.stack || e);
      return { ok: false, error: String(e && e.message || e) };
    }
  },
};
