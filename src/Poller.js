/** Time-trigger entry point (installed by installTrigger, every 10 minutes). */
function runPoll() {
  return Poller.run('trigger');
}

const Poller = {
  // Apps Script kills a run at 6 minutes; stop picking up new messages well before that.
  TIME_BUDGET_MS: 4.5 * 60 * 1000,

  run(source) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) {
      console.log('Previous run still in progress, skipping');
      return { skipped: true, reason: 'A run is already in progress' };
    }

    const started = Date.now();
    const logger = AppLog.create();
    const summary = {
      source: source,
      startedAt: new Date(started).toISOString(),
      messages: 0,
      filesSaved: 0,
      failures: 0,
      gaveUp: 0,
      timedOut: false,
    };

    try {
      const config = Config.get();
      const query = GmailService.buildQuery(config);
      if (!query) {
        summary.note = 'No enabled rules';
      } else {
        const labels = GmailService.ensureLabels();
        const ids = GmailService.listMessageIds(query);
        for (const id of ids) {
          if (Date.now() - started > this.TIME_BUDGET_MS) {
            summary.timedOut = true;
            break;
          }
          this.processMessage_(id, config, labels, logger, summary);
        }
      }
      MessageState.prune(config.lookbackDays + 2);
    } catch (e) {
      summary.error = String(e && e.message || e);
      logger.error('run_error', { error: summary.error, stack: e && e.stack });
    } finally {
      summary.durationMs = Date.now() - started;
      logger[summary.error ? 'error' : 'info']('run_summary', summary);
      logger.flush();
      Config.setLastRun(summary);
      lock.releaseLock();
    }
    return summary;
  },

  processMessage_(id, config, labels, logger, summary) {
    // Belt and braces: the search already excludes these, but the label check is exact.
    const labelIds = GmailService.getLabelIds(id);
    if (labelIds.indexOf(labels.processed) >= 0 || labelIds.indexOf(labels.failed) >= 0) return;

    const message = GmailApp.getMessageById(id);
    const from = GmailService.parseAddress(message.getFrom());
    const rule = Config.matchRule(config, from);
    const folderId = rule ? rule.folderId : config.defaultFolderId;
    if (!folderId) return;

    summary.messages++;
    const meta = {
      messageId: id,
      from: from,
      subject: message.getSubject(),
      ruleId: rule ? rule.id : null,
      folderId: folderId,
    };
    const attachments = message
      .getAttachments({ includeInlineImages: false, includeAttachments: true })
      .filter(a => a.getSize() > 0);

    if (!attachments.length) {
      // Only inline images (signatures etc.): mark it so it is not re-scanned, but leave it in the inbox.
      GmailService.markProcessed(id, labels, false);
      logger.info('message_no_files', meta);
      return;
    }

    const state = MessageState.get(id);
    const attempt = state.attempts + 1;
    let failure = null;

    attachments.forEach((attachment, index) => {
      if (failure || state.saved.indexOf(index) >= 0) return;
      const fileMeta = Object.assign({}, meta, {
        fileName: attachment.getName(),
        mimeType: attachment.getContentType(),
        size: attachment.getSize(),
        attempt: attempt,
      });
      let file;
      try {
        file = Retry.run(() => DriveService.save(attachment.copyBlob(), folderId));
      } catch (e) {
        failure = e;
        logger.warn('file_failed', Object.assign(fileMeta, { error: String(e && e.message || e) }));
        return;
      }
      state.saved.push(index);
      summary.filesSaved++;

      const processorKey = rule ? rule.processor : 'none';
      const result = Processors.run(processorKey, attachment.copyBlob(), {
        rule: rule,
        message: { id: id, from: from, subject: meta.subject, date: message.getDate() },
        file: { id: file.getId(), name: file.getName(), url: file.getUrl() },
        logger: logger,
      });
      logger.info('file_saved', Object.assign(fileMeta, {
        savedAs: file.getName(),
        fileId: file.getId(),
        fileUrl: file.getUrl(),
        processor: processorKey,
        processor_status: result.status,
        processor_error: result.error,
        extracted: result.extracted,
      }));
    });

    if (!failure) {
      GmailService.markProcessed(id, labels, true);
      MessageState.clear(id);
      return;
    }

    summary.failures++;
    if (attempt >= config.maxAttempts) {
      GmailService.markFailed(id, labels);
      MessageState.clear(id);
      summary.gaveUp++;
      logger.error('message_gave_up', Object.assign({}, meta, { attempts: attempt, error: String(failure.message || failure) }));
    } else {
      state.attempts = attempt;
      MessageState.save(id, state);
    }
  },
};
