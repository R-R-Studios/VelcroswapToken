// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import "../libraries/FixedPointMath.sol";
import "../interfaces/IMintableERC20.sol";
import "../libraries/merklePools/MerklePool.sol";
import "../libraries/merklePools/MerkleStake.sol";

import "@elasticswap/elasticswap/src/contracts/Exchange.sol";

/// @title StakingProfitPools
/// @notice A contract which allows users to stake to farm tokens that are "realized" once
/// profits enter the system and can be claimed via a merkle proof.
contract MerklePools is ReentrancyGuard {
    using FixedPointMath for FixedPointMath.FixedDecimal;
    using MerklePool for MerklePool.Data;
    using MerklePool for MerklePool.List;
    using SafeERC20 for IERC20;
    using MerkleStake for MerkleStake.Data;

    event PendingGovernanceUpdated(address pendingGovernance);

    event GovernanceUpdated(address governance);

    event ForfeitAddressUpdated(address governance);

    event RewardRateUpdated(uint256 rewardRate);

    event PoolRewardWeightUpdated(uint256 indexed poolId, uint256 rewardWeight);

    event PoolCreated(uint256 indexed poolId, IERC20 indexed token);

    event TokensDeposited(
        address indexed user,
        uint256 indexed poolId,
        uint256 amount
    );

    event TokensWithdrawn(
        address indexed user,
        uint256 indexed poolId,
        uint256 amount
    );

    event TokensClaimed(
        address indexed user,
        uint256 indexed poolId,
        uint256 index,
        uint256 amountClaimed
    );

    event MerkleRootUpdated(bytes32 merkleRoot);
    event LPTokensGenerated(uint256 lpAmountCreated, uint256 ticConsumed);

    IMintableERC20 public ticToken; // token which will be minted as a reward for staking.
    IERC20 public quoteToken; // other half of the LP token (not the reward token)
    IERC20 public elasticLPToken; // elastic LP token we create to emit for claimed rewards

    uint256 excessTICFromSlippage; // extra TIC that can be used before next mint

    address public governance;
    address public pendingGovernance;
    address public forfeitAddress; // receives all unclaimed TIC when someone exits

    bytes32 public merkleRoot;
    bool public isClaimsEnabled = false;

    // Tokens are mapped to their pool identifier plus one. Tokens that do not have an associated pool
    // will return an identifier of zero.
    mapping(IERC20 => uint256) public tokenPoolIds;

    MerklePool.Context public poolContext; // The context shared between the pools.
    MerklePool.List private _pools; // A list of all of the pools.

    // mapping of all of the user stakes mapped first by pool and then by address.
    mapping(address => mapping(uint256 => MerkleStake.Data)) public stakes;

    constructor(
        IMintableERC20 _ticToken,
        IERC20 _quoteToken,
        IERC20 _elasticLPToken,
        address _governance,
        address _forfeitAddress
    ) {
        require(
            _governance != address(0),
            "MerklePools: governance address cannot be 0x0"
        );

        ticToken = _ticToken;
        governance = _governance;
        elasticLPToken = _elasticLPToken;
        quoteToken = _quoteToken;
        forfeitAddress = _forfeitAddress;

        // grant approval to exchange so we can mint
        ticToken.approve(address(_elasticLPToken), type(uint256).max);
        quoteToken.approve(address(_elasticLPToken), type(uint256).max);
    }

    /**
     * @dev A modifier which reverts when the caller is not the governance.
     */
    modifier onlyGovernance() {
        require(msg.sender == governance, "MerklePools: only governance");
        _;
    }

    /**
     * @dev Sets the governance. This function can only called by the current governance.
     * @param _pendingGovernance the new pending governance.
     */
    function setPendingGovernance(address _pendingGovernance)
        external
        onlyGovernance
    {
        require(
            _pendingGovernance != address(0),
            "MerklePools: pending governance address cannot be 0x0"
        );
        pendingGovernance = _pendingGovernance;

        emit PendingGovernanceUpdated(_pendingGovernance);
    }

    function acceptGovernance() external {
        require(
            msg.sender == pendingGovernance,
            "MerklePools: only pending governance"
        );

        address pendingGovernance_ = pendingGovernance;
        governance = pendingGovernance_;

        emit GovernanceUpdated(pendingGovernance_);
    }

    /**
     * @dev Sets the distribution reward rate. This will update all of the pools.
     * @param _rewardRate The number of tokens to distribute per second.
     */
    function setRewardRate(uint256 _rewardRate) external onlyGovernance {
        _updatePools();

        poolContext.rewardRate = _rewardRate;

        emit RewardRateUpdated(_rewardRate);
    }

    function setForfeitAddress(address _forfeitAddress)
        external
        onlyGovernance
    {
        require(_forfeitAddress != forfeitAddress, "MerklePools: SAME_ADDRESS");
        forfeitAddress = _forfeitAddress;
        emit ForfeitAddressUpdated(_forfeitAddress);
    }

    /**
     * @dev Creates a new pool. The created pool will need to have its reward weight
     * initialized before it begins generating rewards.
     * @param _token The token the pool will accept for staking.
     * @return the identifier for the newly created pool.
     */
    function createPool(IERC20 _token)
        external
        onlyGovernance
        returns (uint256)
    {
        require(
            tokenPoolIds[_token] == 0,
            "MerklePools: token already has a pool"
        );

        uint256 poolId = _pools.length();

        _pools.push(
            MerklePool.Data({
                token: _token,
                totalDeposited: 0,
                totalUnclaimedTIC: 0,
                totalUnclaimedTICInLP: 0,
                rewardWeight: 0,
                accumulatedRewardWeight: FixedPointMath.FixedDecimal(0),
                lastUpdatedBlockTimestamp: block.timestamp
            })
        );

        tokenPoolIds[_token] = poolId + 1;

        emit PoolCreated(poolId, _token);

        return poolId;
    }

    /**
     * @dev Sets the reward weights of all of the pools.
     * @param _rewardWeights The reward weights of all of the pools.
     */
    function setRewardWeights(uint256[] calldata _rewardWeights)
        external
        onlyGovernance
    {
        require(
            _rewardWeights.length == _pools.length(),
            "MerklePools: weights length mismatch"
        );

        _updatePools();

        uint256 totalRewardWeight = poolContext.totalRewardWeight;
        uint256 poolsLength = _pools.length();
        for (uint256 _poolId = 0; _poolId < poolsLength; _poolId++) {
            MerklePool.Data storage _pool = _pools.get(_poolId);

            uint256 _currentRewardWeight = _pool.rewardWeight;
            if (_currentRewardWeight == _rewardWeights[_poolId]) {
                continue;
            }

            totalRewardWeight =
                totalRewardWeight -
                _currentRewardWeight +
                _rewardWeights[_poolId];
            _pool.rewardWeight = _rewardWeights[_poolId];

            emit PoolRewardWeightUpdated(_poolId, _rewardWeights[_poolId]);
        }
        poolContext.totalRewardWeight = totalRewardWeight;
    }

    /**
     * @dev Stakes tokens into a pool.
     * @param _poolId        the pool to deposit tokens into.
     * @param _depositAmount the amount of tokens to deposit.
     */
    function deposit(uint256 _poolId, uint256 _depositAmount)
        external
        nonReentrant
    {
        require(msg.sender != forfeitAddress, "MerklePools: UNUSABLE_ADDRESS");
        MerklePool.Data storage pool = _pools.get(_poolId);
        pool.update(poolContext);

        MerkleStake.Data storage stake = stakes[msg.sender][_poolId];
        stake.update(pool, poolContext);

        pool.totalDeposited = pool.totalDeposited + _depositAmount;
        stake.totalDeposited = stake.totalDeposited + _depositAmount;

        pool.token.safeTransferFrom(msg.sender, address(this), _depositAmount);
        emit TokensDeposited(msg.sender, _poolId, _depositAmount);
    }

    /**
     * @dev Claims all rewards from a pool and then withdraws all staked tokens.
     * @param _poolId the pool to exit from.
     */
    function exit(uint256 _poolId) external nonReentrant {
        MerklePool.Data storage pool = _pools.get(_poolId);
        pool.update(poolContext);

        MerkleStake.Data storage stake = stakes[msg.sender][_poolId];
        stake.update(pool, poolContext);

        uint256 withdrawAmount = stake.totalDeposited;
        pool.totalDeposited = pool.totalDeposited - withdrawAmount;
        stake.totalDeposited = 0;

        // unclaimed rewards are transferred to the forfeit address
        MerkleStake.Data storage forfeitStake = stakes[forfeitAddress][_poolId];
        forfeitStake.update(pool, poolContext);

        forfeitStake.totalUnclaimed += stake.totalUnclaimed;
        stake.totalUnclaimed = 0;

        pool.token.safeTransfer(msg.sender, withdrawAmount);
        emit TokensWithdrawn(msg.sender, _poolId, withdrawAmount);
    }

    /**
     * @notice Allows a caller to generate LP tokens to distribute to stakers.  The quote token
     * is taken from the caller and paired with freshly minted TIC token to create new LP tokens.
     * @param _poolId id of the pool these LP Tokens are associated with.
     * @param _ticTokenQty qty of ticTokens that you would like to add
     * @param _quoteTokenQty qty of quoteTokens that you would like to add (USDC)
     * @param _ticTokenQtyMin minimum acceptable qty of ticToken that will be added (or transaction will revert)
     * @param _quoteTokenQtyMin minimum acceptable qty of quoteTokens that will be added (or transaction will revert)
     * @param _expirationTimestamp timestamp that this transaction must occur before (or transaction will revert)
     */
    function generateLPTokens(
        uint256 _poolId,
        uint256 _ticTokenQty,
        uint256 _quoteTokenQty,
        uint256 _ticTokenQtyMin,
        uint256 _quoteTokenQtyMin,
        uint256 _expirationTimestamp
    ) external onlyGovernance {
        MerklePool.Data storage _pool = _pools.get(_poolId);
        _pool.update(poolContext); // update pool first!
        uint256 maxMintAmount =
            _pool.totalUnclaimedTIC - _pool.totalUnclaimedTICInLP;
        require(maxMintAmount >= _ticTokenQty, "MerklePools: NSF_UNCLAIMED");

        // check to make sure we don't have some "Excess" tic we can use.
        uint256 ticBalanceToBeMinted = _ticTokenQty - excessTICFromSlippage;

        ticToken.mint(address(this), ticBalanceToBeMinted);
        quoteToken.safeTransferFrom(msg.sender, address(this), _quoteTokenQty);
        uint256 lpBalanceBefore = elasticLPToken.balanceOf(address(this));
        uint256 ticBalanceBefore = ticToken.balanceOf(address(this));
        Exchange(address(elasticLPToken)).addLiquidity(
            _ticTokenQty,
            _quoteTokenQty,
            _ticTokenQtyMin,
            _quoteTokenQtyMin,
            address(this),
            _expirationTimestamp
        );
        uint256 lpBalanceCreated =
            elasticLPToken.balanceOf(address(this)) - lpBalanceBefore;
        require(lpBalanceCreated != 0, "MerklePools: NO_LP_CREATED");

        uint256 ticBalanceConsumed =
            ticBalanceBefore - ticToken.balanceOf(address(this));
        excessTICFromSlippage = _ticTokenQty - ticBalanceConsumed; //save for next time

        _pool.totalUnclaimedTICInLP += ticBalanceConsumed;
        emit LPTokensGenerated(lpBalanceCreated, ticBalanceConsumed);
    }

    /**
     * @notice Allows a new merkle root to be set by the contracts owner (the DAO)
     * @param _merkleRoot the merkle root to be set
     */
    function setMerkleRoot(bytes32 _merkleRoot) public onlyGovernance {
        require(merkleRoot != _merkleRoot, "MerklePools: DUPLICATE_ROOT");
        merkleRoot = _merkleRoot;
        emit MerkleRootUpdated(merkleRoot);
    }

    /**
     * @notice Allows for a staker to claim LP tokens based on the merkle proof provided.
     * @param _index the index of the merkle claim
     * @param _poolId the pool id these rewards are associated with.
     * @param _totalLPTokenAmount the total LP token amount in the tree
     * @param _totalTICAmount the total TIC amount to be consumed in the tree
     * @param _merkleProof bytes32[] proof for the claim
     */
    function claim(
        uint256 _index,
        uint256 _poolId,
        uint256 _totalLPTokenAmount,
        uint256 _totalTICAmount,
        bytes32[] calldata _merkleProof
    ) external {
        // Verify the merkle proof.
        bytes32 node =
            keccak256(
                abi.encodePacked(
                    _index,
                    msg.sender,
                    _poolId,
                    _totalLPTokenAmount,
                    _totalTICAmount
                )
            );

        // TODO:
        // TODO: ENABLE MERKLE PROOF!!!!!!
        // TODO
        // require(
        //     MerkleProof.verify(_merkleProof, merkleRoot, node),
        //     "MerklePools: INVALID_PROOF"
        // );

        MerkleStake.Data storage stake = stakes[msg.sender][_poolId];
        uint256 alreadyClaimedLPAmount = stake.totalClaimedLP;
        uint256 alreadyClaimedTICAmount = stake.totalClaimedTIC;

        require(
            _totalLPTokenAmount > alreadyClaimedLPAmount &&
                _totalTICAmount > alreadyClaimedTICAmount,
            "MerklePools: INVALID_CLAIM_AMOUNT"
        );

        MerklePool.Data storage pool = _pools.get(_poolId);
        pool.update(poolContext);
        stake.update(pool, poolContext);

        // determine the amounts of the new claim
        uint256 lpTokenAmountToBeClaimed;
        uint256 ticTokenAmountToBeClaimed;

        unchecked {
            lpTokenAmountToBeClaimed =
                _totalLPTokenAmount -
                alreadyClaimedLPAmount;
            ticTokenAmountToBeClaimed =
                _totalTICAmount -
                alreadyClaimedTICAmount;
        }

        require(
            ticTokenAmountToBeClaimed <= stake.totalUnclaimed,
            "MerklePools: INVALID_UNCLAIMED_AMOUNT"
        );

        stake.totalClaimedLP = _totalLPTokenAmount;
        stake.totalClaimedTIC = _totalTICAmount;

        unchecked {
            stake.totalUnclaimed -= ticTokenAmountToBeClaimed;
        }
        pool.totalUnclaimedTIC -= ticTokenAmountToBeClaimed;
        pool.totalUnclaimedTICInLP -= ticTokenAmountToBeClaimed;

        elasticLPToken.safeTransfer(msg.sender, lpTokenAmountToBeClaimed);
        emit TokensClaimed(
            msg.sender,
            _poolId,
            _index,
            lpTokenAmountToBeClaimed
        );
    }

    /**
     * @dev Gets the rate at which tokens are minted to stakers for all pools.
     * @return the reward rate.
     */
    function rewardRate() external view returns (uint256) {
        return poolContext.rewardRate;
    }

    /**
     * @dev Gets the total reward weight between all the pools.
     * @return the total reward weight.
     */
    function totalRewardWeight() external view returns (uint256) {
        return poolContext.totalRewardWeight;
    }

    /**
     * @dev Gets the number of pools that exist.
     * @return the pool count.
     */
    function poolCount() external view returns (uint256) {
        return _pools.length();
    }

    /**
     * @dev Gets the token a pool accepts.
     * @param _poolId the identifier of the pool.
     * @return the token.
     */
    function getPoolToken(uint256 _poolId) external view returns (IERC20) {
        MerklePool.Data storage pool = _pools.get(_poolId);
        return pool.token;
    }

    /**
     * @dev Gets the pool data struct
     * @param _poolId the identifier of the pool.
     * @return the Pool.Data (memory, not storage!).
     */
    function getPool(uint256 _poolId)
        external
        view
        returns (MerklePool.Data memory)
    {
        return _pools.get(_poolId);
    }

    /**
     * @dev Gets the total amount of funds staked in a pool.
     * @param _poolId the identifier of the pool.
     * @return the total amount of staked or deposited tokens.
     */
    function getPoolTotalDeposited(uint256 _poolId)
        external
        view
        returns (uint256)
    {
        MerklePool.Data storage pool = _pools.get(_poolId);
        return pool.totalDeposited;
    }

    /**
     * @dev Gets the total amount of token unclaimed from a pool
     * @param _poolId the identifier of the pool.
     * @return the total amount of unclaimed / un-minted tokens from a pool
     */
    function getPoolTotalUnclaimed(uint256 _poolId)
        external
        view
        returns (uint256)
    {
        MerklePool.Data storage pool = _pools.get(_poolId);
        return pool.getUpdatedTotalUnclaimed(poolContext);
    }

    function getPoolTotalUnclaimedNotInLP(uint256 _poolId)
        external
        view
        returns (uint256)
    {
        MerklePool.Data storage pool = _pools.get(_poolId);
        return
            pool.getUpdatedTotalUnclaimed(poolContext) -
            pool.totalUnclaimedTICInLP;
    }

    /**
     * @dev Gets the reward weight of a pool which determines
     * how much of the total rewards it receives per second.
     * @param _poolId the identifier of the pool.
     * @return the pool reward weight.
     */
    function getPoolRewardWeight(uint256 _poolId)
        external
        view
        returns (uint256)
    {
        MerklePool.Data storage pool = _pools.get(_poolId);
        return pool.rewardWeight;
    }

    /**
     * @dev Gets the amount of tokens per second being distributed to stakers for a pool.
     * @param _poolId the identifier of the pool.
     * @return the pool reward rate.
     */
    function getPoolRewardRate(uint256 _poolId)
        external
        view
        returns (uint256)
    {
        MerklePool.Data storage pool = _pools.get(_poolId);
        return pool.getRewardRate(poolContext);
    }

    /**
     * @dev Gets the number of tokens a user has staked into a pool.
     * @param _account The account to query.
     * @param _poolId  the identifier of the pool.
     * @return the amount of deposited tokens.
     */
    function getStakeTotalDeposited(address _account, uint256 _poolId)
        external
        view
        returns (uint256)
    {
        MerkleStake.Data storage stake = stakes[_account][_poolId];
        return stake.totalDeposited;
    }

    /**
     * @dev Gets the number of unclaimed reward tokens a user can claim from a pool.
     * @param _account The account to get the unclaimed balance of.
     * @param _poolId  The pool to check for unclaimed rewards.
     * @return the amount of unclaimed reward tokens a user has in a pool.
     */
    function getStakeTotalUnclaimed(address _account, uint256 _poolId)
        external
        view
        returns (uint256)
    {
        MerkleStake.Data storage stake = stakes[_account][_poolId];
        return stake.getUpdatedTotalUnclaimed(_pools.get(_poolId), poolContext);
    }

    /**
     * @dev Updates all of the pools.
     */
    function _updatePools() internal {
        for (uint256 poolId = 0; poolId < _pools.length(); poolId++) {
            MerklePool.Data storage pool = _pools.get(poolId);
            pool.update(poolContext);
        }
    }
}
