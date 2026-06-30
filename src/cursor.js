import { RISK_BUCKETS } from "./constants.js";
import { assertCondition, clone, hashOf, nowSeconds, sortObjectByKey, sum } from "./utils.js";

export const EnvelopeStatus = Object.freeze({
  NONE: "None",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CONTESTED: "Contested",
  REVOKED: "Revoked",
  EXPIRED: "Expired"
});

export function computeBucketExposure(allocationByVault, vaultMetadataByName) {
  const exposure = {
    [RISK_BUCKETS.CORE]: 0,
    [RISK_BUCKETS.GROWTH]: 0,
    [RISK_BUCKETS.EXPERIMENTAL]: 0
  };
  for (const [vaultName, amount] of Object.entries(allocationByVault)) {
    const metadata = vaultMetadataByName[vaultName];
    assertCondition(Boolean(metadata), "CURSOR_UNKNOWN_VAULT", "Cannot compute exposure for unknown vault.", { vaultName });
    exposure[metadata.riskBucket] = (exposure[metadata.riskBucket] ?? 0) + amount;
  }
  return sortObjectByKey(exposure);
}

export function buildCursorState({
  allocationByVault,
  vaultMetadataByName,
  maxCumulativeTurnover,
  cumulativeTurnover = 0,
  lastRebalanceSequence = 0,
  status = EnvelopeStatus.ACTIVE,
  expiresAt
}) {
  const normalizedAllocation = sortObjectByKey(allocationByVault);
  const portfolioValue = sum(Object.values(normalizedAllocation));
  const allocationByRiskBucket = computeBucketExposure(normalizedAllocation, vaultMetadataByName);
  const remainingTurnover = maxCumulativeTurnover - cumulativeTurnover;
  assertCondition(remainingTurnover >= 0, "CURSOR_NEGATIVE_HEADROOM", "Cursor turnover cannot exceed the maximum turnover.");
  return {
    allocationByVault: normalizedAllocation,
    allocationByRiskBucket,
    portfolioValue,
    maxCumulativeTurnover,
    cumulativeTurnover,
    remainingTurnover,
    lastRebalanceSequence,
    status,
    expiresAt
  };
}

export function computeCursorRoot(cursorState) {
  return hashOf({
    type: "ERC-8312PortfolioMandateCursor",
    cursorState
  });
}

export function computeCapabilityRoot({ agentIntentDigest, agreementHash }) {
  return hashOf({
    type: "ERC-8312CapabilityRoot",
    binds: {
      erc8001AgentIntentDigest: agentIntentDigest,
      agreementHash
    }
  });
}

export class EnvelopeRegistry {
  constructor({ intentRegistry, vaultMetadataByName, clock = nowSeconds } = {}) {
    this.intentRegistry = intentRegistry;
    this.vaultMetadataByName = vaultMetadataByName;
    this.clock = clock;
    this.envelopes = new Map();
    this.cursors = new Map();
    this.sequence = 0;
  }

  registerEnvelope({ agentIntentDigest, initialAllocation, initialTurnover = 0 }) {
    const intent = this.intentRegistry.requireAccepted(agentIntentDigest);
    const capabilityRoot = computeCapabilityRoot({
      agentIntentDigest,
      agreementHash: intent.agreementHash
    });
    const cursorState = buildCursorState({
      allocationByVault: initialAllocation,
      vaultMetadataByName: this.vaultMetadataByName,
      maxCumulativeTurnover: intent.terms.maxCumulativeTurnover,
      cumulativeTurnover: initialTurnover,
      expiresAt: intent.terms.expiry
    });
    const cursorRoot = computeCursorRoot(cursorState);
    const id = hashOf({
      registry: "ERC-8312:PortfolioMandateEnvelopeRegistry",
      principal: intent.terms.principal,
      capabilityRoot,
      cursorRoot,
      sequence: ++this.sequence
    });
    const envelope = {
      id,
      principal: intent.terms.principal,
      agentIntentDigest,
      agreementHash: intent.agreementHash,
      capabilityRoot,
      cursorRoot,
      createdAt: this.clock(),
      expiresAt: intent.terms.expiry,
      status: EnvelopeStatus.ACTIVE
    };
    this.envelopes.set(id, envelope);
    this.cursors.set(id, cursorState);
    return {
      envelope: clone(envelope),
      cursor: this.readCursor(id)
    };
  }

