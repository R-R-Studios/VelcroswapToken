// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import "../FixedPointMath.sol";
import "./MerklePool.sol";

/// @title Stake
///
/// @dev A library which provides the Stake data struct and associated functions.
library MerkleStake {
    using FixedPointMath for FixedPointMath.FixedDecimal;
    using MerklePool for MerklePool.Data;
    using MerkleStake for MerkleStake.Data;

    struct Data {
        uint256 totalDeposited;
        uint256 totalUnclaimed;
        uint256 totalClaimedTIC;
        uint256 totalClaimedLP;
        FixedPointMath.FixedDecimal lastAccumulatedWeight;
    }

    function update(
        Data storage _self,
        MerklePool.Data storage _pool,
        MerklePool.Context storage _ctx
    ) internal {
        _self.totalUnclaimed = _self.getUpdatedTotalUnclaimed(_pool, _ctx);
        _self.lastAccumulatedWeight = _pool.getUpdatedAccumulatedRewardWeight(
            _ctx
        );
    }

    function getUpdatedTotalUnclaimed(
        Data storage _self,
        MerklePool.Data storage _pool,
        MerklePool.Context storage _ctx
    ) internal view returns (uint256) {
        FixedPointMath.FixedDecimal memory _currentAccumulatedWeight =
            _pool.getUpdatedAccumulatedRewardWeight(_ctx);
        FixedPointMath.FixedDecimal memory _lastAccumulatedWeight =
            _self.lastAccumulatedWeight;

        if (_currentAccumulatedWeight.cmp(_lastAccumulatedWeight) == 0) {
            return _self.totalUnclaimed;
        }

        uint256 _amountToDistribute =
            _currentAccumulatedWeight
                .sub(_lastAccumulatedWeight)
                .mul(_self.totalDeposited)
                .decode();

        return _self.totalUnclaimed + _amountToDistribute;
    }
}
