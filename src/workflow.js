import { VerificationStatus } from "./verifier.js";
import { assertCondition, clone, hashOf } from "./utils.js";

export const WorkflowStatus = Object.freeze({
  TASK_CREATED: "TaskCreated",
  PROPOSAL_SUBMITTED: "ProposalSubmitted",
  VERIFIED: "Verified",
  EXECUTED: "Executed",
  REJECTED: "Rejected",
  COMPLETED: "Completed"
});

export class PortfolioManager {
  constructor({ verifier, executionSubstrate, clock }) {
    this.verifier = verifier;
    this.executionSubstrate = executionSubstrate;
    this.clock = clock;
    this.tasks = new Map();
    this.sequence = 0;
  }

  createTask({ intentDigest, envelopeId, agent }) {
    const taskId = hashOf({
      type: "ERC-8301RebalanceTask",
      sequence: ++this.sequence,
      intentDigest,
      envelopeId,
      agent,
      createdAt: this.clock()
    });
    const task = {
      taskId,
      intentDigest,
      envelopeId,
      agent,
      proposal: null,
      proposalHash: null,
      proposer: null,
      status: WorkflowStatus.TASK_CREATED,
      verificationStatus: VerificationStatus.UNVERIFIED,
      verification: null,
      rejectionReason: null,
      resolved: false,
      createdAt: this.clock(),
      completedAt: null
    };
    this.tasks.set(taskId, task);
    return clone(task);
  }

  submitProposal(taskId, proposal, proposer) {
    const task = this.#getMutableTask(taskId);
    assertCondition(task.status === WorkflowStatus.TASK_CREATED, "WORKFLOW_INVALID_SUBMIT", "proposal can only be submitted for a created task");
    task.proposal = clone(proposal);
    task.proposer = proposer;
    task.proposalHash = hashOf({
      type: "ERC-8301AgentProposal",
      taskId,
      proposal,
      proposer
    });
    task.status = WorkflowStatus.PROPOSAL_SUBMITTED;
    return clone(task);
  }

  verifyProposal(taskId) {
    const task = this.#getMutableTask(taskId);
    assertCondition(
      task.status === WorkflowStatus.PROPOSAL_SUBMITTED,
      "WORKFLOW_INVALID_VERIFY",
      "proposal must be submitted before verification"
    );
    const verification = this.verifier.verify(clone(task));
    task.verification = verification;
    task.verificationStatus = verification.status;
    if (verification.approved) {
      task.status = WorkflowStatus.VERIFIED;
    } else {
      task.status = WorkflowStatus.REJECTED;
      task.rejectionReason = verification.rejectionReason;
      task.resolved = true;
    }
    return clone(task);
  }

  settleTask(taskId) {
    const task = this.#getMutableTask(taskId);
    assertCondition(
      [WorkflowStatus.VERIFIED, WorkflowStatus.REJECTED].includes(task.status),
      "WORKFLOW_SETTLE_BEFORE_VERIFY",
      "task must be verified or rejected before settlement"
    );

    if (task.status === WorkflowStatus.REJECTED) {
      const receipt = this.executionSubstrate.recordRejectedAttempt(
        clone(task),
        this.#executionAuthorization(task, "record-rejection")
      );
      return {
        task: clone(task),
        receipt
      };
    }

    assertCondition(!task.resolved, "WORKFLOW_ALREADY_RESOLVED", "resolved proposal cannot be reused");
    const receipt = this.executionSubstrate.executeVerifiedRebalance(clone(task), this.#executionAuthorization(task, "execute"));
    if (receipt.verificationResult === VerificationStatus.APPROVED) {
      this.#markExecutedFromReceipt(task, receipt);
    } else {
      task.status = WorkflowStatus.REJECTED;
      task.rejectionReason = receipt.rejectionReason;
      task.resolved = true;
    }
    return {
      task: clone(task),
      receipt
    };
  }

  markExecuted(taskId) {
    const task = this.#getMutableTask(taskId);
    assertCondition(task.status === WorkflowStatus.VERIFIED, "WORKFLOW_EXECUTE_BEFORE_VERIFY", "cannot execute before successful verification");
    assertCondition(!task.resolved, "WORKFLOW_ALREADY_RESOLVED", "resolved proposal cannot be reused");
    assertCondition(
      false,
      "WORKFLOW_EXECUTION_REQUIRES_SUBSTRATE",
      "execution must be settled through ExecutionSubstrate"
    );
  }

  #markExecutedFromReceipt(task, receipt) {
    assertCondition(
      receipt?.taskId === task.taskId && receipt?.verificationResult === VerificationStatus.APPROVED,
      "WORKFLOW_MISSING_SUBSTRATE_RECEIPT",
      "PortfolioManager requires an approved ExecutionSubstrate receipt before marking execution"
    );
    task.status = WorkflowStatus.EXECUTED;
    task.resolved = true;
  }

  rejectVerifiedTask(taskId, rejectionReason) {
    const task = this.#getMutableTask(taskId);
    assertCondition(
      [WorkflowStatus.PROPOSAL_SUBMITTED, WorkflowStatus.VERIFIED].includes(task.status),
      "WORKFLOW_INVALID_REJECT",
      "task can only be rejected during proposal or verification handling"
    );
    task.status = WorkflowStatus.REJECTED;
    task.rejectionReason = rejectionReason;
    task.resolved = true;
    return clone(task);
  }

  completeTask(taskId) {
    const task = this.#getMutableTask(taskId);
    assertCondition(
      [WorkflowStatus.EXECUTED, WorkflowStatus.REJECTED].includes(task.status),
      "WORKFLOW_COMPLETE_TOO_EARLY",
      "task can only complete after execution or rejection"
    );
    task.status = WorkflowStatus.COMPLETED;
    task.completedAt = this.clock();
    return clone(task);
  }

  getTask(taskId) {
    return clone(this.#getMutableTask(taskId));
  }

  #getMutableTask(taskId) {
    const task = this.tasks.get(taskId);
    assertCondition(Boolean(task), "WORKFLOW_TASK_NOT_FOUND", "workflow task was not found", { taskId });
    return task;
  }

  #executionAuthorization(task, action) {
    return {
      issuedBy: "PortfolioManager",
      action,
      taskId: task.taskId,
      proposalHash: task.proposalHash,
      status: task.status
    };
  }
}

export const RebalanceWorkflow = PortfolioManager;
