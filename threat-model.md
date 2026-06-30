# Threat Model

## Agent Exceeds Per-Vault Cap

Threat: the agent moves too much capital into one approved vault.

Control: the verifier computes resulting allocation and rejects any vault above 30% of portfolio value. The substrate does not execute rejected proposals.

## Agent Exceeds Risk-Bucket Cap

Threat: the agent moves capital into approved vaults but over-concentrates Growth plus Experimental or Experimental exposure.

Control: the verifier computes resulting bucket exposure and rejects Growth plus Experimental above 60% or Experimental above 20%.

## Agent Exceeds Cumulative Turnover

Threat: each rebalance appears locally reasonable, but the agent cumulatively churns the portfolio beyond the accepted mandate.

Control: the ERC-8312-shaped cursor tracks cumulative turnover and remaining headroom. Proposals above remaining headroom are rejected before execution, and cursor advancement also rejects insufficient headroom.

## Stale or Invalid Workflow State

Threat: an agent reuses a resolved proposal or acts from stale task state.

Control: the workflow tracks task status and `resolved`; resolved proposals cannot be resubmitted or executed through the normal path.

## Execute Without Verification

Threat: an agent attempts to skip directly to execution.

Control: `markExecuted` requires `Verified` status. The demo scenario shows the step violation rejection.

## Cursor Advancement Without Execution

Threat: an attacker advances the cursor to consume headroom without moving funds.

Control in PoC: cursor advancement is only called by the controlled substrate execution path, and the witness must bind to the current cursor root. In production this would need contract-level authorization and non-bypassable account routing.

## Execution Without Cursor Advancement

Threat: funds move but aggregate state is not metered.

Control in PoC: substrate execution and cursor advancement are tied together with rollback semantics. If cursor advancement fails, token, vault, and envelope state are restored.

## Expired Mandate

Threat: an agent acts after the mandate expiry.

Control: intent and envelope expiry are checked. Expired envelopes are inactive and proposals are rejected.

## Unaccepted Mandate

Threat: an envelope is created or action is taken against a mandate that was not accepted by both parties.

Control: envelope registration requires an accepted intent. Verification also requires intent status `Ready`.

## Verifier Bug

Threat: deterministic verification logic is incorrect.

Control: tests cover the main approval and rejection paths, but this is not a formal proof. A production implementation would require independent review, property tests, and possibly formal verification for critical invariants.

## Mock Vault Rate Manipulation

Threat: APY metadata is manipulated to make an unsafe rebalance appear attractive.

Control in PoC: APY is configurable test metadata only. Production would need oracle design, rate source validation, stale-rate handling, and manipulation resistance.

## Why This Is Not Production Safe

The PoC has no real wallet signatures, no exact full-standard conformance, no audited smart contracts, no real ERC-20 or ERC-4626 integrations, no reentrancy model, no oracle security, no custody model, no chain finality handling, and no operational controls. It intentionally does not implement ERC-8183 or ERC-8275, marketplace discovery, payment escrow, reputation, real DeFi integrations, oracle integrations, cross-chain support, or production custody assumptions.