  getEnvelope(id) {
    const envelope = clone(this.#getMutableEnvelope(id));
    if (envelope.expiresAt <= this.clock() && envelope.status === EnvelopeStatus.ACTIVE) {
      envelope.status = EnvelopeStatus.EXPIRED;
    }
    return envelope;
  }

  getCursorRoot(id) {
    return this.getEnvelope(id).cursorRoot;
  }

  readCursor(id) {
    this.#getMutableEnvelope(id);
    const cursor = clone(this.cursors.get(id));
    return {
      ...cursor,
      cursorRoot: computeCursorRoot(cursor),
      isActive: this.isActive(id)
    };
  }

  isActive(id) {
    const envelope = this.#getMutableEnvelope(id);
    return envelope.status === EnvelopeStatus.ACTIVE && envelope.expiresAt > this.clock();
  }

  revoke(id) {
    const envelope = this.#getMutableEnvelope(id);
    assertCondition(envelope.status === EnvelopeStatus.ACTIVE, "ENVELOPE_INVALID_STATUS_TRANSITION", "Only active envelopes can be revoked.");
    envelope.status = EnvelopeStatus.REVOKED;
    const cursor = this.cursors.get(id);
    cursor.status = EnvelopeStatus.REVOKED;
    envelope.cursorRoot = computeCursorRoot(cursor);
    return this.getEnvelope(id);
  }

  advanceCursor(id, witness) {
    const envelope = this.#getMutableEnvelope(id);
    assertCondition(envelope.status === EnvelopeStatus.ACTIVE, "ENVELOPE_INACTIVE", "Envelope is not active.", { status: envelope.status });
    assertCondition(envelope.expiresAt > this.clock(), "ENVELOPE_EXPIRED", "Envelope is expired.", { expiresAt: envelope.expiresAt });
    const current = this.cursors.get(id);
    const prevCursorRoot = computeCursorRoot(current);
    assertCondition(witness.prevCursorRoot === prevCursorRoot, "CURSOR_STALE_WITNESS", "Cursor witness does not match the current cursor root.", {
      expected: prevCursorRoot,
      received: witness.prevCursorRoot
    });
    assertCondition(witness.turnoverDelta <= current.remainingTurnover, "CURSOR_INSUFFICIENT_TURNOVER", "Insufficient remaining turnover headroom.", {
      requested: witness.turnoverDelta,
      remaining: current.remainingTurnover
    });
    const next = buildCursorState({
      allocationByVault: witness.nextAllocationByVault,
      vaultMetadataByName: this.vaultMetadataByName,
      maxCumulativeTurnover: current.maxCumulativeTurnover,
      cumulativeTurnover: current.cumulativeTurnover + witness.turnoverDelta,
      lastRebalanceSequence: current.lastRebalanceSequence + 1,
      status: EnvelopeStatus.ACTIVE,
      expiresAt: current.expiresAt
    });
    this.cursors.set(id, next);
    envelope.cursorRoot = computeCursorRoot(next);
    return this.readCursor(id);
  }

  snapshot() {
    return {
      envelopes: Object.fromEntries(this.envelopes),
      cursors: Object.fromEntries(this.cursors),
      sequence: this.sequence
    };
  }

  restore(snapshot) {
    this.envelopes = new Map(Object.entries(snapshot.envelopes));
    this.cursors = new Map(Object.entries(snapshot.cursors));
    this.sequence = snapshot.sequence;
  }

  #getMutableEnvelope(id) {
    const envelope = this.envelopes.get(id);
    assertCondition(Boolean(envelope), "ENVELOPE_NOT_FOUND", "Envelope was not found.", { id });
    return envelope;
  }
}
