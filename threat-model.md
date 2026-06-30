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

Control: PortfolioManager tracks task status and `resolved`; resolved proposals cannot be resubmitted or executed through the normal path.

## Agent Bypasses PortfolioManager

Threat: an agent tries to avoid the ERC-8301-shaped workflow and force a rebalance directly.

Control: the agent can only submit proposals to PortfolioManager in the demo flow. ExecutionSubstrate rejects direct execution unless it receives valid PortfolioManager authorization for the exact task, proposal hash, action, and workflow status.

## Agent Calls ExecutionSubstrate Directly

Threat: an agent obtains a verified-looking task object and calls the asset holder directly.

Control: ExecutionSubstrate requires a PortfolioManager-issued authorization object. Tests prove that direct `executeVerifiedRebalance` calls without this authorization fail, leaving allocation and cursor state unchanged.

## Invalid PortfolioManager Transition

Threat: PortfolioManager is asked to complete, execute, or settle a task out of order.

Control: PortfolioManager rejects execution before verification, settlement before verification or rejection, completion before execution or rejection, and duplicate proposal submission after resolution.

## Execute Without Verification

Threat: an agent attempts to skip directly to execution.

Control: PortfolioManager execution settlement requires `Verified` status and is routed through ExecutionSubstrate. Direct `markExecuted` calls reject even for verified tasks, so workflow state cannot be marked executed merely because a task object exists. The demo scenario shows the step violation rejection.

## ExecutionSubstrate Executes Without Workflow Authorization

Threat: the asset holder executes a rebalance without a valid workflow state.

Control: ExecutionSubstrate rejects execution without PortfolioManager authorization. In production this boundary would be enforced with contract-level access control and account routing rather than an in-memory object.

## Cursor Advancement Without Execution

Threat: an attacker advances the cursor to consume headroom without moving funds.

Control in PoC: cursor advancement is only called by the ExecutionSubstrate execution path, and the witness must bind to the current cursor root. In production this would need contract-level authorization and non-bypassable account routing.

## Execution Without Cursor Advancement

Threat: funds move but aggregate state is not metered.

Control in PoC: ExecutionSubstrate execution and cursor advancement are tied together with rollback semantics. If cursor advancement fails, token, vault, and envelope state are restored.

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
