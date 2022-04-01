const { utils } = require("ethers");
const { MerkleTree } = require("./MerkleTree");

class BalanceTree {
  constructor(balances) {
    this._tree = new MerkleTree(
      balances.map(
        ({ account, poolId, totalLPTokenAmount, totalTICAmount }, index) =>
          BalanceTree.toNode(
            index,
            account,
            poolId,
            totalLPTokenAmount,
            totalTICAmount
          )
      )
    );
  }

  static verifyProof(
    index,
    account,
    poolId,
    totalLPTokenAmount,
    totalTICAmount,
    proof,
    root
  ) {
    let pair = BalanceTree.toNode(
      index,
      account,
      poolId,
      totalLPTokenAmount,
      totalTICAmount
    );
    for (const item of proof) {
      pair = MerkleTree.combinedHash(pair, item);
    }

    return pair.equals(root);
  }

  // keccak256(abi.encode(index, account, amount))
  static toNode(index, account, poolId, totalLPTokenAmount, totalTICAmount) {
    return Buffer.from(
      utils
        .solidityKeccak256(
          ["uint256", "address", "uint256", "uint256", "uint256"],
          [index, account, poolId, totalLPTokenAmount, totalTICAmount]
        )
        .substr(2),
      "hex"
    );
  }

  getHexRoot() {
    return this._tree.getHexRoot();
  }

  // returns the hex bytes32 values of the proof
  getProof(index, account, poolId, totalLPTokenAmount, totalTICAmount) {
    return this._tree.getHexProof(
      BalanceTree.toNode(
        index,
        account,
        poolId,
        totalLPTokenAmount,
        totalTICAmount
      )
    );
  }
}

module.exports = { BalanceTree };
