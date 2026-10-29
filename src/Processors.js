/**
 * Processors run after a file is saved to Drive. A rule picks one by key.
 *
 * run(blob, ctx) receives the attachment blob and
 *   ctx = { rule, message: { id, from, subject, date }, file: { id, name, url }, logger }
 * (logger.info / warn / error(event, fields) adds to the run's log batch)
 * and returns any extracted data (it is attached to the file_saved log event as `extracted`).
 * A processor failure is logged but never undoes the Drive save.
 */
const PROCESSORS = {
  none: {
    name: 'None (save only)',
    run: () => null,
  },

  // Example for later: post extracted data to an API. URL/key live in Script Properties.
  // invoiceToApi: {
  //   name: 'Invoice PDF -> API',
  //   run: (blob, ctx) => {
  //     const data = { fileName: ctx.file.name, driveUrl: ctx.file.url, from: ctx.message.from };
  //     UrlFetchApp.fetch(Config.secret('INVOICE_API_URL'), {
  //       method: 'post',
  //       contentType: 'application/json',
  //       headers: { 'x-api-key': Config.secret('INVOICE_API_KEY') },
  //       payload: JSON.stringify(data),
  //     });
  //     return data;
  //   },
  // },
};

const Processors = {
  list() {
    return Object.keys(PROCESSORS).map(key => ({ key: key, name: PROCESSORS[key].name }));
  },

  exists(key) {
    return Object.prototype.hasOwnProperty.call(PROCESSORS, key);
  },

  run(key, blob, ctx) {
    if (!key || key === 'none' || !this.exists(key)) return { status: 'skipped' };
    try {
      return { status: 'ok', extracted: PROCESSORS[key].run(blob, ctx) };
    } catch (e) {
      return { status: 'failed', error: String(e && e.message || e) };
    }
  },
};
