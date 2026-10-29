# DriveDrop

Watches a Gmail inbox every 10 minutes and saves attachments from configured senders into Google Drive folders. Each saved file is logged (Axiom by default; Datadog or your own endpoint by changing one setting). A dashboard protected by a username and PIN manages the rules.

It runs entirely on Google Apps Script inside the Gmail account, plus the Axiom free plan. There is no server and nothing to pay for.

## How it works

- **Trigger:** `runPoll` runs every 10 minutes. It searches Gmail for
  `has:attachment -label:drivedrop-processed -label:drivedrop-failed newer_than:Nd from:(rule senders)`.
- **Routing:** an exact sender rule wins over a `*@domain.com` rule, which wins over the optional default folder. Mail from senders with no rule is left untouched.
- **Saving:** if a file with the same name already exists in the folder, the new file gets a timestamp suffix. Inline and signature images are skipped.
- **Success:** the email gets the `DriveDrop/Processed` label, is marked read, and is archived. Labels are applied per message, so a later reply in the same thread is still picked up.
- **Retries:**
  - Each Drive save is tried 3 times within a run, with 1s/2s backoff.
  - If it still fails, the email is retried on the next run. Attachments that were already saved are not saved again.
  - After *max attempts* the email gets the `DriveDrop/Failed` label. **Retry failed** on the dashboard clears that label.
