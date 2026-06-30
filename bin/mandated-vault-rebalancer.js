#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  AGENT,
  bpsToPercent,
  createDemoEnvironment,
  formatAmount,
  runProposal
} from "../src/index.js";

const rawArgs = process.argv.slice(2);
const automatic = rawArgs.includes("--automatic");
const command = rawArgs.find((arg) => !arg.startsWith("--")) ?? "help";
const colorsEnabled = output.isTTY && !process.env.NO_COLOR;
const color = {
  dim: (value) => applyColor(value, 2),
  cyan: (value) => applyColor(value, 36),
  green: (value) => applyColor(value, 32),
  yellow: (value) => applyColor(value, 33),
  red: (value) => applyColor(value, 31),
  bold: (value) => applyColor(value, 1)
};

const scenarios = {
  "demo:happy": runHappyPath,
  "demo:per-vault": runPerVaultBreach,
  "demo:risk": runRiskBreach,
  "demo:turnover": runTurnoverBreach,
  "demo:workflow": runWorkflowViolation,
  "inspect:intent": inspectIntent,
  "inspect:envelope": inspectEnvelope,
  "inspect:cursor": inspectCursor,
  "inspect:portfolio": inspectPortfolio,
  "inspect:receipts": inspectReceipts,
  init: inspectAll,
  "create-mandate": inspectIntent,
  "accept-mandate": inspectIntent,
  "create-envelope": inspectEnvelope,
  deposit: inspectPortfolio,
  "allocate-initial": inspectPortfolio
};

await main();

async function main() {
  printInteractiveModeNote();
  if (command === "demo:all") {
    await runHappyPath();
    await runPerVaultBreach();
    await runRiskBreach();
    await runTurnoverBreach();
    await runWorkflowViolation();
  } else if (scenarios[command]) {
    await scenarios[command]();
  } else {
    printHelp();
  }
}

async function runHappyPath() {
  const env = createDemoEnvironment();
  printHeader("Scenario 1: Happy path 😀");
  printScenarioIntro({
    summary:
      "This scenario demonstrates the complete successful path for a bounded autonomous rebalance. The accepted ERC-8001 mandate authorizes the agent, the ERC-8312 cursor has enough remaining turnover, and the ERC-8301 workflow proceeds in the required order.",
    tests:
      "It tests a 500 mock USDC move from Vault A to Vault D. The target vault is approved, improves yield by more than the 50 bps threshold, reaches but does not exceed the 30% per-vault cap, and keeps risk-bucket exposure within mandate limits.",
    proves:
      "It proves that a valid action can execute only after workflow verification, that the controlled substrate moves funds, that the ERC-8312 cursor advances atomically, and that a success receipt records the transition."
  });
  printArchitectureAnchors(env);
  printPortfolio(env);
  const result = await runGuidedProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  printResult(env, result);
}

async function runPerVaultBreach() {
  const env = createDemoEnvironment();
  printHeader("Scenario 2: Per-vault concentration breach 🚧");
  printScenarioIntro({
    summary:
      "This scenario demonstrates a locally attractive rebalance that fails because it would concentrate too much capital in a single vault.",
    tests:
      "It tests a 700 mock USDC move from Vault A to Vault D. Vault D is approved and has a better APY, but the resulting Vault D allocation would exceed the mandate's 30% per-vault cap.",
    proves:
      "It proves that per-vault allocation bounds are enforced before execution, rejected proposals do not move funds, and rejected proposals do not advance the cursor."
  });
  printArchitectureAnchors(env);
  const result = await runGuidedProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 700
  });
  printResult(env, result);
}

async function runRiskBreach() {
  const env = createDemoEnvironment();
  printHeader("Scenario 3: Risk-bucket breach ⚖️");
  printScenarioIntro({
    summary:
      "This scenario demonstrates that approval of an individual target vault is not enough when aggregate risk exposure would exceed the accepted mandate.",
    tests:
      "It tests a 1,500 mock USDC move from Vault A to Vault E. Vault E is approved and offers higher simulated yield, but the resulting Growth plus Experimental exposure would exceed the 60% cap.",
    proves:
      "It proves that the verifier and substrate enforce portfolio-level risk-bucket limits, not just per-vault checks."
  });
  printArchitectureAnchors(env);
  const result = await runGuidedProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault E",
    amount: 1500
  });
  printResult(env, result);
}

