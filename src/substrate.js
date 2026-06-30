import { SUBSTRATE_ADDRESS } from "./constants.js";
import { DomainError, assertCondition } from "./utils.js";
import { VerificationStatus } from "./verifier.js";

export class ControlledSubstrate {
  constructor({ token, vaultsByName, intentRegistry, envelopeRegistry, receiptStore }) {
    this.token = token;
    this.vaultsByName = vaultsByName;
    this.intentRegistry = intentRegistry;
    this.envelopeRegistry = envelopeRegistry;
    this.receiptStore = receiptStore;
    this.address = SUBSTRATE_ADDRESS;
  }

  depositFromUser(user, amount) {
    this.token.transfer(user, this.address, amount);
  }

  setInitialAllocation(allocationByVault) {
    const total = Object.values(allocationByVault).reduce((acc, amount) => acc + amount, 0);
    assertCondition(this.token.balanceOf(this.address) >= total, "SUBSTRATE_INSUFFICIENT_CASH", "substrate does not hold enough cash");
    for (const [vaultName, amount] of Object.entries(allocationByVault)) {
      if (amount > 0) {
        this.#getVault(vaultName).deposit(this.address, amount);
      }
    }
  }

  getAllocationByVault() {
    return Object.fromEntries(
      Object.keys(this.vaultsByName)
        .sort()
        .map((vaultName) => [vaultName, this.vaultsByName[vaultName].balanceOf(this.address)])
    );
  }

  executeTask(task) {
    const intent = this.intentRegistry.getIntent(task.intentDigest);
    const cursorBefore = this.envelopeRegistry.readCursor(task.envelopeId);
    const allocationBefore = this.getAllocationByVault();

    if (task.verificationStatus !== VerificationStatus.APPROVED || !task.verification?.approved) {
      return this.receiptStore.record({
        taskId: task.taskId,
        intentDigest: task.intentDigest,
        agreementHash: intent.agreementHash,
        envelopeId: task.envelopeId,
        sourceVault: task.proposal?.sourceVault ?? null,
        targetVault: task.proposal?.targetVault ?? null,
        amount: task.proposal?.amount ?? null,
        verificationResult: VerificationStatus.REJECTED,
        rejectionReason: task.rejectionReason ?? task.verification?.rejectionReason ?? "proposal was not approved",
        cursorBefore,
        cursorAfter: null,
        allocationBefore,
        allocationAfter: null,
        workflowStatus: task.status
      });
    }

    const tokenSnapshot = this.token.snapshot();
    const vaultSnapshots = Object.fromEntries(Object.entries(this.vaultsByName).map(([name, vault]) => [name, vault.snapshot()]));
    const envelopeSnapshot = this.envelopeRegistry.snapshot();

    try {
      this.#getVault(task.proposal.sourceVault).withdraw(this.address, task.proposal.amount);
      this.#getVault(task.proposal.targetVault).deposit(this.address, task.proposal.amount);
      const cursorAfter = this.envelopeRegistry.advanceCursor(task.envelopeId, {
        prevCursorRoot: cursorBefore.cursorRoot,
        nextAllocationByVault: this.getAllocationByVault(),
        turnoverDelta: task.verification.turnoverDelta,
        taskId: task.taskId,
        proposalHash: task.proposalHash
      });
      const allocationAfter = this.getAllocationByVault();
      return this.receiptStore.record({
        taskId: task.taskId,
        intentDigest: task.intentDigest,
        agreementHash: intent.agreementHash,
        envelopeId: task.envelopeId,
        sourceVault: task.proposal.sourceVault,
        targetVault: task.proposal.targetVault,
        amount: task.proposal.amount,
        verificationResult: VerificationStatus.APPROVED,
        rejectionReason: null,
        cursorBefore,
        cursorAfter,
        allocationBefore,
        allocationAfter,
        workflowStatus: "Executed"
      });
    } catch (error) {
      this.token.restore(tokenSnapshot);
      for (const [name, snapshot] of Object.entries(vaultSnapshots)) {
        this.vaultsByName[name].restore(snapshot);
      }
      this.envelopeRegistry.restore(envelopeSnapshot);
      const reason = error instanceof DomainError ? error.message : `execution failed: ${error.message}`;
      return this.receiptStore.record({
        taskId: task.taskId,
        intentDigest: task.intentDigest,
        agreementHash: intent.agreementHash,
        envelopeId: task.envelopeId,
        sourceVault: task.proposal.sourceVault,
        targetVault: task.proposal.targetVault,
        amount: task.proposal.amount,
        verificationResult: VerificationStatus.REJECTED,
        rejectionReason: reason,
        cursorBefore,
        cursorAfter: null,
        allocationBefore,
        allocationAfter: null,
        workflowStatus: "Rejected"
      });
    }
  }

  #getVault(vaultName) {
    const vault = this.vaultsByName[vaultName];
    assertCondition(Boolean(vault), "SUBSTRATE_UNKNOWN_VAULT", "unknown vault", { vaultName });
    return vault;
  }
}
