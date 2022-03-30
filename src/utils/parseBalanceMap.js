const { BigNumber, utils } = require("ethers");
const { BalanceTree } = require("./BalanceTree");

const { isAddress, getAddress } = utils;

// This is the blob that gets distributed and pinned to IPFS.
// It is completely sufficient for recreating the entire merkle tree.
// Anyone can verify that all claims are included in the tree,
// and the tree has no additional distributions.
// interface MerkleDistributorInfo {
//   merkleRoot: string
//   tokenTotal: string
//   claims: {
//     [account: string]: {
//       index: number
//       poolId: number
//       totalLPTokenAmount: string
//       totalTICAmount: string
//       proof: string[]
//       flags?: {
//         [flag: string]: boolean
//       }
//     }
//   }
// }
// TODO: update to allow an address to have multiple claims per pool

function parseBalanceMap(balances) {
  // if balances are in an old format, process them
  const balancesInNewFormat = Array.isArray(balances)
    ? balances
    : Object.keys(balances).map((account) => ({
        address: account,
        earnings: `0x${balances[account].toString(16)}`,
      }));

  const dataByAddress = balancesInNewFormat.reduce(
    (memo, { address: account, earnings }) => {
      if (!isAddress(account)) {
        throw new Error(`Found invalid address: ${account}`);
      }
      const parsed = getAddress(account);
      if (memo[parsed]) throw new Error(`Duplicate address: ${parsed}`);
      const parsedNum = BigNumber.from(earnings);
      if (parsedNum.lte(0))
        throw new Error(`Invalid amount for account: ${account}`);

      memo[parsed] = { amount: parsedNum };
      return memo;
    },
    {}
  );

  const sortedAddresses = Object.keys(dataByAddress).sort();

  // construct a tree
  const tree = new BalanceTree(
    sortedAddresses.map((address) => ({
      account: address,
      amount: dataByAddress[address].amount,
    }))
  );

  // generate claims
  const claims = sortedAddresses.reduce((memo, address, index) => {
    const { amount, flags } = dataByAddress[address];
    memo[address] = {
      index,
      amount: amount.toHexString(),
      proof: tree.getProof(index, address, amount),
      ...(flags ? { flags } : {}),
    };
    return memo;
  }, {});

  const tokenTotal = sortedAddresses.reduce(
    (memo, key) => memo.add(dataByAddress[key].amount),
    BigNumber.from(0)
  );

  return {
    merkleRoot: tree.getHexRoot(),
    tokenTotal: tokenTotal.toHexString(),
    claims,
  };
}

module.exports = { parseBalanceMap };