async function runTurnoverBreach() {
  const env = createDemoEnvironment({ initialTurnover: 7700 });
  printHeader("Scenario 4: Cumulative turnover breach ⏳");
  printScenarioIntro({
    summary:
      "This is the central ERC-8312 demonstration. The proposed rebalance looks valid under local vault, yield, and risk checks, but the live cursor shows that most aggregate turnover authority has already been consumed.",
    tests:
      "It starts with 7,700 of 8,000 mock USDC cumulative turnover already used, leaving only 300 mock USDC of headroom. The agent then proposes a 500 mock USDC move from Vault A to Vault D.",
    proves:
      "It proves that ERC-8312-style cursor metering catches cumulative mandate exhaustion across actions. The action is rejected, funds do not move, and the cursor root stays unchanged."
  });
  printArchitectureAnchors(env);
  const result = await runGuidedProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  printResult(env, result);
}

async function runWorkflowViolation() {
  const env = createDemoEnvironment();
  printHeader("Scenario 5: Workflow step violation 🛑");
  printScenarioIntro({
    summary:
      "This scenario demonstrates that the ERC-8301-shaped workflow is not just logging state after the fact. It actively prevents step skipping.",
    tests:
      "It creates a task and then attempts to mark execution before any proposal has been submitted or verified.",
    proves:
      "It proves that execution cannot bypass workflow ordering. The substrate is never invoked, no funds move, and the cursor remains unchanged."
  });
  printArchitectureAnchors(env);
  printCursorDetailsPanel(env, "ERC-8312 cursor before workflow");
  const task = await guidedStep({
    number: 1,
    title: "Create ERC-8301 task",
    layer: "ERC-8301 workflow",
    intent:
      "The workflow will create a new rebalance task and bind it to the already accepted mandate and active bounded-action envelope. This establishes the ordered execution context before any agent proposal can be considered.",
    action: () =>
      env.workflow.createTask({
        intentDigest: env.intent.agentIntentDigest,
        envelopeId: env.envelope.id,
        agent: AGENT
      }),
    after: (createdTask) => {
      printOutputTable([
        outputDetail("taskId", createdTask.taskId, "Workflow task created for this scenario."),
        outputDetail("status", createdTask.status, "Initial ERC-8301 workflow status.")
      ]);
    }
  });
  await guidedStep({
    number: 2,
    title: "Attempt execution before verification",
    layer: "ERC-8301 workflow",
    intent:
      "The demo will deliberately call the execution transition too early. A correct ERC-8301-shaped workflow must reject this because no proposal has been submitted, no verifier has approved it, and no substrate action is authorized.",
    action: () => {
      try {
        env.workflow.markExecuted(task.taskId);
        return { rejected: false, reason: null };
      } catch (error) {
        return { rejected: true, reason: error.message };
      }
    },
    after: (result) => {
      printOutputTable([
        outputDetail("layer", "ERC-8301 workflow", "Layer that rejected the invalid transition."),
        outputDetail("actionResult", result.rejected ? "rejected" : "accepted", "Whether the premature execution was allowed."),
        outputDetail("rejectionReason", result.reason ?? "none", "Workflow ordering failure returned by the state machine.")
      ]);
    }
  });
  printCursor(env);
  printPortfolio(env);
}

function inspectAll() {
  const env = createDemoEnvironment();
  printHeader("Initialized local mandated-vault-rebalancer environment");
  printArchitectureAnchors(env);
  printIntent(env);
  printEnvelope(env);
  printCursor(env);
  printPortfolio(env);
}

function inspectIntent() {
  const env = createDemoEnvironment();
  printHeader("ERC-8001-shaped accepted mandate");
  printIntent(env);
}

function inspectEnvelope() {
  const env = createDemoEnvironment();
  printHeader("ERC-8312-shaped envelope");
  printEnvelope(env);
}

function inspectCursor() {
  const env = createDemoEnvironment();
  printHeader("ERC-8312 cursor");
  printCursor(env);
}

function inspectPortfolio() {
  const env = createDemoEnvironment();
  printHeader("Controlled substrate portfolio");
  printPortfolio(env);
}

