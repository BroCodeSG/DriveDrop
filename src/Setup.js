/*
 * Run these from the Apps Script editor (Run menu). They refuse to run from the public web app.
 */
function installTrigger() {
  Setup.requireOwner_();
  Setup.install();
  console.log('Trigger installed: runPoll every 10 minutes');
}

function uninstallTrigger() {
  Setup.requireOwner_();
  Setup.uninstall();
  console.log('Trigger removed');
}

const Setup = {
  HANDLER: 'runPoll',

  install() {
    this.uninstall();
    ScriptApp.newTrigger(this.HANDLER).timeBased().everyMinutes(10).create();
    GmailService.ensureLabels();
  },

  uninstall() {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === this.HANDLER)
      .forEach(t => ScriptApp.deleteTrigger(t));
  },

  isInstalled() {
    return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === this.HANDLER);
  },

  /** Anonymous web-app callers have no active user; the editor does. */
  requireOwner_() {
    const active = Session.getActiveUser().getEmail();
    if (!active || active !== Session.getEffectiveUser().getEmail()) {
      throw new Error('Run this from the Apps Script editor as the owner.');
    }
  },
};
