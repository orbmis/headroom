import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { AGENT } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(__dirname);
const defaultRpcUrl = "http://127.0.0.1:8545";

export async function createEvmDemoEnvironment({ network = process.env.HEADROOM_NETWORK ?? "localhost" } = {}) {
  const deploymentPath = join(rootDir, "deployments", `${network}.json`);
  if (!existsSync(deploymentPath)) {
    return null;
  }
  const deployment = JSON.parse(await readFile(deploymentPath, "utf8"));
  const provider = new ethers.JsonRpcProvider(process.env.HEADROOM_RPC_URL ?? defaultRpcUrl, 31337, { staticNetwork: true });
  try {
    await provider.getBlockNumber();
  } catch {
    provider.destroy();
    return null;
  }
  const artifacts = await loadArtifacts();
  const principalSigner = await provider.getSigner(deployment.principal);
  const agentSigner = await provider.getSigner(deployment.agent);
  const contracts = {
    token: contract(deployment.contracts.token, artifacts.MockUSDC, principalSigner),
    intentRegistry: contract(deployment.contracts.intentRegistry, artifacts.IntentRegistry, principalSigner),
    envelopeRegistry: contract(deployment.contracts.envelopeRegistry, artifacts.EnvelopeRegistry, principalSigner),
    executionSubstrate: contract(deployment.contracts.executionSubstrate, artifacts.ExecutionSubstrate, principalSigner),
    portfolioManager: contract(deployment.contracts.portfolioManager, artifacts.PortfolioManager, principalSigner)
  };
  const vaultsByName = Object.fromEntries(
    deployment.vaults.map((vault) => [
      vault.name,
      {
        ...vault,
        contract: contract(vault.address, artifacts.MockVault4626, principalSigner)
      }
    ])
  );
  const env = {
    mode: "evm",
    deployment,
    provider,
    principalSigner,
    agentSigner,
    contracts,
    vaultsByName,
    intent: {
      agentIntentDigest: deployment.agentIntentDigest,
      agreementHash: deployment.agreementHash,
      terms: {
        agent: deployment.agent
      }
    },
    envelope: {
      id: deployment.envelopeId,
      capabilityRoot: null
    }
  };
  const envelope = await contracts.envelopeRegistry.getEnvelope(deployment.envelopeId);
  env.envelope.capabilityRoot = envelope.capabilityRoot;
  return env;
}

export async function loadEvmScenarioState(env) {
  const cursor = await readEvmCursor(env);
  const allocation = await readEvmAllocation(env);
  return {
    cursor,
    allocation
  };
}

export async function readEvmCursor(env) {
  const summary = await env.contracts.envelopeRegistry.cursorSummary(env.envelope.id);
  const allocationByVault = {};
  summary.vaults.forEach((vaultAddress, index) => {
    allocationByVault[vaultNameByAddress(env, vaultAddress)] = Number(summary.vaultAllocations[index]);
  });
  const allocationByRiskBucket = {};
  summary.riskBuckets.forEach((bucket, index) => {
    allocationByRiskBucket[bucketName(bucket)] = Number(summary.riskAllocations[index]);
  });
  return {
    status: summary.active ? "Active" : "Inactive",
    isActive: summary.active,
    cursorRoot: summary.cursorRoot,
    portfolioValue: Number(summary.portfolioValue),
    allocationByVault,
    allocationByRiskBucket,
    cumulativeTurnover: Number(summary.cumulativeTurnover),
    maxCumulativeTurnover: Number(summary.maxCumulativeTurnover),
    remainingTurnover: Number(summary.remainingTurnover),
    lastRebalanceSequence: Number(summary.lastRebalanceSequence),
    expiresAt: Number((await env.contracts.envelopeRegistry.getEnvelope(env.envelope.id)).expiry)
  };
}

export async function readEvmAllocation(env) {
  const result = {};
  for (const vault of env.deployment.vaults) {
    result[vault.name] = Number(await env.vaultsByName[vault.name].contract.balanceOf(env.deployment.contracts.executionSubstrate));
  }
  return result;
}

