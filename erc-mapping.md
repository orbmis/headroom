# ERC Mapping

| Component | ERC concept | Role in PoC | Notes |
| --- | --- | --- | --- |
| `IntentRegistry` | ERC-8001 `AgentIntent` and acceptances | Records the shared mandate and produces `_agentIntentDigest` | Minimal local acceptance model; no wallet signatures or full EIP-712 conformance. |
| `agreementHash` | ERC-8001 payload/conditions commitment | Commits to structured portfolio mandate terms | Used with `_agentIntentDigest` by downstream capability binding. |
| `EnvelopeRegistry` | ERC-8312 bounded-action registry | Stores envelope ID, principal, capability root, cursor root, expiry, and status | Substrate-specific implementation for a portfolio mandate cursor. |
| `capabilityRoot` | ERC-8312 immutable capability commitment | Binds the envelope to the ERC-8001 intent digest and agreement hash | Demonstrates authority docking from intent to cursor. |
| Portfolio cursor | ERC-8312 mutable cursor | Meters allocation, risk exposure, cumulative turnover, remaining turnover, status, and ordering | Readable state is exposed alongside cursor hashes. |
| `ControlledSubstrate` | ERC-8312 substrate | Enforces the mandate and cursor before execution | The cursor is not advisory; invalid actions do not move funds. |
| `RebalanceWorkflow` | ERC-8301 workflow FSM | Orders task creation, proposal, verification, execution/rejection, and completion | Minimal finite-state machine, not a full proof/reply standard implementation. |
| `MandateVerifier` | Workflow gate logic | Deterministically checks proposal validity against mandate and cursor | Keeps policy checks explicit and testable. |
| `ReceiptStore` | Execution evidence trail | Records successful and rejected attempts | Local receipts stand in for events or on-chain logs. |
| Mock token and vaults | ERC-20 / ERC-4626-style substrate assets | Provide enough accounting to demonstrate portfolio movement | Not production ERC implementations. |
