import { RISK_BUCKETS } from "./constants.js";
import { computeBucketExposure } from "./cursor.js";
import { IntentStatus } from "./mandate.js";
import { assertCondition, clone, sum } from "./utils.js";

export const VerificationStatus = Object.freeze({
  UNVERIFIED: "Unverified",
  APPROVED: "Approved",
  REJECTED: "Rejected"
});

export const RejectionReason = Object.freeze({
  INTENT_NOT_ACCEPTED: "intent is not accepted",
  ENVELOPE_INACTIVE: "ERC-8312 envelope is inactive",
  ENVELOPE_EXPIRED: "ERC-8312 envelope is expired",
  UNAUTHORIZED_PROPOSER: "proposer is not the accepted agent",
  INVALID_SOURCE_VAULT: "source vault is not approved or current",
  INSUFFICIENT_SOURCE_BALANCE: "source vault has insufficient balance",
  INVALID_TARGET_VAULT: "target vault is not approved",
  INSUFFICIENT_YIELD_IMPROVEMENT: "target vault does not improve yield by the minimum threshold",
  INVALID_AMOUNT: "amount must be positive",
  PER_VAULT_CAP: "resulting allocation exceeds max per-vault allocation",
  GROWTH_EXPERIMENTAL_CAP: "resulting Growth plus Experimental exposure exceeds mandate cap",
  EXPERIMENTAL_CAP: "resulting Experimental exposure exceeds mandate cap",
  TURNOVER_HEADROOM: "proposed turnover exceeds remaining ERC-8312 cursor headroom",
  WORKFLOW_STEP: "ERC-8301 workflow step is invalid",
  PROPOSAL_ALREADY_USED: "proposal has already been resolved"
});

export class MandateVerifier {
  constructor({ intentRegistry, envelopeRegistry, vaultsByName, substrate }) {
    this.intentRegistry = intentRegistry;
    this.envelopeRegistry = envelopeRegistry;
    this.vaultsByName = vaultsByName;
    this.substrate = substrate;
  }