export async function createEvmTask(env, reporter) {
  const manager = env.contracts.portfolioManager.connect(env.principalSigner);
  const receipt = await sendAndReport(
    reporter,
    "PortfolioManager.createTask",
    manager.createTask(env.intent.agentIntentDigest, env.envelope.id, env.deployment.agent)
  );
  const taskId = eventArg(env.contracts.portfolioManager, receipt, "TaskCreated", "taskId");
  return normalizeTask(await manager.getTask(taskId));
}

export async function submitEvmProposal(env, taskId, proposal, reporter) {
  const manager = env.contracts.portfolioManager.connect(env.agentSigner);
  const sourceVault = env.vaultsByName[proposal.sourceVault].address;
  const targetVault = env.vaultsByName[proposal.targetVault].address;
  await sendAndReport(reporter, "PortfolioManager.submitProposal", manager.submitProposal(taskId, sourceVault, targetVault, proposal.amount));
  return normalizeTask(await env.contracts.portfolioManager.getTask(taskId), env);
}

export async function verifyEvmProposal(env, taskId, reporter) {
  const manager = env.contracts.portfolioManager.connect(env.principalSigner);
  let preflightRevertReason = null;
  try {
    await manager.verifyProposal.staticCall(taskId);
  } catch (error) {
    preflightRevertReason = cleanRevertReason(error);
  }
  const receipt = await sendAndReport(reporter, "PortfolioManager.verifyProposal", manager.verifyProposal(taskId, { gasLimit: 1_000_000n }), {
    allowRevert: true
  });
  if (receipt.status === 0) {
    const task = normalizeTask(await env.contracts.portfolioManager.getTask(taskId), env);
    return {
      ...task,
      status: "Rejected",
      verificationStatus: "Rejected",
      rejectionReason: preflightRevertReason ?? receipt.revertReason ?? "transaction reverted"
    };
  }
  return normalizeTask(await env.contracts.portfolioManager.getTask(taskId), env);
}

export async function executeEvmTask(env, taskId, reporter) {
  const before = await loadEvmScenarioState(env);
  const manager = env.contracts.portfolioManager.connect(env.principalSigner);
  const receipt = await sendAndReport(reporter, "PortfolioManager.executeTask", manager.executeTask(taskId, { gasLimit: 1_000_000n }), {
    allowRevert: true
  });
  const after = await loadEvmScenarioState(env);
  const task = normalizeTask(await env.contracts.portfolioManager.getTask(taskId), env);
  return {
    task,
    receipt: {
      taskId,
      intentDigest: env.intent.agentIntentDigest,
      agreementHash: env.intent.agreementHash,
      envelopeId: env.envelope.id,
      sourceVault: task.proposal?.sourceVault ?? null,
      targetVault: task.proposal?.targetVault ?? null,
      amount: task.proposal?.amount ?? null,
      verificationResult: receipt.status === 1 ? "Approved" : "Rejected",
      rejectionReason: receipt.status === 1 ? null : receipt.revertReason ?? "transaction reverted",
      cursorBefore: before.cursor,
      cursorAfter: receipt.status === 1 ? after.cursor : null,
      allocationBefore: before.allocation,
      allocationAfter: receipt.status === 1 ? after.allocation : null,
      workflowStatus: task.status,
      receiptHash: receipt.hash
    }
  };
}

export async function setEvmTurnoverForDemo(env, cumulativeTurnover, reporter) {
  await sendAndReport(
    reporter,
    "EnvelopeRegistry.setCumulativeTurnoverForDemo",
    env.contracts.envelopeRegistry.setCumulativeTurnoverForDemo(env.envelope.id, cumulativeTurnover)
  );
}

export function evmProposalFor(env, proposal) {
  return {
    ...proposal,
    sourceVaultAddress: env.vaultsByName[proposal.sourceVault]?.address,
    targetVaultAddress: env.vaultsByName[proposal.targetVault]?.address
  };
}

async function loadArtifacts() {
  const names = ["MockUSDC", "MockVault4626", "IntentRegistry", "EnvelopeRegistry", "ExecutionSubstrate", "PortfolioManager"];
  const entries = await Promise.all(
    names.map(async (name) => {
      const artifactPath = join(rootDir, "artifacts", "contracts", "HeadroomPoC.sol", `${name}.json`);
      return [name, JSON.parse(await readFile(artifactPath, "utf8"))];
    })
  );
  return Object.fromEntries(entries);
}

