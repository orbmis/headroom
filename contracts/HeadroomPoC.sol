// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockUSDC {
    string public constant name = "Mock USDC";
    string public constant symbol = "mUSDC";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "TOKEN_ALLOWANCE");
        allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "TOKEN_BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockVault4626 {
    MockUSDC public immutable asset;
    bytes32 public immutable vaultId;
    bytes32 public immutable riskBucket;
    uint256 public apyBps;
    mapping(address => uint256) public balanceOf;

    constructor(MockUSDC asset_, bytes32 vaultId_, bytes32 riskBucket_, uint256 apyBps_) {
        asset = asset_;
        vaultId = vaultId_;
        riskBucket = riskBucket_;
        apyBps = apyBps_;
    }

    function setApyBps(uint256 nextApyBps) external {
        apyBps = nextApyBps;
    }

    function depositFor(address account, uint256 amount) external {
        require(asset.transferFrom(msg.sender, address(this), amount), "VAULT_DEPOSIT_TRANSFER");
        balanceOf[account] += amount;
    }

    function withdrawFor(address account, uint256 amount) external {
        require(balanceOf[account] >= amount, "VAULT_BALANCE");
        balanceOf[account] -= amount;
        require(asset.transfer(msg.sender, amount), "VAULT_WITHDRAW_TRANSFER");
    }
}

contract IntentRegistry {
    enum IntentStatus {
        Pending,
        Ready
    }

    struct MandateTerms {
        address principal;
        address agent;
        address asset;
        uint256 maxAllocationPerVaultBps;
        uint256 maxGrowthPlusExperimentalBps;
        uint256 maxExperimentalBps;
        uint256 minYieldImprovementBps;
        uint256 maxCumulativeTurnover;
        uint256 expiry;
        bytes32 workflowType;
        uint256 startingPortfolioValue;
    }

    struct Intent {
        MandateTerms terms;
        bytes32 agreementHash;
        bytes32 agentIntentDigest;
        bool principalAccepted;
        bool agentAccepted;
        IntentStatus status;
        address[] approvedVaults;
        bytes32[] riskBucketLabels;
    }

    mapping(bytes32 => Intent) private intents;
    mapping(bytes32 => mapping(address => bool)) public approvedVault;

    event MandateCreated(bytes32 indexed agentIntentDigest, bytes32 indexed agreementHash, address indexed principal, address agent);
    event MandateAccepted(bytes32 indexed agentIntentDigest, address indexed accepter, IntentStatus status);

    function createMandateIntent(
        MandateTerms calldata terms,
        address[] calldata approvedVaults,
        bytes32[] calldata riskBucketLabels
    ) external returns (bytes32 agentIntentDigest, bytes32 agreementHash) {
        require(terms.principal != address(0), "MANDATE_PRINCIPAL");
        require(terms.agent != address(0), "MANDATE_AGENT");
        agreementHash = keccak256(abi.encode(terms, approvedVaults, riskBucketLabels));
        agentIntentDigest = keccak256(abi.encode("ERC8001_AGENT_INTENT", agreementHash, terms.principal, terms.agent));
        Intent storage intent = intents[agentIntentDigest];
        require(intent.terms.principal == address(0), "MANDATE_EXISTS");
        intent.terms = terms;
        intent.agreementHash = agreementHash;
        intent.agentIntentDigest = agentIntentDigest;
        intent.status = IntentStatus.Pending;
        for (uint256 i = 0; i < approvedVaults.length; i++) {
            intent.approvedVaults.push(approvedVaults[i]);
            approvedVault[agentIntentDigest][approvedVaults[i]] = true;
        }
        for (uint256 i = 0; i < riskBucketLabels.length; i++) {
            intent.riskBucketLabels.push(riskBucketLabels[i]);
        }
        emit MandateCreated(agentIntentDigest, agreementHash, terms.principal, terms.agent);
    }

    function acceptMandate(bytes32 agentIntentDigest) external {
        Intent storage intent = intents[agentIntentDigest];
        require(intent.terms.principal != address(0), "MANDATE_NOT_FOUND");
        require(msg.sender == intent.terms.principal || msg.sender == intent.terms.agent, "MANDATE_ACCEPTER");
        if (msg.sender == intent.terms.principal) {
            intent.principalAccepted = true;
        }
        if (msg.sender == intent.terms.agent) {
            intent.agentAccepted = true;
        }
        if (intent.principalAccepted && intent.agentAccepted) {
            intent.status = IntentStatus.Ready;
        }
        emit MandateAccepted(agentIntentDigest, msg.sender, intent.status);
    }

    function getTerms(bytes32 agentIntentDigest) external view returns (MandateTerms memory) {
        return intents[agentIntentDigest].terms;
    }

    function getIntent(bytes32 agentIntentDigest)
        external
        view
        returns (MandateTerms memory terms, bytes32 agreementHash, IntentStatus status, bool principalAccepted, bool agentAccepted)
    {
        Intent storage intent = intents[agentIntentDigest];
        return (intent.terms, intent.agreementHash, intent.status, intent.principalAccepted, intent.agentAccepted);
    }

    function getApprovedVaults(bytes32 agentIntentDigest) external view returns (address[] memory) {
        return intents[agentIntentDigest].approvedVaults;
    }

    function getRiskBucketLabels(bytes32 agentIntentDigest) external view returns (bytes32[] memory) {
        return intents[agentIntentDigest].riskBucketLabels;
    }

    function agreementHashOf(bytes32 agentIntentDigest) external view returns (bytes32) {
        return intents[agentIntentDigest].agreementHash;
    }

    function statusOf(bytes32 agentIntentDigest) external view returns (IntentStatus) {
        return intents[agentIntentDigest].status;
    }
}

