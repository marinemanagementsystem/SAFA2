#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-safa-8f76e}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-safa-api}"
SQL_INSTANCE="${SQL_INSTANCE:-safa-db}"

if [[ "${CONFIRM_DELETE_CLOUD_SQL:-}" != "1" ]]; then
  echo "Set CONFIRM_DELETE_CLOUD_SQL=1 after Firestore live tests pass."
  exit 1
fi

service_json="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format=json)"
data_backend="$(jq -r '.spec.template.spec.containers[0].env[]? | select(.name=="DATA_BACKEND") | .value' <<<"${service_json}")"
has_database_url="$(jq -r '[.spec.template.spec.containers[0].env[]? | .name] | contains(["DATABASE_URL"])' <<<"${service_json}")"
cloudsql_annotation="$(jq -r '.spec.template.metadata.annotations["run.googleapis.com/cloudsql-instances"] // ""' <<<"${service_json}")"

if [[ "${data_backend}" != "firestore" ]]; then
  echo "Refusing to delete Cloud SQL: Cloud Run DATA_BACKEND is '${data_backend}', expected 'firestore'."
  exit 1
fi

if [[ "${has_database_url}" != "false" ]]; then
  echo "Refusing to delete Cloud SQL: Cloud Run still has DATABASE_URL."
  exit 1
fi

if [[ -n "${cloudsql_annotation}" ]]; then
  echo "Refusing to delete Cloud SQL: Cloud Run still has Cloud SQL annotation '${cloudsql_annotation}'."
  exit 1
fi

gcloud sql instances delete "${SQL_INSTANCE}" --project "${PROJECT_ID}" --quiet
echo "Deleted Cloud SQL instance ${SQL_INSTANCE} after Firestore verification gates passed."