  verify(task) {
    try {
      assertCondition(task.status === "ProposalSubmitted", "VERIFY_INVALID_WORKFLOW_STEP", RejectionReason.WORKFLOW_STEP);
      assertCondition(!task.resolved, "VERIFY_PROPOSAL_USED", RejectionReason.PROPOSAL_ALREADY_USED);

      const intent = this.intentRegistry.getIntent(task.intentDigest);
      assertCondition(intent.status === IntentStatus.READY, "VERIFY_INTENT_NOT_READY", RejectionReason.INTENT_NOT_ACCEPTED);
      const envelope = this.envelopeRegistry.getEnvelope(task.envelopeId);
      assertCondition(envelope.status !== "Expired", "VERIFY_ENVELOPE_EXPIRED", RejectionReason.ENVELOPE_EXPIRED);
      assertCondition(envelope.status === "Active", "VERIFY_ENVELOPE_INACTIVE", RejectionReason.ENVELOPE_INACTIVE);
      assertCondition(this.envelopeRegistry.isActive(task.envelopeId), "VERIFY_ENVELOPE_EXPIRED", RejectionReason.ENVELOPE_EXPIRED);
      assertCondition(task.proposer === intent.terms.agent, "VERIFY_BAD_PROPOSER", RejectionReason.UNAUTHORIZED_PROPOSER);

      const proposal = task.proposal;
      assertCondition(Number.isInteger(proposal.amount) && proposal.amount > 0, "VERIFY_INVALID_AMOUNT", RejectionReason.INVALID_AMOUNT);
      assertCondition(
        intent.terms.approvedVaults.includes(proposal.sourceVault),
        "VERIFY_BAD_SOURCE",
        RejectionReason.INVALID_SOURCE_VAULT
      );
      assertCondition(
        intent.terms.approvedVaults.includes(proposal.targetVault),
        "VERIFY_BAD_TARGET",
        RejectionReason.INVALID_TARGET_VAULT
      );
      assertCondition(proposal.sourceVault !== proposal.targetVault, "VERIFY_SAME_VAULTS", "source and target vault must differ");

      const currentAllocation = this.substrate.getAllocationByVault();
      assertCondition(
        currentAllocation[proposal.sourceVault] > 0,
        "VERIFY_SOURCE_NOT_CURRENT",
        RejectionReason.INVALID_SOURCE_VAULT
      );
      assertCondition(
        currentAllocation[proposal.sourceVault] >= proposal.amount,
        "VERIFY_SOURCE_INSUFFICIENT",
        RejectionReason.INSUFFICIENT_SOURCE_BALANCE
      );

      const sourceVault = this.vaultsByName[proposal.sourceVault];
      const targetVault = this.vaultsByName[proposal.targetVault];
      const yieldImprovement = targetVault.apyBps - sourceVault.apyBps;
      assertCondition(
        yieldImprovement >= intent.terms.minYieldImprovementBps,
        "VERIFY_YIELD_TOO_LOW",
        RejectionReason.INSUFFICIENT_YIELD_IMPROVEMENT,
        { yieldImprovement, required: intent.terms.minYieldImprovementBps }
      );

      const nextAllocation = clone(currentAllocation);
      nextAllocation[proposal.sourceVault] -= proposal.amount;
      nextAllocation[proposal.targetVault] += proposal.amount;
      const portfolioValue = sum(Object.values(nextAllocation));
      const perVaultMax = (portfolioValue * intent.terms.maxAllocationPerVaultBps) / 10000;
      for (const [vaultName, amount] of Object.entries(nextAllocation)) {
        assertCondition(amount <= perVaultMax, "VERIFY_PER_VAULT_CAP", RejectionReason.PER_VAULT_CAP, {
          vaultName,
          amount,
          limit: perVaultMax
        });
      }

      const metadataByName = Object.fromEntries(Object.values(this.vaultsByName).map((vault) => [vault.name, vault.metadata()]));
      const bucketExposure = computeBucketExposure(nextAllocation, metadataByName);
      const growthPlusExperimental =
        bucketExposure[RISK_BUCKETS.GROWTH] + bucketExposure[RISK_BUCKETS.EXPERIMENTAL];
      assertCondition(
        bucketExposure[RISK_BUCKETS.EXPERIMENTAL] <= (portfolioValue * intent.terms.maxExperimentalBps) / 10000,
        "VERIFY_EXPERIMENTAL_CAP",
        RejectionReason.EXPERIMENTAL_CAP,
        { experimental: bucketExposure[RISK_BUCKETS.EXPERIMENTAL] }
      );
      assertCondition(
        growthPlusExperimental <= (portfolioValue * intent.terms.maxGrowthPlusExperimentalBps) / 10000,
        "VERIFY_GROWTH_EXPERIMENTAL_CAP",
        RejectionReason.GROWTH_EXPERIMENTAL_CAP,
        { growthPlusExperimental }
      );

      const cursor = this.envelopeRegistry.readCursor(task.envelopeId);
      assertCondition(proposal.amount <= cursor.remainingTurnover, "VERIFY_TURNOVER_HEADROOM", RejectionReason.TURNOVER_HEADROOM, {
        requested: proposal.amount,
        remaining: cursor.remainingTurnover
      });

      return {
        status: VerificationStatus.APPROVED,
        approved: true,
        rejectionReason: null,
        nextAllocationByVault: nextAllocation,
        nextAllocationByRiskBucket: bucketExposure,
        turnoverDelta: proposal.amount,
        yieldImprovementBps: yieldImprovement
      };
    } catch (error) {
      return {
        status: VerificationStatus.REJECTED,
        approved: false,
        rejectionReason: error.message,
        rejectionCode: error.code ?? "VERIFY_REJECTED"
      };
    }
  }
}