contract EnvelopeRegistry {
    enum EnvelopeStatus {
        Inactive,
        Active,
        Revoked
    }

    struct Envelope {
        address principal;
        bytes32 agentIntentDigest;
        bytes32 agreementHash;
        bytes32 capabilityRoot;
        bytes32 cursorRoot;
        uint256 expiry;
        EnvelopeStatus status;
        address[] vaults;
        bytes32[] riskBuckets;
    }

    struct CursorValues {
        uint256 portfolioValue;
        uint256 maxCumulativeTurnover;
        uint256 cumulativeTurnover;
        uint256 lastRebalanceSequence;
    }

    IntentRegistry public immutable intentRegistry;
    address public executionSubstrate;
    mapping(bytes32 => Envelope) private envelopes;
    mapping(bytes32 => CursorValues) private cursorValues;
    mapping(bytes32 => mapping(address => uint256)) private allocationByVault;
    mapping(bytes32 => mapping(bytes32 => uint256)) private allocationByRiskBucket;
    mapping(address => bytes32) public vaultRiskBucket;

    event EnvelopeRegistered(bytes32 indexed envelopeId, bytes32 indexed agentIntentDigest, bytes32 capabilityRoot, bytes32 cursorRoot);
    event CursorAdvanced(bytes32 indexed envelopeId, bytes32 indexed taskId, bytes32 cursorRoot, uint256 cumulativeTurnover);

    constructor(IntentRegistry intentRegistry_) {
        intentRegistry = intentRegistry_;
    }

    modifier onlyExecutionSubstrate() {
        require(msg.sender == executionSubstrate, "ENVELOPE_SUBSTRATE_ONLY");
        _;
    }

    function setExecutionSubstrate(address executionSubstrate_) external {
        require(executionSubstrate == address(0), "ENVELOPE_SUBSTRATE_SET");
        executionSubstrate = executionSubstrate_;
    }

    function registerVaultMetadata(address vault, bytes32 riskBucket) external {
        vaultRiskBucket[vault] = riskBucket;
    }

    function setCumulativeTurnoverForDemo(bytes32 envelopeId, uint256 cumulativeTurnover) external {
        CursorValues storage values = cursorValues[envelopeId];
        require(cumulativeTurnover <= values.maxCumulativeTurnover, "CURSOR_DEMO_TURNOVER");
        values.cumulativeTurnover = cumulativeTurnover;
        envelopes[envelopeId].cursorRoot = _cursorRoot(envelopeId);
    }

    function registerEnvelope(
        bytes32 agentIntentDigest,
        address[] calldata vaults,
        uint256[] calldata initialAllocation,
        uint256 initialTurnover
    ) external returns (bytes32 envelopeId) {
        (IntentRegistry.MandateTerms memory terms, bytes32 agreementHash, IntentRegistry.IntentStatus status,,) =
            intentRegistry.getIntent(agentIntentDigest);
        require(status == IntentRegistry.IntentStatus.Ready, "ENVELOPE_INTENT_NOT_READY");
        require(vaults.length == initialAllocation.length, "ENVELOPE_ALLOCATION_LENGTH");
        bytes32 capabilityRoot = keccak256(abi.encode("ERC8312_CAPABILITY", agentIntentDigest, agreementHash));
        envelopeId = keccak256(abi.encode("ERC8312_ENVELOPE", agentIntentDigest, capabilityRoot, block.chainid, address(this)));
        Envelope storage envelope = envelopes[envelopeId];
        require(envelope.principal == address(0), "ENVELOPE_EXISTS");
        envelope.principal = terms.principal;
        envelope.agentIntentDigest = agentIntentDigest;
        envelope.agreementHash = agreementHash;
        envelope.capabilityRoot = capabilityRoot;
        envelope.expiry = terms.expiry;
        envelope.status = EnvelopeStatus.Active;
        for (uint256 i = 0; i < vaults.length; i++) {
            envelope.vaults.push(vaults[i]);
            allocationByVault[envelopeId][vaults[i]] = initialAllocation[i];
            bytes32 bucket = vaultRiskBucket[vaults[i]];
            allocationByRiskBucket[envelopeId][bucket] += initialAllocation[i];
            cursorValues[envelopeId].portfolioValue += initialAllocation[i];
        }
        bytes32[] memory labels = intentRegistry.getRiskBucketLabels(agentIntentDigest);
        for (uint256 i = 0; i < labels.length; i++) {
            envelope.riskBuckets.push(labels[i]);
        }
        cursorValues[envelopeId].maxCumulativeTurnover = terms.maxCumulativeTurnover;
        cursorValues[envelopeId].cumulativeTurnover = initialTurnover;
        envelope.cursorRoot = _cursorRoot(envelopeId);
        emit EnvelopeRegistered(envelopeId, agentIntentDigest, capabilityRoot, envelope.cursorRoot);
    }

    function advanceCursor(
        bytes32 envelopeId,
        bytes32 prevCursorRoot,
        address[] calldata vaults,
        uint256[] calldata nextAllocation,
        uint256 turnoverDelta,
        bytes32 taskId,
        bytes32 proposalHash
    ) external onlyExecutionSubstrate returns (bytes32 nextCursorRoot) {
        Envelope storage envelope = envelopes[envelopeId];
        require(isActive(envelopeId), "ENVELOPE_INACTIVE");
        require(envelope.cursorRoot == prevCursorRoot, "CURSOR_STALE_ROOT");
        require(vaults.length == nextAllocation.length, "CURSOR_ALLOCATION_LENGTH");
        CursorValues storage values = cursorValues[envelopeId];
        require(values.cumulativeTurnover + turnoverDelta <= values.maxCumulativeTurnover, "CURSOR_HEADROOM");
        for (uint256 i = 0; i < envelope.vaults.length; i++) {
            allocationByVault[envelopeId][envelope.vaults[i]] = 0;
        }
        for (uint256 i = 0; i < envelope.riskBuckets.length; i++) {
            allocationByRiskBucket[envelopeId][envelope.riskBuckets[i]] = 0;
        }
        values.portfolioValue = 0;
        for (uint256 i = 0; i < vaults.length; i++) {
            allocationByVault[envelopeId][vaults[i]] = nextAllocation[i];
            allocationByRiskBucket[envelopeId][vaultRiskBucket[vaults[i]]] += nextAllocation[i];
            values.portfolioValue += nextAllocation[i];
        }
        values.cumulativeTurnover += turnoverDelta;
        values.lastRebalanceSequence += 1;
        envelope.cursorRoot = keccak256(abi.encode(_cursorRoot(envelopeId), taskId, proposalHash));
        emit CursorAdvanced(envelopeId, taskId, envelope.cursorRoot, values.cumulativeTurnover);
        return envelope.cursorRoot;
    }

    function isActive(bytes32 envelopeId) public view returns (bool) {
        Envelope storage envelope = envelopes[envelopeId];
        return envelope.status == EnvelopeStatus.Active && block.timestamp <= envelope.expiry;
    }

    function getEnvelope(bytes32 envelopeId)
        external
        view
        returns (
            address principal,
            bytes32 agentIntentDigest,
            bytes32 agreementHash,
            bytes32 capabilityRoot,
            bytes32 cursorRoot,
            uint256 expiry,
            EnvelopeStatus status
        )
    {
        Envelope storage envelope = envelopes[envelopeId];
        return (
            envelope.principal,
            envelope.agentIntentDigest,
            envelope.agreementHash,
            envelope.capabilityRoot,
            envelope.cursorRoot,
            envelope.expiry,
            envelope.status
        );
    }

    function cursorSummary(bytes32 envelopeId)
        external
        view
        returns (
            address[] memory vaults,
            uint256[] memory vaultAllocations,
            bytes32[] memory riskBuckets,
            uint256[] memory riskAllocations,
            uint256 portfolioValue,
            uint256 cumulativeTurnover,
            uint256 maxCumulativeTurnover,
            uint256 remainingTurnover,
            uint256 lastRebalanceSequence,
            bytes32 cursorRoot,
            bool active
        )
    {
        Envelope storage envelope = envelopes[envelopeId];
        CursorValues storage values = cursorValues[envelopeId];
        vaults = envelope.vaults;
        vaultAllocations = new uint256[](vaults.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            vaultAllocations[i] = allocationByVault[envelopeId][vaults[i]];
        }
        riskBuckets = envelope.riskBuckets;
        riskAllocations = new uint256[](riskBuckets.length);
        for (uint256 i = 0; i < riskBuckets.length; i++) {
            riskAllocations[i] = allocationByRiskBucket[envelopeId][riskBuckets[i]];
        }
        return (
            vaults,
            vaultAllocations,
            riskBuckets,
            riskAllocations,
            values.portfolioValue,
            values.cumulativeTurnover,
            values.maxCumulativeTurnover,
            values.maxCumulativeTurnover - values.cumulativeTurnover,
            values.lastRebalanceSequence,
            envelope.cursorRoot,
            isActive(envelopeId)
        );
    }

    function allocationOf(bytes32 envelopeId, address vault) external view returns (uint256) {
        return allocationByVault[envelopeId][vault];
    }

    function envelopeVaults(bytes32 envelopeId) external view returns (address[] memory) {
        return envelopes[envelopeId].vaults;
    }

    function _cursorRoot(bytes32 envelopeId) internal view returns (bytes32) {
        Envelope storage envelope = envelopes[envelopeId];
        CursorValues storage values = cursorValues[envelopeId];
        uint256[] memory vaultAllocations = new uint256[](envelope.vaults.length);
        for (uint256 i = 0; i < envelope.vaults.length; i++) {
            vaultAllocations[i] = allocationByVault[envelopeId][envelope.vaults[i]];
        }
        uint256[] memory riskAllocations = new uint256[](envelope.riskBuckets.length);
        for (uint256 i = 0; i < envelope.riskBuckets.length; i++) {
            riskAllocations[i] = allocationByRiskBucket[envelopeId][envelope.riskBuckets[i]];
        }
        return keccak256(
            abi.encode(
                envelope.vaults,
                vaultAllocations,
                envelope.riskBuckets,
                riskAllocations,
                values.portfolioValue,
                values.maxCumulativeTurnover,
                values.cumulativeTurnover,
                values.lastRebalanceSequence,
                envelope.status,
                envelope.expiry
            )
        );
    }
}

