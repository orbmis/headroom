# mandated-vault-rebalancer

`mandated-vault-rebalancer` is a local, testable architecture PoC showing how ERC-8001-shaped authority, ERC-8312-shaped bounded-action cursors, and an ERC-8301-shaped workflow can compose for a bounded autonomous DeFi workflow. A user and agent accept a shared mock ERC-4626 portfolio mandate, bind it into a live bounded-action envelope, and route rebalance attempts through an ordered workflow and enforcing substrate.

The PoC proves the core composition:

ERC-8001 records the accepted mandate. ERC-8312 meters consumption of that mandate. The substrate enforces the live cursor. ERC-8301 orders the rebalance workflow.

This is not a production DeFi protocol, a profitable yield strategy, or financial advice.

## Architecture

The portfolio uses 10,000 mock USDC allocated across six mock ERC-4626-style vaults:

| Vault | Risk bucket | Initial APY |
| --- | --- | ---: |
| Vault A | Core | 4.0% |
| Vault B | Core | 4.3% |
| Vault C | Growth | 5.1% |
| Vault D | Growth | 5.4% |
| Vault E | Experimental | 7.2% |
| Vault F | Experimental | 8.0% |

The accepted mandate commits to the principal, agent, approved asset, approved vaults, risk buckets, max 30% per vault, max 60% Growth plus Experimental, max 20% Experimental, minimum 50 bps yield improvement, max 8,000 mock USDC cumulative turnover, expiry, workflow type, and `agreementHash`.

The ERC-8312-shaped envelope binds to `_agentIntentDigest` and `agreementHash` through `capabilityRoot`. Its cursor exposes allocation by vault, allocation by risk bucket, cumulative turnover, remaining turnover, ordering marker, status, expiry, and `cursorRoot`.

The controlled substrate owns the simulated portfolio. Rebalances are only executed after deterministic verification, and cursor advancement is tied to execution with rollback semantics in the local simulation.

## Install

Requires Node.js 20 or newer.

```sh
npm install
```

There are no runtime package dependencies; `npm install` creates the lockfile and prepares local npm scripts.

## Commands

```sh
npm test                 # unit and integration tests
npm run lint             # local lint checks
npm run format:check     # formatting check
npm run format           # normalize trailing whitespace/newlines
npm run typecheck        # syntax checks for JS modules
npm run build            # syntax checks for entrypoints
npm run demo             # run all demo scenarios
```

Scenario commands:

```sh
npm run demo:happy
npm run demo:per-vault
npm run demo:risk
npm run demo:turnover
npm run demo:workflow
```

CLI inspection commands:

```sh
node bin/mandated-vault-rebalancer.js init
node bin/mandated-vault-rebalancer.js inspect:intent
node bin/mandated-vault-rebalancer.js inspect:envelope
node bin/mandated-vault-rebalancer.js inspect:cursor
node bin/mandated-vault-rebalancer.js inspect:portfolio
node bin/mandated-vault-rebalancer.js inspect:receipts
```

The CLI also aliases scripted setup steps:

```sh
node bin/mandated-vault-rebalancer.js create-mandate
node bin/mandated-vault-rebalancer.js accept-mandate
node bin/mandated-vault-rebalancer.js create-envelope
node bin/mandated-vault-rebalancer.js deposit
node bin/mandated-vault-rebalancer.js allocate-initial
```

## Demo Scenarios

`demo:happy` moves 500 mock USDC from Vault A to Vault D. The target APY improves by 140 bps, Vault D reaches 30%, risk exposure remains within bounds, turnover becomes 500 of 8,000, the cursor advances, and a success receipt is recorded.

`demo:per-vault` attempts to move 700 mock USDC from Vault A to Vault D. Vault D would exceed the 30% per-vault cap, so the proposal is rejected, funds do not move, the cursor does not advance, and a rejection receipt is recorded.

`demo:risk` attempts to move 1,500 mock USDC from Vault A to Vault E. The target vault is approved and yield improves, but Growth plus Experimental exposure would exceed 60%, so the proposal is rejected.

`demo:turnover` starts with 7,700 of 8,000 mock USDC turnover already consumed. The agent proposes a 500 mock USDC move from Vault A to Vault D. The move is locally reasonable, but remaining cursor headroom is only 300, so ERC-8312-style aggregate metering rejects it. This is the central demonstration.

`demo:workflow` attempts execution before verification. The ERC-8301-shaped workflow rejects the step violation before any substrate action.

## Inspecting Cursor and Receipts

`inspect:cursor` prints the live cursor root, allocation by vault, risk-bucket exposure, cumulative turnover used, remaining turnover, status, expiry-derived active state, and last rebalance sequence.

`inspect:receipts` runs one valid attempt and prints the resulting receipt hash, task ID, result, reason, and amount. In code, receipts include task ID, intent digest, agreement hash, envelope ID, source/target vaults, amount, verification result, rejection reason, cursor before, cursor after when executed, allocation before, allocation after when executed, timestamp, and receipt hash.

## What Is Mocked

The token is a local mock USDC-like ledger. The vaults are minimal ERC-4626-style vaults with deposit, withdraw, balances, APY metadata, and risk metadata. Hashing uses Node.js `sha3-256` for deterministic local commitments. There is no chain, wallet signature validation, oracle, custody layer, or real strategy execution.

## Out of Scope

The PoC does not implement ERC-8183 or ERC-8275. It does not implement marketplace discovery, payment escrow, reputation, real DeFi integrations, oracle integrations, cross-chain support, or production custody assumptions.

## Security and Production Caveats

This project is an architecture simulation. A production system would need real EIP-712 signing, audited contracts, exact standard conformance decisions, reentrancy and accounting protections, oracle/rate integrity, custody threat analysis, access control, chain-specific failure handling, event indexing, and robust operational monitoring.

See [architecture.md](./architecture.md), [erc-mapping.md](./erc-mapping.md), [demo-script.md](./demo-script.md), and [threat-model.md](./threat-model.md).
