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
import { ControlledSubstrate } from "./substrate.js";
import { MockToken } from "./token.js";
import { MockVault } from "./vault.js";
import { MandateVerifier } from "./verifier.js";
import { RebalanceWorkflow } from "./workflow.js";

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
  const substrate = new ControlledSubstrate({ token, vaultsByName, intentRegistry, envelopeRegistry, receiptStore });
  token.mint(PRINCIPAL, 10_000);
  substrate.depositFromUser(PRINCIPAL, 10_000);
  substrate.setInitialAllocation(initialAllocation);
  const verifier = new MandateVerifier({ intentRegistry, envelopeRegistry, vaultsByName, substrate });
  const workflow = new RebalanceWorkflow({ verifier, clock });

  return {
    clock,
    advanceTime,
    token,
    vaultsByName,
    intentRegistry,
    envelopeRegistry,
    receiptStore,
    substrate,
    verifier,
    workflow,
    intent: acceptedIntent,
    envelope,
    cursor
  };
}

export function runProposal(environment, proposal, { proposer = AGENT, execute = true } = {}) {
  const task = environment.workflow.createTask({
    intentDigest: environment.intent.agentIntentDigest,
    envelopeId: environment.envelope.id,
    agent: environment.intent.terms.agent
  });
  environment.workflow.submitProposal(task.taskId, proposal, proposer);
  const verifiedTask = environment.workflow.verifyProposal(task.taskId);
  const receipt = environment.substrate.executeTask(verifiedTask);
  let finalTask = environment.workflow.getTask(task.taskId);
  if (verifiedTask.verification?.approved && execute) {
    environment.workflow.markExecuted(task.taskId);
    finalTask = environment.workflow.completeTask(task.taskId);
  } else if (finalTask.status === "Rejected") {
    finalTask = environment.workflow.completeTask(task.taskId);
  }
  return {
    task: finalTask,
    receipt
  };
}
