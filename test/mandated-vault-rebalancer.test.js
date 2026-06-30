import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT,
  INITIAL_ALLOCATION,
  PRINCIPAL,
  UNAUTHORIZED_AGENT,
  createDemoEnvironment,
  runProposal
} from "../src/index.js";

test("ERC-8001-shaped intent creation, acceptance, digest, and agreement hash", () => {
  const env = createDemoEnvironment();
  const intent = env.intentRegistry.getIntent(env.intent.agentIntentDigest);

  assert.equal(intent.status, "Ready");
  assert.equal(intent.acceptedBy.length, 2);
  assert.match(intent.agentIntentDigest, /^0x[0-9a-f]{64}$/);
  assert.match(intent.agreementHash, /^0x[0-9a-f]{64}$/);
  assert.equal(intent.terms.principal, PRINCIPAL);
  assert.equal(intent.terms.agent, AGENT);
});

test("ERC-8001-shaped intent rejects downstream use when not accepted", () => {
  const env = createDemoEnvironment();
  const pending = env.intentRegistry.createMandateIntent({
    ...env.intent.terms,
    expiry: env.clock() + 1000
  });

  assert.throws(
    () =>
      env.envelopeRegistry.registerEnvelope({
        agentIntentDigest: pending.agentIntentDigest,
        initialAllocation: INITIAL_ALLOCATION
      }),
    /not accepted/
  );
});

test("ERC-8312-shaped envelope binds intent digest and agreement hash", () => {
  const env = createDemoEnvironment();
  const envelope = env.envelopeRegistry.getEnvelope(env.envelope.id);

  assert.equal(envelope.agentIntentDigest, env.intent.agentIntentDigest);
  assert.equal(envelope.agreementHash, env.intent.agreementHash);
  assert.match(envelope.capabilityRoot, /^0x[0-9a-f]{64}$/);
  assert.equal(env.envelopeRegistry.isActive(env.envelope.id), true);
});

test("ERC-8312-shaped cursor initializes, advances, and keeps root consistency", () => {
  const env = createDemoEnvironment();
  const before = env.envelopeRegistry.readCursor(env.envelope.id);
  const { receipt } = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  const after = env.envelopeRegistry.readCursor(env.envelope.id);

  assert.equal(receipt.verificationResult, "Approved");
  assert.equal(before.cumulativeTurnover, 0);
  assert.equal(after.cumulativeTurnover, 500);
  assert.equal(after.remainingTurnover, 7500);
  assert.equal(after.allocationByVault["Vault D"], 3000);
  assert.equal(env.envelopeRegistry.getEnvelope(env.envelope.id).cursorRoot, after.cursorRoot);
});

test("ERC-8312-shaped cursor rejects insufficient headroom and leaves state unchanged", () => {
  const env = createDemoEnvironment({ initialTurnover: 7700 });
  const beforeCursor = env.envelopeRegistry.readCursor(env.envelope.id);
  const beforeAllocation = env.substrate.getAllocationByVault();

  const { receipt } = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });

  assert.equal(receipt.verificationResult, "Rejected");
  assert.equal(receipt.rejectionReason, "proposed turnover exceeds remaining ERC-8312 cursor headroom");
  assert.deepEqual(env.envelopeRegistry.readCursor(env.envelope.id), beforeCursor);
  assert.deepEqual(env.substrate.getAllocationByVault(), beforeAllocation);
});

test("ERC-8312-shaped envelope expiry and revocation are enforced", () => {
  const env = createDemoEnvironment();
  env.advanceTime(90_000);
  assert.equal(env.envelopeRegistry.isActive(env.envelope.id), false);

  const expired = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  assert.equal(expired.receipt.verificationResult, "Rejected");
  assert.equal(expired.receipt.rejectionReason, "ERC-8312 envelope is expired");

  const fresh = createDemoEnvironment();
  fresh.envelopeRegistry.revoke(fresh.envelope.id);
  const revoked = runProposal(fresh, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  assert.equal(revoked.receipt.rejectionReason, "ERC-8312 envelope is inactive");
});

test("mock token and ERC-4626-style vaults support mint, deposit, withdraw, and APY updates", () => {
  const env = createDemoEnvironment();
  const vaultA = env.vaultsByName["Vault A"];

  assert.equal(env.token.balanceOf(PRINCIPAL), 0);
  assert.equal(vaultA.balanceOf(env.substrate.address), 2500);
  vaultA.withdraw(env.substrate.address, 100);
  assert.equal(vaultA.balanceOf(env.substrate.address), 2400);
  vaultA.deposit(env.substrate.address, 100);
  assert.equal(vaultA.balanceOf(env.substrate.address), 2500);
  vaultA.setApyBps(450);
  assert.equal(vaultA.apyBps, 450);
});

test("controlled substrate executes a valid rebalance and advances cursor", () => {
  const env = createDemoEnvironment();
  const { task, receipt } = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });

  assert.equal(task.status, "Completed");
  assert.equal(receipt.verificationResult, "Approved");
  assert.equal(env.substrate.getAllocationByVault()["Vault A"], 2000);
  assert.equal(env.substrate.getAllocationByVault()["Vault D"], 3000);
  assert.equal(env.envelopeRegistry.readCursor(env.envelope.id).cumulativeTurnover, 500);
});

