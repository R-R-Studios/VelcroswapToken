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
        uint256 totalUnrealized;
        uint256 totalRealizedTIC;
        uint256 totalRealizedLP;
        FixedPointMath.FixedDecimal lastAccumulatedWeight;
    }

    function update(
        Data storage _self,
        MerklePool.Data storage _pool,
        MerklePool.Context storage _ctx
    ) internal {
        _self.totalUnrealized = _self.getUpdatedTotalUnclaimed(_pool, _ctx);
        _self.lastAccumulatedWeight = _pool.getUpdatedAccumulatedRewardWeight(
            _ctx
        );
    }

    function getUpdatedTotalUnclaimed(
        Data storage _self,
        MerklePool.Data storage _pool,
        MerklePool.Context storage _ctx
    ) internal view returns (uint256) {
        FixedPointMath.FixedDecimal memory currentAccumulatedWeight =
            _pool.getUpdatedAccumulatedRewardWeight(_ctx);
        FixedPointMath.FixedDecimal memory lastAccumulatedWeight =
            _self.lastAccumulatedWeight;

        if (currentAccumulatedWeight.cmp(lastAccumulatedWeight) == 0) {
            return _self.totalUnrealized;
        }

        uint256 amountToDistribute =
            currentAccumulatedWeight
                .sub(lastAccumulatedWeight)
                .mul(_self.totalDeposited)
                .decode();

        return _self.totalUnrealized + amountToDistribute;
    }
}
