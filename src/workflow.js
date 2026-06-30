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

export class RebalanceWorkflow {
  constructor({ verifier, clock }) {
    this.verifier = verifier;
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

  markExecuted(taskId) {
    const task = this.#getMutableTask(taskId);
    assertCondition(task.status === WorkflowStatus.VERIFIED, "WORKFLOW_EXECUTE_BEFORE_VERIFY", "cannot execute before successful verification");
    assertCondition(!task.resolved, "WORKFLOW_ALREADY_RESOLVED", "resolved proposal cannot be reused");
    task.status = WorkflowStatus.EXECUTED;
    task.resolved = true;
    return clone(task);
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
}
