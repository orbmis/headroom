# ERC Mapping

| Component | ERC concept | Role in PoC | Notes |
| --- | --- | --- | --- |
| `IntentRegistry` | ERC-8001 | Records accepted authority | Produces `_agentIntentDigest` and stores acceptance state. |
| `agreementHash` | ERC-8001 payload/conditions commitment | Commits to structured portfolio mandate terms | Used with `_agentIntentDigest` by downstream capability binding. |
| `EnvelopeRegistry` | ERC-8312 | Meters consumed authority | Stores envelope ID, principal, capability root, cursor root, expiry, and status. |
| `capabilityRoot` | ERC-8312 immutable capability commitment | Binds the envelope to the ERC-8001 intent digest and agreement hash | Demonstrates authority docking from accepted intent to bounded cursor. |
| Portfolio cursor | ERC-8312 mutable cursor | Meters allocation, risk exposure, cumulative turnover, remaining turnover, status, and ordering | Readable state is exposed alongside cursor hashes. |
| `PortfolioManager` | ERC-8301 | Sequences workflow lifecycle | Owns task creation, proposal submission, verification, settlement, completion, and rejection. |
| `ExecutionSubstrate` | ERC-8312 substrate | Enforces mandate and advances cursor | Holds assets, interacts with vaults, rejects direct execution without PortfolioManager authorization. |
| `MandateVerifier` | Workflow gate logic | Deterministically checks proposal validity against mandate and cursor | Keeps policy checks explicit and testable. |
| `ReceiptStore` | Execution evidence trail | Records successful and rejected attempts | Local receipts stand in for events or on-chain logs. |
| Mock token and vaults | ERC-20 / ERC-4626-shaped | Simulated DeFi venues | Not production ERC implementations. |