function contract(address, artifact, signerOrProvider) {
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}

function eventArg(contract, receipt, eventName, argName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        return parsed.args[argName];
      }
    } catch {
      // Ignore logs from other contracts.
    }
  }
  throw new Error(`event ${eventName} not found`);
}

async function sendAndReport(reporter, label, txPromise, { allowRevert = false } = {}) {
  let tx;
  try {
    tx = await txPromise;
  } catch (error) {
    if (!allowRevert) {
      throw error;
    }
    reporter?.(`Submitting transaction: ${label}`);
    reporter?.("  tx: not returned by local RPC");
    reporter?.(`  reverted: ${cleanRevertReason(error)}`);
    return {
      status: 0,
      transactionHash: error.transaction?.hash ?? "not submitted",
      blockNumber: null,
      gasUsed: 0n,
      revertReason: cleanRevertReason(error)
    };
  }
  reporter?.(`Submitting transaction: ${label}`);
  reporter?.(`  tx: ${tx.hash}`);
  reporter?.("  waiting for inclusion...");
  try {
    const receipt = await tx.wait();
    reporter?.(`Included in block: ${receipt.blockNumber}`);
    reporter?.(`  gas used: ${receipt.gasUsed.toString()}`);
    return receipt;
  } catch (error) {
    const receipt = error.receipt;
    if (!allowRevert || !receipt) {
      throw error;
    }
    reporter?.(`Included in block: ${receipt.blockNumber}`);
    reporter?.(`  gas used: ${receipt.gasUsed.toString()}`);
    reporter?.(`  reverted: ${cleanRevertReason(error)}`);
    return {
      ...receipt,
      status: 0,
      revertReason: cleanRevertReason(error)
    };
  }
}

function normalizeTask(task, env = null) {
  const status = workflowStatus(Number(task.status));
  const sourceVault = env && task.sourceVault !== ethers.ZeroAddress ? vaultNameByAddress(env, task.sourceVault) : null;
  const targetVault = env && task.targetVault !== ethers.ZeroAddress ? vaultNameByAddress(env, task.targetVault) : null;
  return {
    taskId: task.taskId,
    intentDigest: task.agentIntentDigest,
    envelopeId: task.envelopeId,
    agent: task.agent,
    proposer: task.proposer,
    proposal:
      sourceVault && targetVault
        ? {
            sourceVault,
            targetVault,
            amount: Number(task.amount)
          }
        : null,
    proposalHash: task.proposalHash,
    status,
    verificationStatus: verificationStatus(Number(task.verificationStatus)),
    verification:
      Number(task.verificationStatus) === 1
        ? {
            approved: true,
            turnoverDelta: Number(task.amount)
          }
        : null,
    rejectionReason: null,
    resolved: task.resolved,
    completedAt: null
  };
}

function workflowStatus(value) {
  return ["TaskCreated", "ProposalSubmitted", "Verified", "Executed", "Completed"][value] ?? "Unknown";
}

function verificationStatus(value) {
  return ["Unverified", "Approved"][value] ?? "Unknown";
}

function vaultNameByAddress(env, address) {
  const found = env.deployment.vaults.find((vault) => vault.address.toLowerCase() === String(address).toLowerCase());
  return found?.name ?? address;
}

function bucketName(bucket) {
  const known = {
    [ethers.id("Core")]: "Core",
    [ethers.id("Growth")]: "Growth",
    [ethers.id("Experimental")]: "Experimental"
  };
  return known[bucket] ?? bucket;
}

function cleanRevertReason(error) {
  const decoded = decodeErrorString(error.error?.data ?? error.data);
  if (decoded) {
    return decoded;
  }
  const text = error.info?.error?.message ?? error.shortMessage ?? error.reason ?? error.message ?? "transaction reverted";
  const match = String(text).match(/reverted with reason string '([^']+)'/);
  return (match?.[1] ?? String(text).replace(/^execution reverted: /, "")).replace(/^"|"$/g, "");
}

function decodeErrorString(data) {
  if (typeof data !== "string" || !data.startsWith("0x08c379a0")) {
    return null;
  }
  try {
    return ethers.AbiCoder.defaultAbiCoder().decode(["string"], `0x${data.slice(10)}`)[0];
  } catch {
    return null;
  }
}
