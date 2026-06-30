# Demo Script

## Setup

Install and run the full demo:

```sh
npm install
npm run demo
```

Inspect the initialized environment:

```sh
node bin/mandated-vault-rebalancer.js init
```

Expected output includes `_agentIntentDigest`, `agreementHash`, envelope ID, `capabilityRoot`, `cursorRoot`, allocation by vault, risk-bucket exposure, cumulative turnover, and remaining turnover.

## Happy Path

```sh
npm run demo:happy
```

Expected result:

- ERC-8001 accepted mandate is shown.
- ERC-8312 envelope and cursor roots are shown.
- ERC-8301 task reaches `Completed`.
- Verification is `Approved`.
- Vault A decreases from 2,500 to 2,000.
- Vault D increases from 2,500 to 3,000.
- Cumulative turnover becomes 500.
- Remaining turnover becomes 7,500.
- Receipt has no rejection reason.

What it proves: a valid workflow can draw against the mandate and advance the cursor.

## Per-Vault Failure

```sh
npm run demo:per-vault
```

Expected result:

- Verification is `Rejected`.
- Rejection reason is `resulting allocation exceeds max per-vault allocation`.
- Allocation remains unchanged.
- Cursor root remains unchanged.
- Receipt is recorded.

What it proves: stateless concentration constraints are enforced before execution.

## Risk-Bucket Failure

```sh
npm run demo:risk
```

Expected result:

- Verification is `Rejected`.
- Rejection reason is `resulting Growth plus Experimental exposure exceeds mandate cap`.
- Allocation remains unchanged.
- Cursor root remains unchanged.
- Receipt is recorded.

What it proves: aggregate exposure constraints are enforced by the substrate/verifier path.

## Cumulative Turnover Failure

```sh
npm run demo:turnover
```

Expected setup:

- Cumulative turnover is 7,700 of 8,000.
- Remaining turnover is 300.

Expected result:

- Agent proposes a 500 mock USDC move from Vault A to Vault D.
- Target vault is approved.
- Yield improvement is sufficient.
- Per-vault and risk-bucket limits are satisfied.
- Verification is `Rejected`.
- Rejection reason is `proposed turnover exceeds remaining ERC-8312 cursor headroom`.
- Allocation remains unchanged.
- Cursor root remains unchanged.
- Receipt is recorded.

What it proves: ERC-8312-style aggregate metering catches an action that would pass local per-call checks.

## Workflow Violation

```sh
npm run demo:workflow
```

Expected result:

- The workflow rejects execution before verification.
- No substrate action is attempted.
- No funds move.
- Cursor remains unchanged.

What it proves: ERC-8301-shaped workflow ordering prevents step skipping.

## Inspect Receipts

```sh
node bin/mandated-vault-rebalancer.js inspect:receipts
```

Expected output includes receipt hash, task ID, result, rejection reason if any, and amount. The in-memory receipt object also contains cursor and allocation snapshots before and after execution.
