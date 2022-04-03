// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import "../interfaces/IMintableERC20.sol";
import "../libraries/merklePools/MerklePool.sol";
import "../libraries/merklePools/MerkleStake.sol";

/**
 * @dev Represents all storage for our MerklePools contract for easy upgrading later
 */
contract MerklePoolsStorage {
    IMintableERC20 public ticToken; // token which will be minted as a reward for staking.
    uint256 public excessTICFromSlippage; // extra TIC that can be used before next mint

    address public quoteToken; // other half of the LP token (not the reward token)
    address public elasticLPToken; // elastic LP token we create to emit for claimed rewards
    address public governance;
    address public pendingGovernance;
    address public forfeitAddress; // receives all unclaimed TIC when someone exits

    bytes32 public merkleRoot;
    bool public isClaimsEnabled; // disabled flag until first merkle proof is set.

    // Tokens are mapped to their pool identifier plus one. Tokens that do not have an associated pool
    // will return an identifier of zero.
    mapping(address => uint256) public tokenPoolIds;

    MerklePool.Context public poolContext; // The context shared between the pools.
    MerklePool.List internal pools; // A list of all of the pools.

    // mapping of all of the user stakes mapped first by pool and then by address.
    mapping(address => mapping(uint256 => MerkleStake.Data)) public stakes;
}