contract ExecutionSubstrate {
    bytes32 public constant CORE = keccak256("Core");
    bytes32 public constant GROWTH = keccak256("Growth");
    bytes32 public constant EXPERIMENTAL = keccak256("Experimental");

    MockUSDC public immutable token;
    IntentRegistry public immutable intentRegistry;
    EnvelopeRegistry public immutable envelopeRegistry;
    address public portfolioManager;

    event RebalanceExecuted(
        bytes32 indexed taskId,
        bytes32 indexed envelopeId,
        address indexed sourceVault,
        address targetVault,
        uint256 amount,
        bytes32 cursorRoot
    );

    constructor(MockUSDC token_, IntentRegistry intentRegistry_, EnvelopeRegistry envelopeRegistry_) {
        token = token_;
        intentRegistry = intentRegistry_;
        envelopeRegistry = envelopeRegistry_;
    }

    modifier onlyPortfolioManager() {
        require(msg.sender == portfolioManager, "SUBSTRATE_MANAGER_ONLY");
        _;
    }

    function setPortfolioManager(address portfolioManager_) external {
        require(portfolioManager == address(0), "SUBSTRATE_MANAGER_SET");
        portfolioManager = portfolioManager_;
    }

    function depositFromUser(address user, uint256 amount) external {
        require(token.transferFrom(user, address(this), amount), "SUBSTRATE_DEPOSIT");
    }

    function setInitialAllocation(address[] calldata vaults, uint256[] calldata amounts) external {
        require(vaults.length == amounts.length, "SUBSTRATE_ALLOCATION_LENGTH");
        for (uint256 i = 0; i < vaults.length; i++) {
            if (amounts[i] > 0) {
                token.approve(vaults[i], amounts[i]);
                MockVault4626(vaults[i]).depositFor(address(this), amounts[i]);
            }
        }
    }

    function previewRebalance(
        bytes32 agentIntentDigest,
        bytes32 envelopeId,
        address sourceVault,
        address targetVault,
        uint256 amount
    ) external view returns (uint256 turnoverDelta) {
        _checkRebalance(agentIntentDigest, envelopeId, sourceVault, targetVault, amount);
        return amount;
    }

    function executeVerifiedRebalance(
        bytes32 taskId,
        bytes32 agentIntentDigest,
        bytes32 envelopeId,
        address sourceVault,
        address targetVault,
        uint256 amount,
        bytes32 proposalHash
    ) external onlyPortfolioManager returns (bytes32 cursorRoot) {
        _checkRebalance(agentIntentDigest, envelopeId, sourceVault, targetVault, amount);
        (,,,,,,,,, bytes32 prevCursorRoot,) = envelopeRegistry.cursorSummary(envelopeId);
        MockVault4626(sourceVault).withdrawFor(address(this), amount);
        token.approve(targetVault, amount);
        MockVault4626(targetVault).depositFor(address(this), amount);
        address[] memory vaults = envelopeRegistry.envelopeVaults(envelopeId);
        uint256[] memory nextAllocation = new uint256[](vaults.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            nextAllocation[i] = MockVault4626(vaults[i]).balanceOf(address(this));
        }
        cursorRoot = envelopeRegistry.advanceCursor(envelopeId, prevCursorRoot, vaults, nextAllocation, amount, taskId, proposalHash);
        emit RebalanceExecuted(taskId, envelopeId, sourceVault, targetVault, amount, cursorRoot);
    }

    function allocationByVault(address[] calldata vaults) external view returns (uint256[] memory balances) {
        balances = new uint256[](vaults.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            balances[i] = MockVault4626(vaults[i]).balanceOf(address(this));
        }
    }

    function _checkRebalance(
        bytes32 agentIntentDigest,
        bytes32 envelopeId,
        address sourceVault,
        address targetVault,
        uint256 amount
    ) internal view {
        IntentRegistry.MandateTerms memory terms = intentRegistry.getTerms(agentIntentDigest);
        require(intentRegistry.statusOf(agentIntentDigest) == IntentRegistry.IntentStatus.Ready, "INTENT_NOT_ACCEPTED");
        require(envelopeRegistry.isActive(envelopeId), "ENVELOPE_INACTIVE");
        require(intentRegistry.approvedVault(agentIntentDigest, sourceVault), "SOURCE_NOT_APPROVED");
        require(intentRegistry.approvedVault(agentIntentDigest, targetVault), "TARGET_NOT_APPROVED");
        require(MockVault4626(sourceVault).balanceOf(address(this)) >= amount, "SOURCE_BALANCE");
        require(MockVault4626(targetVault).apyBps() >= MockVault4626(sourceVault).apyBps() + terms.minYieldImprovementBps, "YIELD_THRESHOLD");
        (address[] memory vaults,,,, uint256 portfolioValue, uint256 cumulativeTurnover, uint256 maxTurnover,,,,) =
            envelopeRegistry.cursorSummary(envelopeId);
        require(cumulativeTurnover + amount <= maxTurnover, "CURSOR_HEADROOM");
        uint256 growthExperimental;
        uint256 experimental;
        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 nextAmount = MockVault4626(vaults[i]).balanceOf(address(this));
            if (vaults[i] == sourceVault) {
                nextAmount -= amount;
            }
            if (vaults[i] == targetVault) {
                nextAmount += amount;
            }
            require(nextAmount * 10_000 <= portfolioValue * terms.maxAllocationPerVaultBps, "MAX_PER_VAULT");
            bytes32 bucket = envelopeRegistry.vaultRiskBucket(vaults[i]);
            if (bucket == GROWTH || bucket == EXPERIMENTAL) {
                growthExperimental += nextAmount;
            }
            if (bucket == EXPERIMENTAL) {
                experimental += nextAmount;
            }
        }
        require(growthExperimental * 10_000 <= portfolioValue * terms.maxGrowthPlusExperimentalBps, "GROWTH_EXPERIMENTAL_CAP");
        require(experimental * 10_000 <= portfolioValue * terms.maxExperimentalBps, "EXPERIMENTAL_CAP");
    }
}

