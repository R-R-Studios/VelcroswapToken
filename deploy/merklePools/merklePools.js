require("dotenv").config();

module.exports = async ({ getNamedAccounts, deployments, ethers }) => {
  const { deploy, log } = deployments;
  const namedAccounts = await getNamedAccounts();
  const { admin, governance } = namedAccounts;
  
  const ticToken = await deployments.get("TicToken");

  const deployResult = await deploy("MerklePools", {
    from: admin,
    contract: "MerklePools",
    proxy: {
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [    
            ticToken.address,
            process.env.AVAX_USDC_ADDRESS,
            process.env.AVAX_ELP_ADDRESS,
            process.env.AVAX_GOVERNANCE_ADDRESS,
            process.env.AVAX_GOVERNANCE_ADDRESS
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
module.exports.dependencies = [
  "TicToken",
];
