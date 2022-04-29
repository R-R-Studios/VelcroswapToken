// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import "./MerklePools.sol";
import "../libraries/merklePools/MerklePool.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/**
 * MerklePoolsForeign allows for us to enable our MerklePools staking on a chain that has bridged
 * TIC.  Instead of minting during the `generateLPTokens` call, TIC is transferred in from
 * the caller (onlyGovernance) to be used to mint LP tokens.
 */
contract MerklePoolsForeign is MerklePools {
    using MerklePool for MerklePool.List;
    using MerklePool for MerklePool.Data;
    using SafeERC20Upgradeable for IERC20Upgradeable;

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
    ) external override onlyGovernance {
        require(address(ticToken) != address(0), "MerklePools: TIC_NOT_SET");
        require(elasticLPToken != address(0), "MerklePools: ELP_NOT_SET");

        MerklePool.Data storage _pool = pools.get(_poolId);
        _pool.update(poolContext); // update pool first!
        uint256 maxMintAmount =
            _pool.totalUnclaimedTIC - _pool.totalUnclaimedTICInLP;
        require(maxMintAmount >= _ticTokenQty, "MerklePools: NSF_UNCLAIMED");

        ticToken.transferFrom(msg.sender, address(this), _ticTokenQty);
        IERC20Upgradeable(quoteToken).safeTransferFrom(
            msg.sender,
            address(this),
            _quoteTokenQty
        );

        uint256 lpBalanceBefore =
            IERC20Upgradeable(elasticLPToken).balanceOf(address(this));
        uint256 ticBalanceBefore = ticToken.balanceOf(address(this));
        uint256 quoteTokenBalanceBefore =
            IERC20Upgradeable(quoteToken).balanceOf(address(this));

        Exchange(address(elasticLPToken)).addLiquidity(
            _ticTokenQty,
            _quoteTokenQty,
            _ticTokenQtyMin,
            _quoteTokenQtyMin,
            address(this),
            _expirationTimestamp
        );

        uint256 lpBalanceCreated =
            IERC20Upgradeable(elasticLPToken).balanceOf(address(this)) -
                lpBalanceBefore;
        require(lpBalanceCreated != 0, "MerklePools: NO_LP_CREATED");

        uint256 ticBalanceConsumed =
            ticBalanceBefore - ticToken.balanceOf(address(this));
        _pool.totalUnclaimedTICInLP += ticBalanceConsumed;

        if (ticBalanceConsumed < _ticTokenQty) {
            // refund the rest to caller.
            ticToken.transfer(msg.sender, _ticTokenQty - ticBalanceConsumed);
        }

        uint256 quoteTokenConsumed =
            quoteTokenBalanceBefore -
                IERC20Upgradeable(quoteToken).balanceOf(address(this));

        if (quoteTokenConsumed < _quoteTokenQty) {
            // refund the rest to the caller
            IERC20Upgradeable(quoteToken).safeTransfer(
                msg.sender,
                _quoteTokenQty - quoteTokenConsumed
            );
        }

        emit LPTokensGenerated(
            lpBalanceCreated,
            ticBalanceConsumed,
            quoteTokenConsumed
        );
    }
}