contract PortfolioManager {
    enum VerificationStatus {
        Unverified,
        Approved
    }

    enum WorkflowStatus {
        TaskCreated,
        ProposalSubmitted,
        Verified,
        Executed,
        Completed
    }

    struct Task {
        bytes32 taskId;
        bytes32 agentIntentDigest;
        bytes32 envelopeId;
        address agent;
        address proposer;
        address sourceVault;
        address targetVault;
        uint256 amount;
        bytes32 proposalHash;
        WorkflowStatus status;
        VerificationStatus verificationStatus;
        bool resolved;
    }

    IntentRegistry public immutable intentRegistry;
    ExecutionSubstrate public immutable executionSubstrate;
    uint256 public sequence;
    mapping(bytes32 => Task) public tasks;

    event TaskCreated(bytes32 indexed taskId, bytes32 indexed agentIntentDigest, bytes32 indexed envelopeId, address agent);
    event ProposalSubmitted(bytes32 indexed taskId, bytes32 indexed proposalHash, address indexed proposer);
    event ProposalVerified(bytes32 indexed taskId);
    event TaskCompleted(bytes32 indexed taskId);

    constructor(IntentRegistry intentRegistry_, ExecutionSubstrate executionSubstrate_) {
        intentRegistry = intentRegistry_;
        executionSubstrate = executionSubstrate_;
    }

    function createTask(bytes32 agentIntentDigest, bytes32 envelopeId, address agent) external returns (bytes32 taskId) {
        sequence += 1;
        taskId = keccak256(abi.encode("ERC8301_TASK", sequence, agentIntentDigest, envelopeId, agent, block.timestamp));
        Task storage task = tasks[taskId];
        task.taskId = taskId;
        task.agentIntentDigest = agentIntentDigest;
        task.envelopeId = envelopeId;
        task.agent = agent;
        task.status = WorkflowStatus.TaskCreated;
        emit TaskCreated(taskId, agentIntentDigest, envelopeId, agent);
    }

    function submitProposal(bytes32 taskId, address sourceVault, address targetVault, uint256 amount) external returns (bytes32 proposalHash) {
        Task storage task = tasks[taskId];
        require(task.status == WorkflowStatus.TaskCreated, "WORKFLOW_INVALID_SUBMIT");
        require(msg.sender == task.agent, "PROPOSER_NOT_AGENT");
        proposalHash = keccak256(abi.encode("ERC8301_PROPOSAL", taskId, sourceVault, targetVault, amount, msg.sender));
        task.proposer = msg.sender;
        task.sourceVault = sourceVault;
        task.targetVault = targetVault;
        task.amount = amount;
        task.proposalHash = proposalHash;
        task.status = WorkflowStatus.ProposalSubmitted;
        emit ProposalSubmitted(taskId, proposalHash, msg.sender);
    }

    function verifyProposal(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == WorkflowStatus.ProposalSubmitted, "WORKFLOW_INVALID_VERIFY");
        executionSubstrate.previewRebalance(task.agentIntentDigest, task.envelopeId, task.sourceVault, task.targetVault, task.amount);
        task.verificationStatus = VerificationStatus.Approved;
        task.status = WorkflowStatus.Verified;
        emit ProposalVerified(taskId);
    }

    function executeTask(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == WorkflowStatus.Verified, "WORKFLOW_EXECUTE_BEFORE_VERIFY");
        require(!task.resolved, "WORKFLOW_ALREADY_RESOLVED");
        executionSubstrate.executeVerifiedRebalance(
            task.taskId,
            task.agentIntentDigest,
            task.envelopeId,
            task.sourceVault,
            task.targetVault,
            task.amount,
            task.proposalHash
        );
        task.status = WorkflowStatus.Completed;
        task.resolved = true;
        emit TaskCompleted(taskId);
    }

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }
}
