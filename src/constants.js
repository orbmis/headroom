export const PRINCIPAL = "0x1000000000000000000000000000000000000001";
export const AGENT = "0x2000000000000000000000000000000000000002";
export const UNAUTHORIZED_AGENT = "0x3000000000000000000000000000000000000003";
export const SUBSTRATE_ADDRESS = "substrate:mandated-vault-rebalancer";

export const ASSET = {
  symbol: "mUSDC",
  name: "Mock USDC",
  decimals: 6
};

export const RISK_BUCKETS = {
  CORE: "Core",
  GROWTH: "Growth",
  EXPERIMENTAL: "Experimental"
};

export const VAULT_UNIVERSE = [
  { name: "Vault A", riskBucket: RISK_BUCKETS.CORE, apyBps: 400 },
  { name: "Vault B", riskBucket: RISK_BUCKETS.CORE, apyBps: 430 },
  { name: "Vault C", riskBucket: RISK_BUCKETS.GROWTH, apyBps: 510 },
  { name: "Vault D", riskBucket: RISK_BUCKETS.GROWTH, apyBps: 540 },
  { name: "Vault E", riskBucket: RISK_BUCKETS.EXPERIMENTAL, apyBps: 720 },
  { name: "Vault F", riskBucket: RISK_BUCKETS.EXPERIMENTAL, apyBps: 800 }
];

export const INITIAL_ALLOCATION = {
  "Vault A": 2500,
  "Vault B": 2500,
  "Vault C": 2500,
  "Vault D": 2500,
  "Vault E": 0,
  "Vault F": 0
};

export const MANDATE_LIMITS = {
  maxAllocationPerVaultBps: 3000,
  maxGrowthPlusExperimentalBps: 6000,
  maxExperimentalBps: 2000,
  minYieldImprovementBps: 50,
  maxCumulativeTurnover: 8000
};

export const WORKFLOW_TYPE = "MOCK_ERC_4626_PORTFOLIO_REBALANCE_V1";
