#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-safa-8f76e}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-safa-api-live}"
REPOSITORY="${REPOSITORY:-safa}"
IMAGE_NAME="${IMAGE_NAME:-safa-api}"
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"
STORAGE_BUCKET="${STORAGE_BUCKET:-${PROJECT_ID}-safa-storage}"
STORAGE_MOUNT_PATH="${STORAGE_MOUNT_PATH:-/mnt/safa-storage}"
VOLUME_NAME="${VOLUME_NAME:-safa-storage}"
SCHEDULER_JOB="${SCHEDULER_JOB:-safa-gib-followup}"
SCHEDULER_SECRET="${SCHEDULER_SECRET:-safa-scheduler-secret}"
SCHEDULER_CRON="${SCHEDULER_CRON:-0 9,13,17,21 * * *}"
SAFA_AUTOMATION_DAILY_AUTO_RUN_LIMIT="${SAFA_AUTOMATION_DAILY_AUTO_RUN_LIMIT:-4}"
ARTIFACT_CLEANUP_POLICY_FILE="${ARTIFACT_CLEANUP_POLICY_FILE:-ops/artifact-registry-cleanup-policy.json}"

if [[ "${CONFIRM_DEPLOY:-}" != "1" ]]; then
  echo "This deploys paid Google Cloud resources. Re-run with CONFIRM_DEPLOY=1 after Firestore, secrets, and billing are ready."
  exit 1
fi

for command in gcloud firebase openssl pnpm; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} CLI is not installed or not on PATH."
    exit 1
  fi
done

gcloud config set project "${PROJECT_ID}" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  compute.googleapis.com \
  firestore.googleapis.com \
  cloudscheduler.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --project "${PROJECT_ID}"

if ! gcloud secrets describe "${SCHEDULER_SECRET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  openssl rand -hex 32 | gcloud secrets create "${SCHEDULER_SECRET}" \
    --replication-policy automatic \
    --data-file=- \
    --project "${PROJECT_ID}" >/dev/null
fi

gcloud artifacts repositories describe "${REPOSITORY}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format docker \
    --location "${REGION}" \
    --description "SAFA containers" \
    --project "${PROJECT_ID}"

if [[ -f "${ARTIFACT_CLEANUP_POLICY_FILE}" ]]; then
  gcloud artifacts repositories set-cleanup-policies "${REPOSITORY}" \
    --location "${REGION}" \
    --policy "${ARTIFACT_CLEANUP_POLICY_FILE}" \
    --no-dry-run \
    --project "${PROJECT_ID}" >/dev/null
fi

if ! gcloud storage buckets describe "gs://${STORAGE_BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${STORAGE_BUCKET}" \
    --location "${REGION}" \
    --uniform-bucket-level-access \
    --project "${PROJECT_ID}"
fi

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role="roles/datastore.user" >/dev/null

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${TAG}"
if ! gcloud firestore databases describe --database="(default)" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database="(default)" \
    --location="${FIRESTORE_LOCATION:-eur3}" \
    --project "${PROJECT_ID}"
fi

gcloud builds submit \
  --config cloudbuild.safa-api.yaml \
  --substitutions "_IMAGE=${IMAGE}" \
  --project "${PROJECT_ID}" \
  .

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --no-invoker-iam-check \
  --execution-environment gen2 \
  --clear-cloudsql-instances \
  --clear-vpc-connector \
  --clear-network \
  --port 8080 \
  --cpu 1 \
  --memory 1Gi \
  --min-instances 0 \
  --max-instances 3 \
  --cpu-throttling \
  --service-account "${RUNTIME_SERVICE_ACCOUNT}" \
  --add-volume "name=${VOLUME_NAME},type=cloud-storage,bucket=${STORAGE_BUCKET}" \
  --add-volume-mount "volume=${VOLUME_NAME},mount-path=${STORAGE_MOUNT_PATH}" \
  --set-env-vars "^@^NODE_ENV=production@DATA_BACKEND=firestore@QUEUE_MODE=sync@STORAGE_DIR=${STORAGE_MOUNT_PATH}@SAFA_AUTOMATION_DAILY_AUTO_RUN_LIMIT=${SAFA_AUTOMATION_DAILY_AUTO_RUN_LIMIT}@CORS_ORIGIN=https://safa-8f76e.web.app,https://safa-8f76e.firebaseapp.com@NEXT_PUBLIC_API_BASE_URL=/api" \
  --set-secrets "APP_SECRET_KEY=safa-app-secret-key:latest,SAFA_SESSION_SECRET=safa-session-secret:latest,SAFA_ADMIN_PASSWORD_HASH=safa-admin-password-hash:latest,SAFA_SCHEDULER_SECRET=${SCHEDULER_SECRET}:latest" \
  --project "${PROJECT_ID}"

SERVICE_URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')"
SCHEDULER_URI="${SERVICE_URL}/api/jobs/scheduled/gib-followup/run-next"
SCHEDULER_SECRET_VALUE="$(gcloud secrets versions access latest --secret "${SCHEDULER_SECRET}" --project "${PROJECT_ID}")"
if gcloud scheduler jobs describe "${SCHEDULER_JOB}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${SCHEDULER_JOB}" \
    --location "${REGION}" \
    --schedule "${SCHEDULER_CRON}" \
    --time-zone "Europe/Istanbul" \
    --uri "${SCHEDULER_URI}" \
    --http-method POST \
    --update-headers "X-SAFA-SCHEDULER-SECRET=${SCHEDULER_SECRET_VALUE}" \
    --project "${PROJECT_ID}" >/dev/null
else
  gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
    --location "${REGION}" \
    --schedule "${SCHEDULER_CRON}" \
    --time-zone "Europe/Istanbul" \
    --uri "${SCHEDULER_URI}" \
    --http-method POST \
    --headers "X-SAFA-SCHEDULER-SECRET=${SCHEDULER_SECRET_VALUE}" \
    --project "${PROJECT_ID}" >/dev/null
fi

pnpm --filter @safa/web build:firebase
# firebase.json "hosting.site" may target an isolated site (e.g. redesign). Keep the
# REST fallback on the SAME site so a CLI failure never publishes to the wrong site.
HOSTING_SITE="$(node -e "try{process.stdout.write((require('./firebase.json').hosting?.site)||'')}catch(e){}" 2>/dev/null || true)"
if ! firebase deploy --only hosting --project "${PROJECT_ID}"; then
  echo "Firebase CLI deploy failed; falling back to Firebase Hosting REST deploy with gcloud OAuth."
  FIREBASE_SITE="${HOSTING_SITE:-${PROJECT_ID}}" ./scripts/deploy-firebase-hosting-rest.sh
fi

echo "SAFA API deployed to Cloud Run and Firebase Hosting rewrites deployed."
