import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(__dirname);
const amount = (value) => BigInt(value);
const vaultConfigs = [
  ["Vault A", "Core", 400, 2500],
  ["Vault B", "Core", 430, 2500],
  ["Vault C", "Growth", 510, 2500],
  ["Vault D", "Growth", 540, 2500],
  ["Vault E", "Experimental", 720, 0],
  ["Vault F", "Experimental", 800, 0]
];

const connection = await network.create();
const { ethers } = connection;
const [principal, agent] = await ethers.getSigners();
const networkName = connection.networkName;

function log(message) {
  console.log(message);
}

const CONFIRMATIONS = Number(process.env.DEPLOY_CONFIRMATIONS ?? 2);
const MAX_ATTEMPTS = Number(process.env.DEPLOY_RETRIES ?? 5);
const RETRY_DELAY_MS = Number(process.env.DEPLOY_RETRY_DELAY_MS ?? 4000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Public RPCs (e.g. sepolia.base.org) load-balance across backends that lag one
// another, so a read/estimate issued right after a write can land on a node that
// has not yet seen the block and revert as if the state does not exist. Treat
// those, plus ordinary network hiccups, as transient and worth retrying.
function isTransient(error) {
  const message = (
    error?.info?.error?.message ??
    error?.shortMessage ??
    error?.message ??
    ""
  ).toLowerCase();
  const code = error?.code;
  return (
    message.includes("mandate_not_found") ||
    message.includes("envelope_not_found") ||
    message.includes("not found") ||
    message.includes("missing revert data") ||
    message.includes("could not coalesce") ||
    message.includes("header not found") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("bad gateway") ||
    message.includes("service unavailable") ||
    message.includes("server error") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    code === "NETWORK_ERROR" ||
    code === "SERVER_ERROR" ||
    code === "TIMEOUT"
  );
}

// Retries a thunk that has NOT yet broadcast a transaction (a read, a
// staticCall, or a send whose gas estimation may revert against a stale node).
// Safe to re-run because every retried failure happens before anything reaches
// the mempool. Do not use this to wrap receipt waiting — see wait().
async function withRetry(label, thunk) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await thunk();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      log(`  ${label}: transient RPC failure on attempt ${attempt}/${MAX_ATTEMPTS}; retrying in ${RETRY_DELAY_MS}ms`);
      log(`    reason: ${error?.shortMessage ?? error?.message ?? error}`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

async function wait(label, sendTx) {
  // Retry only the send (gas estimation + broadcast). Once we hold a tx hash the
  // transaction is in flight, so wait for the receipt OUTSIDE the retry loop to
  // avoid ever broadcasting the same call twice.
  const tx = await withRetry(label, sendTx);
  log(`Submitting transaction: ${label}`);
  log(`  tx: ${tx.hash}`);
  log(`  waiting for ${CONFIRMATIONS} confirmation(s)...`);
  const receipt = await tx.wait(CONFIRMATIONS);
  log(`Included in block: ${receipt.blockNumber}`);
  log(`  gas used: ${receipt.gasUsed.toString()}`);
  return receipt;
}

async function deploy(name, args = []) {
  return withRetry(`deploy ${name}`, async () => {
    const contract = await ethers.deployContract(name, args);
    log(`Deploying ${name}`);
    log(`  tx: ${contract.deploymentTransaction().hash}`);
    await contract.waitForDeployment();
    const receipt = await contract.deploymentTransaction().wait(CONFIRMATIONS);
    log(`  address: ${contract.target}`);
    log(`  block: ${receipt.blockNumber}`);
    return contract;
  });
}

const token = await deploy("MockUSDC");
const intentRegistry = await deploy("IntentRegistry");
const envelopeRegistry = await deploy("EnvelopeRegistry", [intentRegistry.target]);
const executionSubstrate = await deploy("ExecutionSubstrate", [token.target, intentRegistry.target, envelopeRegistry.target]);
const portfolioManager = await deploy("PortfolioManager", [intentRegistry.target, executionSubstrate.target]);

await wait("EnvelopeRegistry.setExecutionSubstrate", () => envelopeRegistry.setExecutionSubstrate(executionSubstrate.target));
await wait("ExecutionSubstrate.setPortfolioManager", () => executionSubstrate.setPortfolioManager(portfolioManager.target));

const vaults = [];
for (const [name, bucket, apyBps] of vaultConfigs) {
  const vault = await deploy("MockVault4626", [token.target, ethers.encodeBytes32String(name), ethers.id(bucket), apyBps]);
  vaults.push({ name, bucket, apyBps, address: vault.target });
  await wait(`EnvelopeRegistry.registerVaultMetadata(${name})`, () => envelopeRegistry.registerVaultMetadata(vault.target, ethers.id(bucket)));
}

const terms = {
  principal: principal.address,
  agent: agent.address,
  asset: token.target,
  maxAllocationPerVaultBps: 3000,
  maxGrowthPlusExperimentalBps: 6000,
  maxExperimentalBps: 2000,
  minYieldImprovementBps: 50,
  maxCumulativeTurnover: amount(8000),
  expiry: BigInt(Math.floor(Date.now() / 1000) + 86_400),
  workflowType: ethers.id("mock-erc4626-rebalance"),
  startingPortfolioValue: amount(10_000)
};
const approvedVaults = vaults.map((vault) => vault.address);
const riskBucketLabels = ["Core", "Growth", "Experimental"].map((bucket) => ethers.id(bucket));
const [agentIntentDigest, agreementHash] = await withRetry(
  "IntentRegistry.createMandateIntent.staticCall",
  () => intentRegistry.createMandateIntent.staticCall(terms, approvedVaults, riskBucketLabels)
);
await wait("IntentRegistry.createMandateIntent", () => intentRegistry.createMandateIntent(terms, approvedVaults, riskBucketLabels));
await wait("IntentRegistry.acceptMandate(principal)", () => intentRegistry.connect(principal).acceptMandate(agentIntentDigest));
await wait("IntentRegistry.acceptMandate(agent)", () => intentRegistry.connect(agent).acceptMandate(agentIntentDigest));

const initialAllocation = vaultConfigs.map((config) => amount(config[3]));
const envelopeId = await withRetry(
  "EnvelopeRegistry.registerEnvelope.staticCall",
  () => envelopeRegistry.registerEnvelope.staticCall(agentIntentDigest, approvedVaults, initialAllocation, 0)
);
await wait("EnvelopeRegistry.registerEnvelope", () => envelopeRegistry.registerEnvelope(agentIntentDigest, approvedVaults, initialAllocation, 0));
await wait("MockUSDC.mint(principal)", () => token.mint(principal.address, amount(10_000)));
await wait("MockUSDC.approve(ExecutionSubstrate)", () => token.connect(principal).approve(executionSubstrate.target, amount(10_000)));
await wait("ExecutionSubstrate.depositFromUser", () => executionSubstrate.depositFromUser(principal.address, amount(10_000)));
await wait("ExecutionSubstrate.setInitialAllocation", () => executionSubstrate.setInitialAllocation(approvedVaults, initialAllocation));

const deployment = {
  network: networkName,
  chainId: Number((await ethers.provider.getNetwork()).chainId),
  principal: principal.address,
  agent: agent.address,
  contracts: {
    token: token.target,
    intentRegistry: intentRegistry.target,
    envelopeRegistry: envelopeRegistry.target,
    executionSubstrate: executionSubstrate.target,
    portfolioManager: portfolioManager.target
  },
  vaults,
  agentIntentDigest,
  agreementHash,
  envelopeId,
  createdAt: new Date().toISOString()
};

const outputPath = join(rootDir, "deployments", `${networkName}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);
log(`Deployment saved to ${outputPath}`);
