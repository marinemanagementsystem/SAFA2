# SAFA Firebase Cloud Run deployment

This is the permanent production path for `https://safa-8f76e.web.app`.

## What runs where

- Firebase Hosting serves the static Next.js panel.
- Firebase Hosting rewrites `/api/**` to Cloud Run service `safa-api` in `europe-west1`.
- Cloud Run runs the real Nest API from `apps/api`.
- Firestore Native mode stores orders, drafts, invoices, jobs, and encrypted integration settings.
- Production can run in low-cost `QUEUE_MODE=sync`, which skips Memorystore Redis and processes invoice jobs in the request path. Use Redis only when background queue reliability is worth the extra monthly cost.
- Cloud Storage is mounted at `/mnt/safa-storage` so invoice PDFs survive Cloud Run restarts.
- A Pub/Sub-triggered Cloud Run Function can disable project billing when the 400 TRY budget notification reaches the cap. This is intentionally disruptive: Firebase Hosting, Cloud Run, Firestore, and Storage may stop until billing is linked again.

## Required secrets

Create these Secret Manager secrets before deploying:

- `safa-app-secret-key`
- `safa-session-secret`
- `safa-admin-password-hash`

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

The script builds `Dockerfile.cloudrun`, deploys Cloud Run in low-cost scale-to-zero mode with `DATA_BACKEND=firestore`, mounts the Cloud Storage bucket, creates the default Firestore database if needed, and deploys Firebase Hosting with the `/api/**` rewrite.

The deploy script uses Cloud Run's `--no-invoker-iam-check` because this project blocks public `allUsers` IAM bindings through organization policy. Firebase Hosting still reaches the service through the `/api/**` rewrite.

## 400 TRY hard cap

The 400 TRY budget alert is not a hard cap by itself. To make it disruptive, deploy the budget notification function:

```bash
CONFIRM_BILLING_CAP=1 \
DRY_RUN=true \
./scripts/deploy-billing-hard-cap.sh
```

After dry-run Pub/Sub tests confirm `would-disable-billing` at 100% and no action at 50/80%, deploy live mode:

```bash
CONFIRM_BILLING_CAP=1 \
DRY_RUN=false \
./scripts/deploy-billing-hard-cap.sh
```

When the budget message reports `costAmount >= 400` and `currencyCode == TRY`, the function unlinks billing from project `safa-8f76e`. Reported billing can lag, so this reduces risk but cannot guarantee the final invoice lands exactly at 400 TRY.

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

Then open `https://safa-8f76e.web.app`, log in, and verify:

- The browser does not ask for local network or `localhost:4000` permission.
- `Trendyol cek` reaches the Cloud Run API.
- e-Arsiv portal connection can be saved and tested.
- A generated invoice PDF still opens after a Cloud Run redeploy.
