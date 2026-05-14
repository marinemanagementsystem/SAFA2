"use strict";

const functions = require("@google-cloud/functions-framework");

function parseMessage(cloudEvent) {
  const encoded = cloudEvent?.data?.message?.data;
  if (!encoded) return {};
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function shouldDisableBilling(message, options = {}) {
  const currency = options.currency || process.env.HARD_CAP_CURRENCY || "TRY";
  const hardCapAmount = Number(options.amount ?? process.env.HARD_CAP_AMOUNT ?? message.budgetAmount ?? 400);
  const costAmount = Number(message.costAmount ?? 0);
  const budgetAmount = Number(message.budgetAmount ?? hardCapAmount);
  const effectiveCap = Number.isFinite(hardCapAmount) && hardCapAmount > 0 ? Math.min(hardCapAmount, budgetAmount) : budgetAmount;

  return (
    message.currencyCode === currency &&
    Number.isFinite(costAmount) &&
    Number.isFinite(effectiveCap) &&
    costAmount >= effectiveCap
  );
}

async function metadataToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!response.ok) {
    throw new Error(`Metadata token request failed with HTTP ${response.status}`);
  }
  const token = await response.json();
  return token.access_token;
}

async function disableBilling(projectId, token) {
  const response = await fetch(`https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ billingAccountName: "" })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Disable billing failed with HTTP ${response.status}: ${body}`);
  }

  return body ? JSON.parse(body) : {};
}

functions.cloudEvent("handleBudgetNotification", async (cloudEvent) => {
  const message = parseMessage(cloudEvent);
  const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "safa-8f76e";
  const dryRun = process.env.DRY_RUN === "true";

  if (!shouldDisableBilling(message)) {
    console.log(
      JSON.stringify({
        action: "ignore",
        projectId,
        costAmount: message.costAmount,
        budgetAmount: message.budgetAmount,
        currencyCode: message.currencyCode
      })
    );
    return;
  }

  if (dryRun) {
    console.log(
      JSON.stringify({
        action: "would-disable-billing",
        projectId,
        costAmount: message.costAmount,
        budgetAmount: message.budgetAmount,
        currencyCode: message.currencyCode
      })
    );
    return;
  }

  const token = await metadataToken();
  const result = await disableBilling(projectId, token);
  console.log(JSON.stringify({ action: "disabled-billing", projectId, result }));
});

module.exports = { shouldDisableBilling, parseMessage };
