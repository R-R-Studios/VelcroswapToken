require("@nomiclabs/hardhat-waffle");
require("hardhat-contract-sizer");
require("hardhat-gas-reporter");
require("hardhat-deploy");
require("solidity-coverage");
require("dotenv").config();

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
        runs: 100000,
      },
    },
  },
  networks: {
    hardhat: {
      deploy: ["deploy"],
    },
    goerli: {
      deploy: ["deploy/core", "deploy/testnet"],
      url: process.env.GOERLI_URL,
      accounts:
        process.env.GOERLI_PRIVATE_KEY !== undefined ? [process.env.GOERLI_PRIVATE_KEY] : [],
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
      mainnet: process.env.MAINNET_GOVERNANCE_ADDRESS
    },
    liquidityProvider2: {
      default: 2,
    },
    trader1: {
      default: 3,
    },
    trader2: {
      default: 4,
    },
    feeRecipient: {
      default: 5,
    },
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
};
