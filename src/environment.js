import {
  AGENT,
  ASSET,
  INITIAL_ALLOCATION,
  MANDATE_LIMITS,
  PRINCIPAL,
  RISK_BUCKETS,
  VAULT_UNIVERSE,
  WORKFLOW_TYPE
} from "./constants.js";
import { EnvelopeRegistry } from "./cursor.js";
import { IntentRegistry } from "./mandate.js";
import { ReceiptStore } from "./receipts.js";
import { ExecutionSubstrate } from "./substrate.js";
import { MockToken } from "./token.js";
import { MockVault } from "./vault.js";
import { MandateVerifier } from "./verifier.js";
import { PortfolioManager } from "./workflow.js";

export function createDemoEnvironment({ initialTurnover = 0, initialAllocation = INITIAL_ALLOCATION, clockStart = 1_800_000_000 } = {}) {
  let currentTime = clockStart;
  const clock = () => currentTime;
  const advanceTime = (seconds) => {
    currentTime += seconds;
    return currentTime;
  };

  const token = new MockToken(ASSET);
  const vaultsByName = Object.fromEntries(
    VAULT_UNIVERSE.map((config) => [config.name, new MockVault({ ...config, token })])
  );
  const vaultMetadataByName = Object.fromEntries(Object.values(vaultsByName).map((vault) => [vault.name, vault.metadata()]));
  const intentRegistry = new IntentRegistry({ clock });
  const terms = {
    principal: PRINCIPAL,
    agent: AGENT,
    asset: ASSET.symbol,
    approvedVaults: VAULT_UNIVERSE.map((vault) => vault.name),
    riskBucketLabels: Object.values(RISK_BUCKETS),
    ...MANDATE_LIMITS,
    expiry: clock() + 86_400,
    workflowType: WORKFLOW_TYPE,
    startingPortfolioValue: 10_000
  };
  const intent = intentRegistry.createMandateIntent(terms);
  const acceptedIntent = intentRegistry.acceptMandate(intent.agentIntentDigest);
  const envelopeRegistry = new EnvelopeRegistry({ intentRegistry, vaultMetadataByName, clock });
  const { envelope, cursor } = envelopeRegistry.registerEnvelope({
    agentIntentDigest: acceptedIntent.agentIntentDigest,
    initialAllocation,
    initialTurnover
  });
  const receiptStore = new ReceiptStore({ clock });
  const executionSubstrate = new ExecutionSubstrate({ token, vaultsByName, intentRegistry, envelopeRegistry, receiptStore });
  token.mint(PRINCIPAL, 10_000);
  executionSubstrate.depositFromUser(PRINCIPAL, 10_000);
  executionSubstrate.setInitialAllocation(initialAllocation);
  const verifier = new MandateVerifier({ intentRegistry, envelopeRegistry, vaultsByName, substrate: executionSubstrate });
  const portfolioManager = new PortfolioManager({ verifier, executionSubstrate, clock });

  return {
    clock,
    advanceTime,
    token,
    vaultsByName,
    intentRegistry,
    envelopeRegistry,
    receiptStore,
    executionSubstrate,
    substrate: executionSubstrate,
    verifier,
    portfolioManager,
    workflow: portfolioManager,
    intent: acceptedIntent,
    envelope,
    cursor
  };
}

export function runProposal(environment, proposal, { proposer = AGENT, execute = true } = {}) {
  const manager = environment.portfolioManager ?? environment.workflow;
  const task = manager.createTask({
    intentDigest: environment.intent.agentIntentDigest,
    envelopeId: environment.envelope.id,
    agent: environment.intent.terms.agent
  });
  manager.submitProposal(task.taskId, proposal, proposer);
  const verifiedTask = manager.verifyProposal(task.taskId);
  let receipt = null;
  let finalTask = manager.getTask(task.taskId);
  if (verifiedTask.verification?.approved && execute) {
    const settled = manager.settleTask(task.taskId);
    receipt = settled.receipt;
    finalTask = manager.completeTask(task.taskId);
  } else if (finalTask.status === "Rejected") {
    const settled = manager.settleTask(task.taskId);
    receipt = settled.receipt;
    finalTask = settled.task;
  }
  return {
    task: finalTask,
    receipt
  };
}