function inspectReceipts() {
  const env = createDemoEnvironment();
  runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  printHeader("Receipts");
  printReceipts(env);
}

async function runGuidedProposal(env, proposal, { proposer = AGENT } = {}) {
  printCursorDetailsPanel(env, "ERC-8312 cursor before workflow");
  let task;
  await guidedStep({
    number: 1,
    title: "Create task",
    layer: "ERC-8301 workflow",
    intent:
      "The workflow opens a new task for this rebalance attempt. The task records which accepted ERC-8001 mandate and which ERC-8312 envelope the agent must operate under, so later steps cannot float free of the authority and cursor state.",
    details: [
      inputDetail("intentDigest", env.intent.agentIntentDigest, "ERC-8001 authority anchor for this accepted mandate."),
      inputDetail("envelopeId", env.envelope.id, "ERC-8312 envelope that meters the mandate."),
      inputDetail("agent", env.intent.terms.agent, "Accepted agent allowed to propose the rebalance.")
    ],
    action: () => {
      task = env.workflow.createTask({
        intentDigest: env.intent.agentIntentDigest,
        envelopeId: env.envelope.id,
        agent: env.intent.terms.agent
      });
      return task;
    },
    after: (createdTask) => {
      printOutputTable([
        outputDetail("taskId", createdTask.taskId, "Workflow task created for this rebalance attempt."),
        outputDetail("status", createdTask.status, "Initial ERC-8301 workflow status.")
      ]);
    }
  });

  await guidedStep({
    number: 2,
    title: "Submit agent proposal",
    layer: "ERC-8301 workflow",
    intent:
      "The agent submits the concrete rebalance it wants to perform: source vault, target vault, amount, and proposer identity. This records intent to act, but it still does not authorize movement of funds.",
    details: [
      inputDetail("sourceVault", proposal.sourceVault, "Vault the agent wants to withdraw from."),
      inputDetail("targetVault", proposal.targetVault, "Vault the agent wants to deposit into."),
      inputDetail("amount", formatAmount(proposal.amount), "Turnover this proposal would consume."),
      inputDetail("proposer", proposer, "Address submitting the proposal.")
    ],
    action: () => {
      task = env.workflow.submitProposal(task.taskId, proposal, proposer);
      return task;
    },
    after: (submittedTask) => {
      printOutputTable([
        outputDetail("proposalHash", submittedTask.proposalHash, "Commitment to the submitted proposal."),
        outputDetail("status", submittedTask.status, "Workflow status after proposal submission.")
      ]);
    }
  });

  await guidedStep({
    number: 3,
    title: "Verify mandate and cursor",
    layer: "Verifier + ERC-8312 cursor",
    intent:
      "The deterministic verifier reads the accepted mandate, the live envelope, the current substrate allocation, vault metadata, and the cursor headroom. It checks authorization, yield improvement, vault approval, allocation caps, risk-bucket caps, and cumulative turnover before the substrate can execute anything.",
    details: [
      inputDetail("currentCursorRoot", env.envelopeRegistry.readCursor(env.envelope.id).cursorRoot, "Live cursor commitment before verification."),
      inputDetail("remainingTurnover", formatAmount(env.envelopeRegistry.readCursor(env.envelope.id).remainingTurnover), "Unused aggregate turnover headroom.")
    ],
    action: () => {
      task = env.workflow.verifyProposal(task.taskId);
      return task;
    },
    after: (verifiedTask) => {
      const outputs = [
        outputDetail("verificationStatus", verifiedTask.verificationStatus, "Deterministic verifier result."),
        outputDetail("workflowStatus", verifiedTask.status, "Workflow state after verification."),
        outputDetail("rejectionReason", verifiedTask.rejectionReason ?? "none", "Reason returned if verification rejected.")
      ];
      if (verifiedTask.verification?.approved) {
        outputs.push(
          outputDetail("yieldImprovement", `${verifiedTask.verification.yieldImprovementBps} bps`, "Yield improvement over the source vault."),
          outputDetail("turnoverDelta", formatAmount(verifiedTask.verification.turnoverDelta), "Turnover that will be charged to the cursor.")
        );
      }
      printOutputTable(outputs);
    }
  });

  let receipt;
  await guidedStep({
    number: 4,
    title: task.verification?.approved ? "Execute and advance cursor" : "Record rejection receipt",
    layer: "Controlled substrate",
    intent: task.verification?.approved
      ? "The substrate will withdraw from the source vault, deposit into the target vault, and advance the ERC-8312 cursor in the same execution path. If cursor advancement failed, the local simulation would roll back the fund movement."
      : "Because verification rejected the proposal, the substrate will not withdraw or deposit funds. It will record a rejection receipt showing the failed check and leave the allocation and cursor root unchanged.",
    details: [
      inputDetail("allocationBefore", compactAllocation(env.substrate.getAllocationByVault()), "Portfolio state before substrate action."),
      inputDetail("cursorRootBefore", env.envelopeRegistry.readCursor(env.envelope.id).cursorRoot, "Cursor commitment that execution must advance from.")
    ],
    action: () => {
      receipt = env.substrate.executeTask(task);
      return receipt;
    },
    after: (storedReceipt) => {
      printOutputTable([
        outputDetail("result", storedReceipt.verificationResult, "Execution or rejection result recorded in the receipt."),
        outputDetail("receiptHash", storedReceipt.receiptHash, "Receipt identifier for this attempt."),
        outputDetail("rejectionReason", storedReceipt.rejectionReason ?? "none", "Reason recorded when execution was rejected."),
        outputDetail("cursorAdvanced", storedReceipt.cursorAfter ? "yes" : "no", "Whether ERC-8312 cursor state changed.")
      ]);
      printCursorDelta(storedReceipt);
    }
  });

  await guidedStep({
    number: 5,
    title: "Resolve workflow task",
    layer: "ERC-8301 workflow",
    intent:
      "The workflow finalizes the task after there is evidence of either execution or rejection. This prevents the same proposal from being reused and gives the attempt a clear terminal status.",
    action: () => {
      if (task.verification?.approved) {
        task = env.workflow.markExecuted(task.taskId);
      }
      task = env.workflow.completeTask(task.taskId);
      return task;
    },
    after: (finalTask) => {
      printOutputTable([
        outputDetail("finalStatus", finalTask.status, "Terminal workflow status for this task."),
        outputDetail("verificationStatus", finalTask.verificationStatus, "Verifier result retained on the completed task."),
        outputDetail("completedAt", finalTask.completedAt, "Demo timestamp when the task completed.")
      ]);
    }
  });

  return { task, receipt };
}

