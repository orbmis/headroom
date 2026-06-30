#!/usr/bin/env node
import {
  AGENT,
  INITIAL_ALLOCATION,
  UNAUTHORIZED_AGENT,
  bpsToPercent,
  createDemoEnvironment,
  formatAmount,
  runProposal
} from "../src/index.js";

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

const command = process.argv[2] ?? "help";

if (command === "demo:all") {
  runHappyPath();
  runPerVaultBreach();
  runRiskBreach();
  runTurnoverBreach();
  runWorkflowViolation();
} else if (scenarios[command]) {
  scenarios[command]();
} else {
  printHelp();
}

function runHappyPath() {
  const env = createDemoEnvironment();
  printHeader("Scenario 1: Happy path");
  printArchitectureAnchors(env);
  printPortfolio(env);
  const result = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  printResult(env, result);
}

function runPerVaultBreach() {
  const env = createDemoEnvironment();
  printHeader("Scenario 2: Per-vault concentration breach");
  printArchitectureAnchors(env);
  const result = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 700
  });
  printResult(env, result);
}

function runRiskBreach() {
  const env = createDemoEnvironment();
  printHeader("Scenario 3: Risk-bucket breach");
  printArchitectureAnchors(env);
  const result = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault E",
    amount: 1500
  });
  printResult(env, result);
}

function runTurnoverBreach() {
  const env = createDemoEnvironment({ initialTurnover: 7700 });
  printHeader("Scenario 4: Cumulative turnover breach");
  printArchitectureAnchors(env);
  printCursor(env);
  const result = runProposal(env, {
    sourceVault: "Vault A",
    targetVault: "Vault D",
    amount: 500
  });
  printResult(env, result);
}

function runWorkflowViolation() {
  const env = createDemoEnvironment();
  printHeader("Scenario 5: Workflow step violation");
  printArchitectureAnchors(env);
  const task = env.workflow.createTask({
    intentDigest: env.intent.agentIntentDigest,
    envelopeId: env.envelope.id,
    agent: AGENT
  });
  try {
    env.workflow.markExecuted(task.taskId);
  } catch (error) {
    console.log("Layer: ERC-8301 workflow");
    console.log(`Action result: rejected`);
    console.log(`Rejection reason: ${error.message}`);
  }
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

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
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

function printPortfolio(env) {
  console.log("Portfolio held by controlled substrate:");
  for (const [vaultName, amount] of Object.entries(env.substrate.getAllocationByVault())) {
    const vault = env.vaultsByName[vaultName];
    console.log(`  ${vaultName} (${vault.riskBucket}, ${bpsToPercent(vault.apyBps)} APY): ${formatAmount(amount)}`);
  }
}

function printResult(env, { task, receipt }) {
  console.log("ERC-8301 workflow:");
  console.log(`  taskId: ${task.taskId}`);
  console.log(`  status: ${task.status}`);
  console.log(`  verificationStatus: ${task.verificationStatus}`);
  console.log(`  rejectionReason: ${task.rejectionReason ?? "none"}`);
  console.log("Action result:");
  console.log(`  verification: ${receipt.verificationResult}`);
  console.log(`  receiptHash: ${receipt.receiptHash}`);
  console.log(`  rejectionReason: ${receipt.rejectionReason ?? "none"}`);
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
`);
}