- **Run limits:** a run stops picking up new emails after about 4.5 minutes, because Apps Script stops any run at 6 minutes. Anything left over is handled on the next run. A lock stops two runs from overlapping.
- **Logging:** see [Logging](#logging) below.

## Setup

1. Install Node.js LTS, then the clasp CLI:
   ```bash
   npm install -g @google/clasp@2.4.2
   ```
   Use the same version as the GitHub workflow. clasp 3 stores credentials in a different format.
2. Sign in to **the Gmail account that receives the emails** at https://script.google.com/home/usersettings and turn **Google Apps Script API** on.
3. Log clasp in with the same account:
   ```bash
   clasp login
   ```
4. From this folder, create the Apps Script project:
   ```bash
   clasp create --type standalone --title DriveDrop --rootDir src
   ```
   If clasp replaced `src/appsscript.json` with a default one, restore this repo's version before pushing. The manifest enables the Gmail advanced service and the web app settings.
5. Push the code:
   ```bash
   clasp push
   ```
6. Open the project with `clasp open`. Go to **Project Settings → Script Properties** and add:

   | Property | Value |
   |---|---|
   | `DASH_USERNAME` | dashboard username |
   | `DASH_PIN` | dashboard PIN (use 6+ digits) |
   | `AXIOM_TOKEN` | Axiom API token with ingest permission on the dataset |
   | `AXIOM_DATASET` | Axiom dataset name, e.g. `drive-drop` |

   Using something other than Axiom? See [Logging](#logging) for the other properties.

7. In the editor, choose `installTrigger` in the function dropdown, click **Run**, and approve the permissions (Gmail, Drive, external requests, triggers). This creates the 10-minute schedule and the Gmail labels.
8. Click **Deploy → New deployment → Web app**, with **Execute as: Me** and **Who has access: Anyone**. Open the `/exec` URL and log in.
9. In Axiom (free plan), create the dataset and an API token scoped to ingest into it.

After later code changes, either push to `main` (see below) or deploy by hand:
```bash
clasp push
```
```bash
clasp deploy --deploymentId <DEPLOYMENT_ID> --description "manual"
```

## Auto-deploy from GitHub

`.github/workflows/deploy.yml` runs on every push to `main` that changes `src/`. You can also start it by hand from the Actions tab. It runs `clasp push`, which updates the code the trigger runs, then `clasp deploy` against the existing web app deployment, so the `/exec` URL never changes.

Add three repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
|---|---|
| `CLASPRC_JSON` | The full contents of `~/.clasprc.json` (`%USERPROFILE%\.clasprc.json` on Windows), created by `clasp login`. It holds the refresh token for the Gmail account. |
| `SCRIPT_ID` | `scriptId` in your local `.clasp.json`, or Apps Script editor → Project Settings → Script ID. |
| `DEPLOYMENT_ID` | Apps Script editor → **Deploy → Manage deployments**, the web app's Deployment ID (starts with `AKfy…`), or run `clasp deployments`. |

Notes:
- `CLASPRC_JSON` gives full access to that Google account's scripts. Keep the repo private and never commit the file.
- If the deploy starts failing with `invalid_grant`, the token was revoked or the password changed. Run `clasp login` again and update the secret.
- Each deploy creates a new script version, and Apps Script allows **200 versions** per project. When you get close, delete old versions in the editor under **Project history**.
- Script Properties (the secrets) live in Apps Script, not in git, so deploys never touch them.

## Dashboard

- **Rules:** sender (`someone@x.com` or `*@x.com`) → Drive folder (paste a folder link or ID, or create a new folder), with a processor and an enabled toggle.
- **Settings:** default folder (optional; catches *all* senders that have no rule), max attempts, look-back days.
- **Status:** whether the schedule is installed, which log sinks are active and configured, the last run's numbers, **Run now**, and **Retry failed**.

## Logging

Code only talks to `AppLog` (`src/Log.js`), never to a vendor directly. It's called `AppLog` because Apps Script already has a built-in `Logger`. Each event is a plain object:

```json
{ "timestamp": "2026-10-15T08:00:00.000Z", "level": "info", "app": "drive-drop", "event": "file_saved", "fileName": "...", "...": "..." }
```

Events:

| Level | Events |
|---|---|
| `info` | `file_saved`, `message_no_files`, `run_summary`, `config_changed`, `retry_failed_requested` |
| `warn` | `file_failed` (will retry), `login_failed`, `login_locked` |
| `error` | `message_gave_up`, `run_error`, `run_summary` when the run errored |

**Choosing where logs go:** set the `LOG_SINKS` Script Property to a comma-separated list. Examples:

- `axiom` (the default when the property isn't set)
- `datadog`
- `axiom,datadog` to send to both

Switching needs no code change and no redeploy. Every event also goes to the Apps Script **Executions** log.

| Sink | Script Properties |
|---|---|
| `axiom` | `AXIOM_TOKEN`, `AXIOM_DATASET`, optional `AXIOM_URL` (default `https://api.axiom.co`) |
| `datadog` | `DATADOG_API_KEY`, optional `DATADOG_SITE` (default `datadoghq.com`; e.g. `datadoghq.eu`, `us5.datadoghq.com`), optional `DATADOG_TAGS` (`env:prod,team:ops`) |
| `webhook` | `LOG_WEBHOOK_URL`, optional `LOG_WEBHOOK_AUTH` (sent as the `Authorization` header). POSTs the events above as a JSON array, unchanged. Use it for your own API or logger. |

**Delivery:**
- During a run, events are batched and sent once at the end.
- Each sink is retried on 429 and 5xx responses.
- One sink failing doesn't affect the others, and never fails the run.

**Adding another destination:** add an entry to `LOG_SINKS` in `src/LogSinks.js` with `name`, `isConfigured()` and `send(events)`, then add its key to the `LOG_SINKS` property.

## Processors (future use)

`src/Processors.js` holds a registry of processors. Each rule picks one; the default is `none`. A processor runs after the file is saved and receives the blob plus `{ rule, message, file, logger }`. Whatever it returns is logged with the `file_saved` event as `extracted`. If a processor fails, the failure is logged but the Drive save is never undone.

A commented `invoiceToApi` example shows how to post data to an API. Keep API URLs and keys in Script Properties.

## Security notes

- Every top-level function in an Apps Script project can be called from the browser. Only `doGet`, `login`, `api`, `runPoll`, `installTrigger` and `uninstallTrigger` are top-level. `api` checks the session token on every call, and the two trigger functions only work when run from the editor by the owner.
- Sessions last 2 hours and are extended while the dashboard is in use. After 5 wrong PINs, login is locked for 15 minutes.
- The web app runs as the Gmail account owner, so anyone who has the URL *and* the PIN can change rules. Keep the `/exec` URL private.

## Limits (free consumer Gmail)

- 90 minutes of trigger runtime per day. At one run every 10 minutes, that leaves about 37 seconds per run on average. Idle runs take about 2 seconds.
- 20,000 external requests per day, and about 20,000 Gmail reads per day.
- Script Properties holds 9 KB per value, which is enough for about 40 rules.
