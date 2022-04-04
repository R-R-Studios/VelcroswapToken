module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments;
  const namedAccounts = await getNamedAccounts();
  const { admin, governance, tic, usdc, ticUsdcELP } = namedAccounts;

  const deployResult = await deploy("MerklePools", {
    from: admin,
    contract: "MerklePools",
    proxy: {
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [    
            tic,
            usdc,
            ticUsdcELP,
            governance,
            governance
          ],
        }
      }
    }
  });
  if (deployResult.newlyDeployed) {
    log(
      `Merkle Pools deployed at ${deployResult.address} using ${deployResult.receipt.gasUsed} gas`
    );
  }
};
module.exports.tags = ["MerklePools"];