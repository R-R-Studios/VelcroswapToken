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

    //grant merkle pool minter role
    const minterRole = await ticToken.MINTER_ROLE();
    await ticToken.grantRole(minterRole, merklePools.address);

    // grant the minter role to account[0] so we can mint tokens freely for tests
    await ticToken.grantRole(minterRole, accounts[0].address);
  });

  describe("constructor", () => {
    it("Properly sets initial variables", async () => {
      expect(await merklePools.baseToken()).to.eq(ticToken.address);
      expect(await merklePools.quoteToken()).to.eq(usdcToken.address);
      expect(await merklePools.elasticLPToken()).to.eq(exchange.address);
      expect(await merklePools.governance()).to.eq(accounts[0].address);
    });
  });

  describe("generateLPTokens", () => {
    it("Can mint LP tokens", async() => {
      // clean start
      expect(await usdcToken.balanceOf(exchange.address)).to.eq(0);
      expect(await ticToken.balanceOf(exchange.address)).to.eq(0);

      // add approval for usdc
      await usdcToken.approve(merklePools.address, await usdcToken.balanceOf(accounts[0].address));

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10);  // TIC = $10USDC
      const expirationTimestamp = Math.round(Date.now() / 1000 + 60);
      await expect(merklePools.generateLPTokens(
        ticToBeMinted,
        usdcToAdd,
        ticToBeMinted.sub(1),
        usdcToAdd.sub(1),
        expirationTimestamp
      )).to.emit(merklePools, "LPTokensGenerated");

      expect(await usdcToken.balanceOf(exchange.address)).to.not.eq(0);
      expect(await ticToken.balanceOf(exchange.address)).to.not.eq(0);
      expect(await exchange.balanceOf(merklePools.address)).to.not.eq(0);

      // add test to ensure we can add LP tokens now that initial price has been established.
    })
  })

  describe("deposit", () => {
    it.only("Handles 2 stakers in 1 pools correctly", async () => {
      const staker1 = accounts[2];
      const staker2 = accounts[3];

      // fresh wallet
      expect(await ticToken.balanceOf(staker1.address)).to.eq(0);
      expect(await ticToken.balanceOf(staker2.address)).to.eq(0);

      // transfer in TIC
      const staker1TIC = ethers.utils.parseUnits("100", 18); 
      const staker2TIC = ethers.utils.parseUnits("50", 18); 
      await ticToken.mint(staker1.address, staker1TIC);
      await ticToken.mint(staker2.address, staker2TIC);
      expect(await ticToken.balanceOf(staker1.address)).to.eq(staker1TIC);
      expect(await ticToken.balanceOf(staker2.address)).to.eq(staker2TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);

      await ticToken.connect(staker2).approve(merklePools.address, staker2TIC);
      await merklePools.connect(staker2).deposit(0, staker2TIC);

      expect(await merklePools.getPoolTotalDeposited(0)).to.eq(staker1TIC.add(staker2TIC));

      expect(await merklePools.getStakeTotalDeposited(staker1.address, 0)).to.eq(staker1TIC);
      expect(await merklePools.getStakeTotalDeposited(staker2.address, 0)).to.eq(staker2TIC);

      console.log(await merklePools.getPool(0));



    });

  });


});