async function guidedStep({ number, title, layer, intent, details = [], action, after }) {
  printStep(number, title, layer, intent);
  await waitForConfirmation();
  printStepDetails(details);
  const result = action();
  after?.(result);
  return result;
}

function printStep(number, title, layer, intent) {
  console.log("");
  console.log(color.cyan(`-- Step ${number}: ${title} --`));
  console.log("");
  console.log(`Layer: ${color.bold(layer)}`);
  console.log("");
  console.log(`What happens: ${intent}`);
}

function printStepDetails(details) {
  if (details.length > 0) {
    printInputTable(details);
  }
}

async function waitForConfirmation() {
  if (automatic) {
    console.log(color.dim("Automatic mode: continuing without prompt."));
    return;
  }
  if (!input.isTTY) {
    console.error("Interactive confirmation requires a terminal. Re-run with --automatic for non-interactive execution.");
    process.exit(1);
  }
  const readline = createInterface({ input, output });
  const answer = await readline.question("Press Enter to continue, or type n to stop: ");
  readline.close();
  if (answer.trim().toLowerCase() === "n") {
    console.log("Stopped before executing this step.");
    process.exit(0);
  }
}

function printHeader(title) {
  console.log("");
  console.log(color.bold("=".repeat(72)));
  console.log(color.bold(title));
  console.log(color.bold("=".repeat(72)));
}

function printInteractiveModeNote() {
  if (!automatic && isDemoCommand(command)) {
    console.log("⚠️  Note: interactive mode - run `npm run demo:happy -- --automatic` to avoid prompts");
  }
}

function printScenarioIntro({ summary, tests, proves }) {
  console.log("");
  console.log(color.bold("Scenario overview"));
  console.log(`  What this is: ${summary}`);
  console.log(`  What it tests: ${tests}`);
  console.log(`  What it proves: ${proves}`);
  console.log("");
}

