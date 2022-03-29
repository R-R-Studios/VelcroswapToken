const { expect } = require("chai");
const { ethers, deployments, getNamedAccounts } = require("hardhat");
const  exchangeArtifact = require("@elasticswap/elasticswap/artifacts/src/contracts/Exchange.sol/Exchange.json");

describe("MerklePools", () => {
  let accounts;
  let exchangeFactory;
  let ticToken;
  let usdcToken;
  let exchange;
  let merklePools;
  const rewardRate = ethers.utils.parseUnits("1", 18); // 1 TIC per second total!

  // configure relative weights for emissions of tokens (NOTE: ORDER MATTERS!)
  const poolWeights = {
    tic: 25,
    lp: 75,   
  };

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    await deployments.fixture();

    // 1. get exchange factory
    // 2. create a new TIC<>USDC exchange
    // 3. deploy the MerklePools
    // 4. create a new single sided staking pool with TIC
    // 5. create a new pool for ELP
    // 6. set weights and overall reward weight.

    const ExchangeFactory = await deployments.get("ExchangeFactory");
    exchangeFactory = new ethers.Contract(
      ExchangeFactory.address,
      ExchangeFactory.abi,
      accounts[0]
    );

    const QuoteToken = await deployments.get("QuoteToken"); // mock for USDC
    usdcToken = new ethers.Contract(
      QuoteToken.address,
      QuoteToken.abi,
      accounts[0]
    );

    const TicToken = await deployments.get("TicToken");
    ticToken = new ethers.Contract(TicToken.address, TicToken.abi, accounts[0]);

    await exchangeFactory.createNewExchange(
      ticToken.address,
      usdcToken.address
    );
    const exchangeAddress = await exchangeFactory.exchangeAddressByTokenAddress(
      ticToken.address,
      usdcToken.address
    );

    exchange = new ethers.Contract(
      exchangeAddress,
      exchangeArtifact.abi,
      accounts[0]
    )

    // Now we can finally deploy our merkle pool since we have all needed information!
    const MerklePools = await ethers.getContractFactory("MerklePools")
    merklePools = await MerklePools.deploy(ticToken.address, usdcToken.address, exchange.address, accounts[0].address);
    await merklePools.deployed();

    // create two pools
    await merklePools.createPool(ticToken.address);
    await merklePools.createPool(exchange.address);

    // set overall reward rate
    await merklePools.setRewardRate(rewardRate);

    // set pool weights
    await merklePools.setRewardWeights(Object.values(poolWeights));
  });

  describe("constructor", () => {
    it.only("Should do a thing", async () => {
      console.log(merklePools.address);
    });
  });
});
