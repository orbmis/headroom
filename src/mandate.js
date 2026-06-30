import { WORKFLOW_TYPE } from "./constants.js";
import { assertCondition, clone, hashOf, nowSeconds } from "./utils.js";

export const IntentStatus = Object.freeze({
  NONE: "None",
  PROPOSED: "Proposed",
  READY: "Ready",
  EXECUTED: "Executed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired"
});

export class IntentRegistry {
  constructor({ clock = nowSeconds } = {}) {
    this.clock = clock;
    this.intents = new Map();
    this.nonces = new Map();
  }

  createMandateIntent(terms) {
    const normalizedTerms = normalizeMandateTerms(terms);
    assertCondition(normalizedTerms.expiry > this.clock(), "INTENT_EXPIRED_AT_CREATION", "Mandate expiry must be in the future.");

    const nonce = (this.nonces.get(normalizedTerms.agent) ?? 0) + 1;
    this.nonces.set(normalizedTerms.agent, nonce);

    const agreementHash = computeAgreementHash(normalizedTerms);
    const payloadHash = hashOf({
      version: "MANDATED_VAULT_REBALANCER_TERMS_V1",
      coordinationType: normalizedTerms.workflowType,
      agreementHash
    });
    const intentStructHash = hashOf({
      type: "AgentIntent",
      payloadHash,
      expiry: normalizedTerms.expiry,
      nonce,
      agentId: normalizedTerms.agent,
      coordinationType: normalizedTerms.workflowType,
      coordinationValue: normalizedTerms.startingPortfolioValue,
      participants: [normalizedTerms.principal, normalizedTerms.agent].sort()
    });
    const agentIntentDigest = hashOf({
      domain: { name: "ERC-8001", version: "1" },
      intentStructHash
    });

    const intent = {
      intentStructHash,
      agentIntentDigest,
      agreementHash,
      payloadHash,
      nonce,
      terms: normalizedTerms,
      acceptedBy: [],
      status: IntentStatus.PROPOSED,
      createdAt: this.clock()
    };
    this.intents.set(agentIntentDigest, intent);
    return clone(intent);
  }

  acceptIntent(agentIntentDigest, participant) {
    const intent = this.#getMutableIntent(agentIntentDigest);
    this.#assertNotExpired(intent);
    assertCondition(
      [intent.terms.principal, intent.terms.agent].includes(participant),
      "INTENT_UNLISTED_PARTICIPANT",
      "Only the principal and accepted agent can accept this mandate.",
      { participant }
    );
    assertCondition(!intent.acceptedBy.includes(participant), "INTENT_ALREADY_ACCEPTED", "Participant already accepted this mandate.", {
      participant
    });
    intent.acceptedBy.push(participant);
    intent.acceptedBy.sort();
    if (intent.acceptedBy.length === 2) {
      intent.status = IntentStatus.READY;
    }
    return clone(intent);
  }

  acceptMandate(agentIntentDigest) {
    const intent = this.getIntent(agentIntentDigest);
    if (!intent.acceptedBy.includes(intent.terms.principal)) {
      this.acceptIntent(agentIntentDigest, intent.terms.principal);
    }
    if (!intent.acceptedBy.includes(intent.terms.agent)) {
      return this.acceptIntent(agentIntentDigest, intent.terms.agent);
    }
    return this.getIntent(agentIntentDigest);
  }

  getIntent(agentIntentDigest) {
    return clone(this.#getMutableIntent(agentIntentDigest));
  }

  requireAccepted(agentIntentDigest) {
    const intent = this.#getMutableIntent(agentIntentDigest);
    this.#assertNotExpired(intent);
    assertCondition(intent.status === IntentStatus.READY, "INTENT_NOT_ACCEPTED", "Mandate intent is not accepted by all required parties.", {
      status: intent.status
    });
    return clone(intent);
  }

  #getMutableIntent(agentIntentDigest) {
    const intent = this.intents.get(agentIntentDigest);
    assertCondition(Boolean(intent), "INTENT_NOT_FOUND", "Mandate intent was not found.", { agentIntentDigest });
    return intent;
  }

  #assertNotExpired(intent) {
    if (intent.terms.expiry <= this.clock()) {
      intent.status = IntentStatus.EXPIRED;
      throw new Error("Mandate intent is expired.");
    }
  }
}

export function computeAgreementHash(terms) {
  return hashOf({
    type: "StructuredPortfolioMandateAgreement",
    terms: normalizeMandateTerms(terms)
  });
}

export function normalizeMandateTerms(terms) {
  const approvedVaults = [...terms.approvedVaults].sort();
  const riskBucketLabels = [...terms.riskBucketLabels].sort();
  return {
    principal: terms.principal,
    agent: terms.agent,
    asset: terms.asset,
    approvedVaults,
    riskBucketLabels,
    maxAllocationPerVaultBps: terms.maxAllocationPerVaultBps,
    maxGrowthPlusExperimentalBps: terms.maxGrowthPlusExperimentalBps,
    maxExperimentalBps: terms.maxExperimentalBps,
    maxCumulativeTurnover: terms.maxCumulativeTurnover,
    minYieldImprovementBps: terms.minYieldImprovementBps,
    expiry: terms.expiry,
    workflowType: terms.workflowType ?? WORKFLOW_TYPE,
    startingPortfolioValue: terms.startingPortfolioValue
  };
}