function printArchitectureAnchors(env) {
  console.log("ERC-8001 records authority");
  console.log(`  _agentIntentDigest: ${env.intent.agentIntentDigest}`);
  console.log(`  agreementHash:      ${env.intent.agreementHash}`);
  console.log("ERC-8312 meters authority through a live cursor");
  console.log(`  envelopeId:         ${env.envelope.id}`);
  console.log(`  capabilityRoot:     ${env.envelope.capabilityRoot}`);
  console.log(`  cursorRoot:         ${env.envelopeRegistry.readCursor(env.envelope.id).cursorRoot}`);
}

function printIntent(env) {
  const intent = env.intentRegistry.getIntent(env.intent.agentIntentDigest);
  console.log(`Status: ${intent.status}`);
  console.log(`Principal: ${intent.terms.principal}`);
  console.log(`Agent: ${intent.terms.agent}`);
  console.log(`Asset: ${intent.terms.asset}`);
  console.log(`Workflow type: ${intent.terms.workflowType}`);
  console.log(`_agentIntentDigest: ${intent.agentIntentDigest}`);
  console.log(`agreementHash: ${intent.agreementHash}`);
  console.log(`Approved vaults: ${intent.terms.approvedVaults.join(", ")}`);
  console.log(`Max per vault: ${bpsToPercent(intent.terms.maxAllocationPerVaultBps)}`);
  console.log(`Max Growth + Experimental: ${bpsToPercent(intent.terms.maxGrowthPlusExperimentalBps)}`);
  console.log(`Max Experimental: ${bpsToPercent(intent.terms.maxExperimentalBps)}`);
  console.log(`Min yield improvement: ${intent.terms.minYieldImprovementBps} bps`);
  console.log(`Max cumulative turnover: ${formatAmount(intent.terms.maxCumulativeTurnover)}`);
}

function printEnvelope(env) {
  const envelope = env.envelopeRegistry.getEnvelope(env.envelope.id);
  console.log(`Envelope ID: ${envelope.id}`);
  console.log(`Status: ${envelope.status}`);
  console.log(`Principal: ${envelope.principal}`);
  console.log(`Capability root: ${envelope.capabilityRoot}`);
  console.log(`Cursor root: ${envelope.cursorRoot}`);
  console.log(`Binds intent digest: ${envelope.agentIntentDigest}`);
  console.log(`Binds agreement hash: ${envelope.agreementHash}`);
}

function printCursor(env) {
  const cursor = env.envelopeRegistry.readCursor(env.envelope.id);
  console.log("");
  console.log("Cursor state:");
  console.log(`  status: ${cursor.status}`);
  console.log(`  cursorRoot: ${cursor.cursorRoot}`);
  console.log(`  cumulativeTurnover: ${formatAmount(cursor.cumulativeTurnover)} / ${formatAmount(cursor.maxCumulativeTurnover)}`);
  console.log(`  remainingTurnover: ${formatAmount(cursor.remainingTurnover)}`);
  console.log(`  lastRebalanceSequence: ${cursor.lastRebalanceSequence}`);
  console.log("  allocationByVault:");
  for (const [vault, amount] of Object.entries(cursor.allocationByVault)) {
    console.log(`    ${vault}: ${formatAmount(amount)}`);
  }
  console.log("  allocationByRiskBucket:");
  for (const [bucket, amount] of Object.entries(cursor.allocationByRiskBucket)) {
    console.log(`    ${bucket}: ${formatAmount(amount)}`);
  }
}

