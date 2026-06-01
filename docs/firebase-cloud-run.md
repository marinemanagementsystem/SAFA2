# SAFA Firebase Cloud Run deployment

This is the permanent production path for `https://safa-8f76e.web.app`.

## What runs where

- Firebase Hosting serves the static Next.js panel.
- Firebase Hosting rewrites `/api/**` and escaped GIB portal `/earsiv-services/**` requests to Cloud Run service `safa-api-live` in `europe-west1`.
- Cloud Run runs the real Nest API from `apps/api`.
- Firestore Native mode stores orders, drafts, invoices, jobs, and encrypted integration settings.
- Production can run in low-cost `QUEUE_MODE=sync`, which skips Memorystore Redis and processes invoice jobs in the request path. Use Redis only when background queue reliability is worth the extra monthly cost.
- Cloud Storage is mounted at `/mnt/safa-storage` so invoice PDFs survive Cloud Run restarts.
- Cloud Scheduler calls the secured `/api/jobs/scheduled/gib-followup/run-next` endpoint at 09:00, 13:00, 17:00, and 21:00 Europe/Istanbul. The API keeps unfinished follow-up jobs resumable for 48 hours, avoids duplicate work, and exposes manual catch-up through `/api/automation/run-now`.
- Budget protection is app-level throttling, not billing unlink. `SAFA_AUTOMATION_DAILY_AUTO_RUN_LIMIT` defaults to `4`; if automatic runs are exhausted, scheduled work stays pending and the UI shows that manual update is still available. A hard billing cap is intentionally not part of the live path because it can stop Firebase Hosting, Cloud Run, Firestore, and Storage.

## Required secrets

Create these Secret Manager secrets before deploying:

- `safa-app-secret-key`
- `safa-session-secret`
- `safa-admin-password-hash`
- `safa-scheduler-secret` is created automatically by `scripts/deploy-cloud-run-api.sh` if missing. It is passed to Cloud Run as `SAFA_SCHEDULER_SECRET` and to Cloud Scheduler as the `X-SAFA-SCHEDULER-SECRET` header.

Keep the same `APP_SECRET_KEY` if you migrate an existing local database. Otherwise saved Trendyol and e-Arsiv credentials cannot be decrypted.

`safa-admin-password-hash` should use the same `sha256(username:password)` hash format as the old Firebase login so the existing `sarper` login password can continue to work without storing the plain password in Secret Manager.

## Cloud SQL to Firestore migration

Run the migration before switching production traffic to Firestore:

```bash
CONFIRM_FIRESTORE_MIGRATION=1 \
PROJECT_ID=safa-8f76e \
pnpm --filter @safa/api migrate:firestore
```

The migration copies `Setting`, `Order`, `InvoiceDraft`, `Invoice`, `ExternalInvoice`, `IntegrationJob`, and `AuditLog` rows into Firestore with the same IDs and writes the unique-index documents used by the API. It prints source and Firestore counts plus spot checks. Do not delete Cloud SQL until the live API tests pass on `DATA_BACKEND=firestore`.

## Deploy command

Only run this after Firestore migration and secrets exist:

```bash
CONFIRM_DEPLOY=1 \
./scripts/deploy-cloud-run-api.sh
```

The script builds `Dockerfile.cloudrun`, deploys Cloud Run in low-cost scale-to-zero mode with `DATA_BACKEND=firestore`, mounts the Cloud Storage bucket, applies the Artifact Registry cleanup policy in `ops/artifact-registry-cleanup-policy.json`, creates the default Firestore database if needed, creates/updates the `safa-gib-followup` Cloud Scheduler job, and deploys Firebase Hosting with the `/api/**` and `/earsiv-services/**` rewrites.

The deploy script uses Cloud Run's `--no-invoker-iam-check` because this project blocks public `allUsers` IAM bindings through organization policy. Firebase Hosting still reaches the service through the `/api/**` and `/earsiv-services/**` rewrites.

If Firebase CLI finalization fails while pinning Cloud Run rewrites, the script falls back to `scripts/deploy-firebase-hosting-rest.sh`. Keep this REST fallback config in sync with `firebase.json`; it must include both rewrites. The `/earsiv-services/**` rewrite is not public file access: the API auth middleware requires a valid SAFA session, returns `401` without auth, returns `410` when the last GIB proxy session is missing or expired, and only forwards to the configured GIB portal origin.

## Budget guard

The production default is `free-tier-guard`: Cloud Run stays scale-to-zero, Cloud Scheduler runs four times per day, and the app records automation freshness in `/api/automation/status`. Manual catch-up stays available from the UI and runs as a durable job, so a closed browser does not lose the work.

Do not deploy a billing-unlink hard cap for normal production. It prevents surprise spend only by stopping paid Google Cloud resources, which conflicts with the no-loss automation requirement. Use Google Cloud Budget email alerts for human notification, app-level throttling for automation volume, and Artifact Registry cleanup for image buildup.

## Cloud SQL retirement

After Firestore live tests pass:

```bash
CONFIRM_DELETE_CLOUD_SQL=1 \
./scripts/delete-cloud-sql-after-firestore.sh
```

This script refuses to delete Cloud SQL unless Cloud Run is already on `DATA_BACKEND=firestore`, has no `DATABASE_URL`, and has no Cloud SQL annotation.

## Verification

Before using the system for real invoices:

```bash
curl -i https://safa-8f76e.web.app/api/settings
```

Expected result before login: `401 Unauthorized`.

Also verify the escaped e-Arsiv fallback does not render a Next static 404:

```bash
curl -i 'https://safa-8f76e.web.app/earsiv-services/download?token=probe'
```

Expected result before login: `401 Unauthorized` JSON from Cloud Run. A Next.js `404: This page could not be found` means the Hosting rewrite is missing or stale.

Then open `https://safa-8f76e.web.app`, log in, and verify:

- The browser does not ask for local network or `localhost:4000` permission.
- `Trendyol cek` reaches the Cloud Run API.
- e-Arsiv portal connection can be saved and tested.
- A generated invoice PDF still opens after a Cloud Run redeploy.
