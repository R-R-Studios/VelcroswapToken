module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments;
  const namedAccounts = await getNamedAccounts();
  const { admin } = namedAccounts;

  const deployResult = await deploy("MerklePool", {
    from: admin,
    contract: "MerklePool",
    args: [],
  });
  if (deployResult.newlyDeployed) {
    log(
      `Library MerklePool deployed at ${deployResult.address} using ${deployResult.receipt.gasUsed} gas`
    );
  }
};
module.exports.tags = ["MerklePool"];