function printCursorDetailsPanel(env, title) {
  const cursor = env.envelopeRegistry.readCursor(env.envelope.id);
  console.log("");
  console.log(color.bold(title));
  console.log("");
  printDetailTable([
    inputDetail("status", cursor.status, "Lifecycle status exposed by the cursor."),
    inputDetail("isActive", cursor.isActive ? "yes" : "no", "Whether the bound envelope is active and unexpired."),
    inputDetail("cursorRoot", cursor.cursorRoot, "Commitment to the current cursor state."),
    inputDetail("portfolioValue", formatAmount(cursor.portfolioValue), "Total mock USDC tracked by the cursor."),
    inputDetail("cumulativeTurnover", `${formatAmount(cursor.cumulativeTurnover)} / ${formatAmount(cursor.maxCumulativeTurnover)}`, "Aggregate turnover consumed under the mandate."),
    inputDetail("remainingTurnover", formatAmount(cursor.remainingTurnover), "Turnover headroom still available to the agent."),
    inputDetail("lastRebalanceSequence", cursor.lastRebalanceSequence, "Ordering marker for successful cursor advances."),
    inputDetail("expiresAt", cursor.expiresAt, "Expiry inherited from the accepted mandate.")
  ]);

  console.log("");
  console.log(color.bold("Cursor allocation by vault"));
  console.log("");
  printDetailTable(
    Object.entries(cursor.allocationByVault).map(([vault, amount]) =>
      inputDetail(vault, formatAmount(amount), "Current allocation committed by the cursor.")
    )
  );

  console.log("");
  console.log(color.bold("Cursor risk exposure"));
  console.log("");
  printDetailTable(
    Object.entries(cursor.allocationByRiskBucket).map(([bucket, amount]) =>
      inputDetail(bucket, formatAmount(amount), "Current risk-bucket exposure committed by the cursor.")
    )
  );
  console.log("");
}

function printCursorDelta(receipt) {
  const before = receipt.cursorBefore;
  const after = receipt.cursorAfter ?? receipt.cursorBefore;
  const advanced = Boolean(receipt.cursorAfter);
  console.log("");
  console.log(color.bold("ERC-8312 cursor delta"));
  console.log("");
  printDetailTable([
    inputDetail("cursorRootBefore", before.cursorRoot, "Cursor commitment before substrate handling."),
    inputDetail("cursorRootAfter", advanced ? after.cursorRoot : `${after.cursorRoot} (unchanged)`, "Cursor commitment after substrate handling."),
    inputDetail("turnoverBefore", formatAmount(before.cumulativeTurnover), "Cumulative turnover before this attempt."),
    inputDetail("turnoverAfter", advanced ? formatAmount(after.cumulativeTurnover) : `${formatAmount(after.cumulativeTurnover)} (unchanged)`, "Cumulative turnover after this attempt."),
    inputDetail("remainingBefore", formatAmount(before.remainingTurnover), "Remaining turnover before this attempt."),
    inputDetail("remainingAfter", advanced ? formatAmount(after.remainingTurnover) : `${formatAmount(after.remainingTurnover)} (unchanged)`, "Remaining turnover after this attempt."),
    inputDetail("sequenceBefore", before.lastRebalanceSequence, "Cursor sequence before this attempt."),
    inputDetail("sequenceAfter", advanced ? after.lastRebalanceSequence : `${after.lastRebalanceSequence} (unchanged)`, "Cursor sequence after this attempt."),
    inputDetail("advanced", advanced ? "yes" : "no", "Whether the ERC-8312 registry accepted a cursor advance.")
  ]);
  console.log("");
}

function printPortfolio(env) {
  console.log("");
  console.log("Portfolio held by controlled substrate:");
  for (const [vaultName, amount] of Object.entries(env.substrate.getAllocationByVault())) {
    const vault = env.vaultsByName[vaultName];
    console.log(`  ${vaultName} (${vault.riskBucket}, ${bpsToPercent(vault.apyBps)} APY): ${formatAmount(amount)}`);
  }
}

function printResult(env, { task, receipt }) {
  console.log("");
  console.log(color.bold("Final result:"));
  console.log("");
  console.log("ERC-8301 workflow:");
  printPlainKeyValue("taskId", task.taskId);
  printPlainKeyValue("status", task.status);
  printPlainKeyValue("verificationStatus", task.verificationStatus);
  printPlainKeyValue("rejectionReason", task.rejectionReason ?? "none");
  console.log("");
  console.log("Action result:");
  printPlainKeyValue("verification", receipt.verificationResult);
  printPlainKeyValue("receiptHash", receipt.receiptHash);
  printPlainKeyValue("rejectionReason", receipt.rejectionReason ?? "none");
  printCursor(env);
  printPortfolio(env);
}

