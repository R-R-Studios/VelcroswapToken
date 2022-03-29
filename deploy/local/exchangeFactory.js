const ExchangeFactory = require('@elasticswap/elasticswap/artifacts/src/contracts/ExchangeFactory.sol/ExchangeFactory.json');

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments;
  const namedAccounts = await getNamedAccounts();
  const { admin, feeRecipient} = namedAccounts;

  const mathLib = await deployments.get("MathLib");
  const safeMetaDataLib = await deployments.get("SafeMetadata");

  const deployResult = await deploy("ExchangeFactory", {
    from: admin,
    contract: ExchangeFactory,
    args: [feeRecipient],
    libraries: {
      MathLib: mathLib.address,
      SafeMetadata: safeMetaDataLib.address,
    },
  });
  if (deployResult.newlyDeployed) {
    log(
      `contract ExchangeFactory deployed at ${deployResult.address} using ${deployResult.receipt.gasUsed} gas`
    );
  }
};
module.exports.tags = ["ExchangeFactory"];
module.exports.dependencies = ["MathLib", "SafeMetadata"];