test("per-vault cap violation is rejected with no movement and no cursor advancement", () => {
  const env = createDemoEnvironment();
  const beforeAllocation = env.substrate.getAllocationByVault();
  const beforeCursor = env.envelopeRegistry.readCursor(env.envelope.id);

  const { receipt } = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 700
  });

  assert.equal(receipt.verificationResult, "Rejected");
  assert.equal(receipt.rejectionReason, "resulting allocation exceeds max per-vault allocation");
  assert.deepEqual(env.substrate.getAllocationByVault(), beforeAllocation);
  assert.deepEqual(env.envelopeRegistry.readCursor(env.envelope.id), beforeCursor);
});

test("Growth plus Experimental risk-bucket cap violation is rejected", () => {
  const env = createDemoEnvironment();
  const { receipt } = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault E",
    amount: 1500
  });

  assert.equal(receipt.verificationResult, "Rejected");
  assert.equal(receipt.rejectionReason, "resulting Growth plus Experimental exposure exceeds mandate cap");
});

test("Experimental-only risk-bucket cap violation is rejected", () => {
  const env = createDemoEnvironment();
  env.vaultsByName["Vault E"].setApyBps(560);
  const { receipt } = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault E",
    amount: 2500
  });

  assert.equal(receipt.verificationResult, "Rejected");
  assert.equal(receipt.rejectionReason, "resulting Experimental exposure exceeds mandate cap");
});

test("insufficient yield improvement is rejected", () => {
  const env = createDemoEnvironment();
  const { receipt } = runProposal(env, {
    sourceVault: "Vault D",
    targetVault: "Vault C",
    amount: 100
  });

  assert.equal(receipt.verificationResult, "Rejected");
  assert.equal(receipt.rejectionReason, "target vault does not improve yield by the minimum threshold");
});

test("unauthorized proposer is rejected", () => {
  const env = createDemoEnvironment();
  const { receipt } = runProposal(
    env,
    {
      sourceVault: "Vault A",
      targetVault: "Vault D",
      amount: 100
    },
    { proposer: UNAUTHORIZED_AGENT }
  );

  assert.equal(receipt.verificationResult, "Rejected");
  assert.equal(receipt.rejectionReason, "proposer is not the accepted agent");
});

test("invalid source and target vaults are rejected", () => {
  const env = createDemoEnvironment();
  const badSource = runProposal(env, {
    sourceVault: "Vault Z",
    targetVault: "Vault D",
    amount: 100
  });
  assert.equal(badSource.receipt.rejectionReason, "source vault is not approved or current");

  const badTarget = runProposal(createDemoEnvironment(), {
    sourceVault: "Vault A",
    targetVault: "Vault Z",
    amount: 100
  });
  assert.equal(badTarget.receipt.rejectionReason, "target vault is not approved");
});

test("ERC-8301-shaped workflow enforces creation, proposal, verification, execution, completion, and rejection ordering", () => {
  const env = createDemoEnvironment();
  const task = env.workflow.createTask({
    intentDigest: env.intent.agentIntentDigest,
    envelopeId: env.envelope.id,
    agent: AGENT
  });

  assert.equal(task.status, "TaskCreated");
  assert.throws(() => env.workflow.markExecuted(task.taskId), /cannot execute before successful verification/);
  assert.throws(() => env.workflow.completeTask(task.taskId), /task can only complete after execution or rejection/);

  env.workflow.submitProposal(
    task.taskId,
    {
      sourceVault: "Vault A",
      targetVault: "Vault D",
      amount: 500
    },
    AGENT
  );
  const verified = env.workflow.verifyProposal(task.taskId);
  assert.equal(verified.status, "Verified");
  env.workflow.markExecuted(task.taskId);
  const completed = env.workflow.completeTask(task.taskId);
  assert.equal(completed.status, "Completed");
  assert.throws(
    () =>
      env.workflow.submitProposal(
        task.taskId,
        {
          sourceVault: "Vault A",
          targetVault: "Vault D",
          amount: 500
        },
        AGENT
      ),
    /proposal can only be submitted/
  );
});

test("resolved rejected proposal cannot be reused", () => {
  const env = createDemoEnvironment();
  const { task } = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 700
  });

  assert.equal(task.status, "Completed");
  assert.throws(() => env.workflow.markExecuted(task.taskId), /cannot execute before successful verification/);
});

test("receipts are created for successful and rejected attempts with before and after state", () => {
  const successEnv = createDemoEnvironment();
  const success = runProposal(successEnv, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });

  assert.equal(successEnv.receiptStore.list().length, 1);
  assert.equal(success.receipt.rejectionReason, null);
  assert.ok(success.receipt.cursorBefore);
  assert.ok(success.receipt.cursorAfter);
  assert.ok(success.receipt.allocationBefore);
  assert.ok(success.receipt.allocationAfter);

  const rejectedEnv = createDemoEnvironment();
  const rejected = runProposal(rejectedEnv, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 700
  });

  assert.equal(rejectedEnv.receiptStore.list().length, 1);
  assert.equal(rejected.receipt.cursorAfter, null);
  assert.equal(rejected.receipt.allocationAfter, null);
  assert.equal(rejected.receipt.rejectionReason, "resulting allocation exceeds max per-vault allocation");
});