function printReceipts(env) {
  for (const receipt of env.receiptStore.list()) {
    console.log(`Receipt ${receipt.receiptHash}`);
    console.log(`  taskId: ${receipt.taskId}`);
    console.log(`  result: ${receipt.verificationResult}`);
    console.log(`  reason: ${receipt.rejectionReason ?? "none"}`);
    console.log(`  amount: ${formatAmount(receipt.amount)}`);
  }
}

function printHelp() {
  console.log(`mandated-vault-rebalancer

Usage:
  node bin/mandated-vault-rebalancer.js <command> [--automatic]

Commands:
  init                  initialize and inspect the local demo environment
  create-mandate        show the ERC-8001-shaped mandate and hashes
  accept-mandate        show the accepted mandate state
  create-envelope       show the ERC-8312 envelope bound to the mandate
  deposit               show the controlled substrate after mock USDC deposit
  allocate-initial      show initial vault allocation
  inspect:intent        inspect accepted intent
  inspect:envelope      inspect envelope
  inspect:cursor        inspect cursor
  inspect:portfolio     inspect portfolio
  inspect:receipts      run one attempt and inspect receipts
  demo:happy            valid rebalance
  demo:per-vault        per-vault cap rejection
  demo:risk             risk-bucket cap rejection
  demo:turnover         cumulative turnover cursor rejection
  demo:workflow         ERC-8301 step-order rejection
  demo:all              run all scenarios

Options:
  --automatic           run demo commands without confirmation prompts
`);
}

function compactAllocation(allocationByVault) {
  return Object.entries(allocationByVault)
    .map(([vault, amount]) => `${vault}=${amount}`)
    .join(", ");
}

function inputDetail(key, value, description) {
  return {
    key,
    value,
    description
  };
}

function printInputTable(details) {
  console.log("");
  console.log("Inputs:");
  console.log("");
  printDetailTable(details);
  console.log("");
}

function printKeyValue(key, value) {
  console.log(`  ${color.cyan(key)}: ${colorizeValue(value)}`);
}

function printPlainKeyValue(key, value) {
  console.log(`  ${key}: ${value}`);
}

function outputDetail(key, value, description) {
  return inputDetail(key, value, description);
}

function printOutputTable(details) {
  console.log("");
  console.log("Outputs:");
  console.log("");
  printDetailTable(details);
  console.log("");
}

function printDetailTable(details) {
  const normalized = details.map((detail) =>
    Array.isArray(detail) ? inputDetail(detail[0], detail[1], detail[2] ?? "") : detail
  );
  const keyWidth = Math.max(20, "Key".length, ...normalized.map((detail) => String(detail.key).length));
  const valueWidth = Math.max(80, "Value".length, ...normalized.map((detail) => String(detail.value).length));
  const separator = `  ${"-".repeat(keyWidth)}  ${"-".repeat(valueWidth)}  ${"-".repeat(36)}`;

  console.log(`  ${color.bold(pad("Key", keyWidth))}  ${color.bold(pad("Value", valueWidth))}  ${color.bold("Description")}`);
  console.log(color.dim(separator));
  for (const detail of normalized) {
    const value = String(detail.value);
    console.log(
      `  ${color.cyan(pad(detail.key, keyWidth))}  ${colorizeTableValue(pad(value, valueWidth))}  ${detail.description}`
    );
  }
}

function isDemoCommand(value) {
  return value === "demo:all" || value.startsWith("demo:");
}

function pad(value, width) {
  return String(value).padEnd(width, " ");
}

function colorizeValue(value) {
  const stringValue = String(value);
  if (stringValue.includes("\u001b[")) {
    return stringValue;
  }
  return color.yellow(stringValue);
}

function colorizeTableValue(value) {
  const trimmed = String(value).trim().toLowerCase();
  if (["approved", "accepted", "yes"].includes(trimmed)) {
    return color.green(value);
  }
  if (["rejected", "no"].includes(trimmed)) {
    return color.red(value);
  }
  return color.yellow(value);
}

function formatStatus(status) {
  if (status === "Approved") {
    return color.green(status);
  }
  if (status === "Rejected") {
    return color.red(status);
  }
  return color.yellow(status);
}

function applyColor(value, code) {
  if (!colorsEnabled) {
    return value;
  }
  return `\u001b[${code}m${value}\u001b[0m`;
}
