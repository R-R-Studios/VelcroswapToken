require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-contract-sizer");
require("hardhat-gas-reporter");
require("hardhat-deploy");
require("solidity-coverage");
require("dotenv").config();
require("@openzeppelin/hardhat-upgrades");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.4",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      deploy: ["deploy/local", "deploy/core", "deploy/tic", "deploy/pools"],
    },
    goerli: {
      deploy: ["deploy"],
      url: process.env.GOERLI_URL,
      accounts:
        process.env.GOERLI_PRIVATE_KEY !== undefined
          ? [process.env.GOERLI_PRIVATE_KEY]
          : [],
    },
    fuji: {
      deploy: ["deploy/merklePools"],
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      gasPrice: 225000000000,
      chainId: 43113,
      accounts:
        process.env.FUJI_PRIVATE_KEY !== undefined
          ? [process.env.FUJI_PRIVATE_KEY]
          : [],
    },
    avalanche: {
      deploy: ["deploy"],
      url: "https://api.avax.network/ext/bc/C/rpc",
      gasPrice: 80000000000, // 58 nAVAX (10e9)
      chainId: 43114,
      accounts:
        process.env.AVAX_PRIVATE_KEY !== undefined
          ? [process.env.AVAX_PRIVATE_KEY]
          : [],
    },
    mainnet: {
      url: process.env.MAINNET_URL || "",
      accounts:
        process.env.MAINNET_PRIVATE_KEY !== undefined ? [process.env.MAINNET_PRIVATE_KEY] : [],
      gasPrice: "auto"
    },
  },
  paths: {
    deploy: ["deploy/core"],
    sources: "./src",
  },
  namedAccounts: {
    admin: {
      default: 0,
    },
    governance: {
      default: 1,
      goerli: process.env.GOERLI_GOVERNANCE_ADDRESS,
      mainnet: process.env.MAINNET_GOVERNANCE_ADDRESS,
      fuji: process.env.FUJI_GOVERNANCE_ADDRESS,
      avalanche: process.env.AVAX_GOVERNANCE_ADDRESS,
    },
    staker1: {
      default: 2,
    },
    staker2: {
      default: 3,
    },
    staker3: {
      default: 4,
    },
    feeRecipient: {
      default: 5,
    },
    tic: {
      fuji: "0x4767ba6cb821df0ae2621f8f4cca22c93ab75945",
      avalanche: "0x75739a693459f33B1FBcC02099eea3eBCF150cBe",
    },
    usdc: {
      fuji: "0x6275b63a4ee560004c34431e573314426906cee9",
      avalanche: "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664",
      mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
    ticUsdcELP: {
      fuji: "0x4ae1da57f2d6b2e9a23d07e264aa2b3bbcaed19a",
      avalanche: "0x4ae1da57f2d6b2e9a23d07e264aa2b3bbcaed19a",
    },
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
  },
  gasReporter: {
    enabled: false,
    currency: "USD",
  },
  etherscan: {
    // Your API key for Snowtrace
    // Obtain one at https://snowtrace.io/
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
