module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments;
  const namedAccounts = await getNamedAccounts();
  const { admin } = namedAccounts;

  const deployResult = await deploy("MerkleStake", {
    from: admin,
    contract: "MerkleStake",
    args: [],
  });
  if (deployResult.newlyDeployed) {
    log(
      `Library MerkleStake deployed at ${deployResult.address} using ${deployResult.receipt.gasUsed} gas`
    );
  }
};
module.exports.tags = ["MerkleStake"];
