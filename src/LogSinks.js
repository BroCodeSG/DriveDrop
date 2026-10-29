/**
 * Log destinations. To add one: add an entry here, then put its key in the LOG_SINKS Script Property.
 *
 * Sink contract:
 *   name           display name for the dashboard
 *   isConfigured() true when its Script Properties are set
 *   send(events)   ships an array of generic events (see Log.js). Throw to have it retried;
 *                  throw NonRetryableError to give up straight away.
 */
const LOG_SINKS = {
  // AXIOM_TOKEN, AXIOM_DATASET, optional AXIOM_URL (default https://api.axiom.co)
  axiom: {
    name: 'Axiom',
    isConfigured: () => !!(Config.secret('AXIOM_TOKEN') && Config.secret('AXIOM_DATASET')),
    send(events) {
      const baseUrl = (Config.secret('AXIOM_URL') || 'https://api.axiom.co').replace(/\/+$/, '');
      const url = baseUrl + '/v1/datasets/' + encodeURIComponent(Config.secret('AXIOM_DATASET')) + '/ingest';
      const body = events.map(e => {
        const copy = Object.assign({ _time: e.timestamp }, e);
        delete copy.timestamp;
        return copy;
      });
      LogSinks.postJson_(this.name, url, { Authorization: 'Bearer ' + Config.secret('AXIOM_TOKEN') }, body);
    },
  },

  // DATADOG_API_KEY, optional DATADOG_SITE (default datadoghq.com; e.g. datadoghq.eu, us5.datadoghq.com), optional DATADOG_TAGS ("env:prod,team:ops")
  datadog: {
    name: 'Datadog',
    isConfigured: () => !!Config.secret('DATADOG_API_KEY'),
    send(events) {
      const site = Config.secret('DATADOG_SITE') || 'datadoghq.com';
      const tags = Config.secret('DATADOG_TAGS') || '';
      const body = events.map(e => Object.assign({
        ddsource: 'google-apps-script',
        service: e.app,
        status: e.level,
        message: e.event,
        ddtags: tags,
      }, e));
      LogSinks.postJson_(this.name, 'https://http-intake.logs.' + site + '/api/v2/logs',
        { 'DD-API-KEY': Config.secret('DATADOG_API_KEY') }, body);
    },
  },

  // Your own endpoint. LOG_WEBHOOK_URL, optional LOG_WEBHOOK_AUTH (sent as the Authorization header).
  // Receives the generic events as a JSON array, unchanged.
  webhook: {
    name: 'Webhook',
    isConfigured: () => !!Config.secret('LOG_WEBHOOK_URL'),
    send(events) {
      const auth = Config.secret('LOG_WEBHOOK_AUTH');
      LogSinks.postJson_(this.name, Config.secret('LOG_WEBHOOK_URL'), auth ? { Authorization: auth } : {}, events);
    },
  },
};

const LogSinks = {
  /** 429 and 5xx are retried; any other non-2xx is not. */
  postJson_(sinkName, url, headers, body) {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code < 300) return;
    const message = sinkName + ' responded ' + code + ': ' + response.getContentText().slice(0, 300);
    if (code === 429 || code >= 500) throw new Error(message);
    throw new NonRetryableError(message);
  },
};
