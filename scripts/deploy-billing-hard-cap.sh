#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-safa-8f76e}"
REGION="${REGION:-europe-west1}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-013BBE-647C1B-B31470}"
BUDGET_ID="${BUDGET_ID:-22fff15e-fa4d-4a65-8324-d5cc83e36bbb}"
BUDGET_NAME="billingAccounts/${BILLING_ACCOUNT}/budgets/${BUDGET_ID}"
TOPIC="${TOPIC:-safa-billing-cap-topic}"
FUNCTION_NAME="${FUNCTION_NAME:-safa-stop-billing-on-budget}"
FUNCTION_RUNTIME="${FUNCTION_RUNTIME:-nodejs22}"
FUNCTION_SA_NAME="${FUNCTION_SA_NAME:-safa-billing-cap}"
FUNCTION_SA="${FUNCTION_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BUDGET_PUBLISHER="billing-budget-alert@system.gserviceaccount.com"
HARD_CAP_AMOUNT="${HARD_CAP_AMOUNT:-400}"
HARD_CAP_CURRENCY="${HARD_CAP_CURRENCY:-TRY}"
DRY_RUN="${DRY_RUN:-false}"

if [[ "${CONFIRM_BILLING_CAP:-}" != "1" ]]; then
  echo "Set CONFIRM_BILLING_CAP=1 to deploy the 400 TRY hard billing cap."
  exit 1
fi

grant_budget_publisher() {
  local policy_file
  local next_policy_file
  local token
  local response
  local body
  local status

  policy_file="$(mktemp)"
  next_policy_file="$(mktemp)"
  gcloud pubsub topics get-iam-policy "${TOPIC}" --project "${PROJECT_ID}" --format=json >"${policy_file}"
  TOPIC_POLICY_FILE="${policy_file}" node <<'NODE' >"${next_policy_file}"
const fs = require("node:fs");
const policy = JSON.parse(fs.readFileSync(process.env.TOPIC_POLICY_FILE, "utf8"));
policy.bindings = policy.bindings || [];
policy.version = policy.version || 1;
const role = "roles/pubsub.publisher";
const member = "serviceAccount:billing-budget-alert@system.gserviceaccount.com";
let binding = policy.bindings.find((candidate) => candidate.role === role && !candidate.condition);
if (!binding) {
  binding = { role, members: [] };
  policy.bindings.push(binding);
}
if (!binding.members.includes(member)) {
  binding.members.push(member);
}
process.stdout.write(JSON.stringify({ policy }));
NODE

  token="$(gcloud auth print-access-token)"
  response="$(
    curl -sS -w $'\n%{http_code}' -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "x-goog-user-project: ${PROJECT_ID}" \
      -H "Content-Type: application/json" \
      "https://pubsub.googleapis.com/v1/projects/${PROJECT_ID}/topics/${TOPIC}:setIamPolicy" \
      --data-binary @"${next_policy_file}"
  )"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  rm -f "${policy_file}" "${next_policy_file}"

  if [[ "${status}" != "200" ]]; then
    echo "Pub/Sub IAM update failed with HTTP ${status}: ${body}" >&2
    return 1
  fi
}

project_policy_backup="$(mktemp)"
project_policy_had_backup=0
project_policy_overridden=0
restore_project_domain_policy() {
  if [[ "${project_policy_overridden}" != "1" ]]; then
    rm -f "${project_policy_backup}"
    return
  fi

  if [[ "${project_policy_had_backup}" == "1" ]]; then
    gcloud org-policies set-policy "${project_policy_backup}" >/dev/null || true
  else
    gcloud org-policies delete constraints/iam.allowedPolicyMemberDomains --project="${PROJECT_ID}" --quiet >/dev/null 2>&1 || true
  fi
  project_policy_overridden=0
  rm -f "${project_policy_backup}"
}
trap restore_project_domain_policy EXIT

gcloud config set project "${PROJECT_ID}" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
gcloud services enable \
  artifactregistry.googleapis.com \
  billingbudgets.googleapis.com \
  cloudbilling.googleapis.com \
  cloudbuild.googleapis.com \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  iam.googleapis.com \
  orgpolicy.googleapis.com \
  pubsub.googleapis.com \
  run.googleapis.com \
  --project "${PROJECT_ID}"

gcloud pubsub topics describe "${TOPIC}" --project "${PROJECT_ID}" >/dev/null 2>&1 \
  || gcloud pubsub topics create "${TOPIC}" --project "${PROJECT_ID}"

if ! grant_budget_publisher; then
  if gcloud org-policies describe constraints/iam.allowedPolicyMemberDomains --project="${PROJECT_ID}" --format=yaml >"${project_policy_backup}" 2>/dev/null; then
    project_policy_had_backup=1
  fi

  gcloud org-policies set-policy <(
    printf '%s\n' \
      "name: projects/${PROJECT_NUMBER}/policies/iam.allowedPolicyMemberDomains" \
      "spec:" \
      "  rules:" \
      "  - allowAll: true"
  ) >/dev/null
  project_policy_overridden=1
  grant_budget_publisher
  restore_project_domain_policy
fi

gcloud iam service-accounts describe "${FUNCTION_SA}" --project "${PROJECT_ID}" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "${FUNCTION_SA_NAME}" \
    --display-name="SAFA budget hard cap" \
    --project "${PROJECT_ID}"

gcloud iam service-accounts add-iam-policy-binding "${FUNCTION_SA}" \
  --project "${PROJECT_ID}" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" >/dev/null

gcloud billing accounts add-iam-policy-binding "${BILLING_ACCOUNT}" \
  --member="serviceAccount:${FUNCTION_SA}" \
  --role="roles/billing.admin" >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${FUNCTION_SA}" \
  --role="roles/billing.projectManager" >/dev/null

TOKEN="$(gcloud auth print-access-token)"
curl -fsS -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-goog-user-project: ${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  "https://billingbudgets.googleapis.com/v1/${BUDGET_NAME}?updateMask=notificationsRule" \
  -d "{\"notificationsRule\":{\"pubsubTopic\":\"projects/${PROJECT_ID}/topics/${TOPIC}\",\"schemaVersion\":\"1.0\"}}" >/dev/null

gcloud functions deploy "${FUNCTION_NAME}" \
  --gen2 \
  --runtime="${FUNCTION_RUNTIME}" \
  --region="${REGION}" \
  --source=apps/billing-cap \
  --entry-point=handleBudgetNotification \
  --trigger-topic="${TOPIC}" \
  --service-account="${FUNCTION_SA}" \
  --set-env-vars="PROJECT_ID=${PROJECT_ID},HARD_CAP_AMOUNT=${HARD_CAP_AMOUNT},HARD_CAP_CURRENCY=${HARD_CAP_CURRENCY},DRY_RUN=${DRY_RUN}" \
  --project "${PROJECT_ID}" \
  --quiet

gcloud run services add-iam-policy-binding "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --member="serviceAccount:${FUNCTION_SA}" \
  --role="roles/run.invoker" >/dev/null

echo "Billing hard cap deployed. DRY_RUN=${DRY_RUN}, budget=${BUDGET_NAME}, topic=${TOPIC}."
