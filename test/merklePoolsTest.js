const { expect } = require("chai");
const { ethers, deployments, getNamedAccounts } = require("hardhat");
const exchangeArtifact = require("@elasticswap/elasticswap/artifacts/src/contracts/Exchange.sol/Exchange.json");

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
    );

    // Now we can finally deploy our merkle pool since we have all needed information!
    const MerklePools = await ethers.getContractFactory("MerklePools");
    merklePools = await MerklePools.deploy(
      ticToken.address,
      usdcToken.address,
      exchange.address,
      accounts[0].address
    );
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
    it("Can mint LP tokens", async () => {
      // clean start
      expect(await usdcToken.balanceOf(exchange.address)).to.eq(0);
      expect(await ticToken.balanceOf(exchange.address)).to.eq(0);

      // add approval for usdc
      await usdcToken.approve(
        merklePools.address,
        await usdcToken.balanceOf(accounts[0].address)
      );

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10); // TIC = $10USDC
      const expirationTimestamp = Math.round(Date.now() / 1000 + 60);
      await expect(
        merklePools.generateLPTokens(
          ticToBeMinted,
          usdcToAdd,
          ticToBeMinted.sub(1),
          usdcToAdd.sub(1),
          expirationTimestamp
        )
      ).to.emit(merklePools, "LPTokensGenerated");

      expect(await usdcToken.balanceOf(exchange.address)).to.not.eq(0);
      expect(await ticToken.balanceOf(exchange.address)).to.not.eq(0);
      expect(await exchange.balanceOf(merklePools.address)).to.not.eq(0);

      // add test to ensure we can add LP tokens now that initial price has been established.
    });
  });

  describe("getPoolTotalUnclaimed", () => {
    it.only("Handles 2 stakers in 1 pools correctly", async () => {
      const staker1 = accounts[2];
      const staker2 = accounts[3];

      // fresh wallet
      expect(await ticToken.balanceOf(staker1.address)).to.eq(0);
      expect(await ticToken.balanceOf(staker2.address)).to.eq(0);

      // transfer in TIC
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      const staker2TIC = ethers.utils.parseUnits("100", 18);
      await ticToken.mint(staker1.address, staker1TIC);
      await ticToken.mint(staker2.address, staker2TIC);
      expect(await ticToken.balanceOf(staker1.address)).to.eq(staker1TIC);
      expect(await ticToken.balanceOf(staker2.address)).to.eq(staker2TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC.div(2));

      await ticToken.connect(staker2).approve(merklePools.address, staker2TIC);
      await merklePools.connect(staker2).deposit(0, staker2TIC.div(2));

      expect(await merklePools.getPoolTotalDeposited(0)).to.eq(
        staker1TIC.add(staker2TIC).div(2)
      );

      expect(
        await merklePools.getStakeTotalDeposited(staker1.address, 0)
      ).to.eq(staker1TIC.div(2));
      expect(
        await merklePools.getStakeTotalDeposited(staker2.address, 0)
      ).to.eq(staker2TIC.div(2));

      // get current unclaimed amount
      const start = Math.round(Date.now() / 1000);
      const unclaimedAtStart = await merklePools.getPoolTotalUnclaimed(0);
      const elapsedTime = 60 * 60 * 24 * 365; // 1 year
      const endOfYear1 = start + elapsedTime;

      const poolRewardRate = await merklePools.getPoolRewardRate(0);
      const expectedUnclaimed = poolRewardRate.mul(elapsedTime);

      // advance block time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear1]);
      await ethers.provider.send("evm_mine");

      const unclaimedAtEndOfYear1 = await merklePools.getPoolTotalUnclaimed(0);
      const diff = expectedUnclaimed.sub(
        unclaimedAtEndOfYear1.sub(unclaimedAtStart)
      );
      expect(diff.lt(ethers.utils.parseUnits("10", 18))).to.be.true; // diff of less than 10 tokens in a year.

      // add more TIC to stake an ensure accounting still tracks
      await merklePools.connect(staker2).deposit(0, staker2TIC.div(2));
      const unclaimedAtStartOfYear2 = await merklePools.getPoolTotalUnclaimed(
        0
      );

      // advance block time
      const endOfYear2 = endOfYear1 + elapsedTime;
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear2]);
      await ethers.provider.send("evm_mine");

      const unclaimedAtEndOfYear2 = await merklePools.getPoolTotalUnclaimed(0);
      const diffAfterYear2 = expectedUnclaimed.sub(
        unclaimedAtEndOfYear2.sub(unclaimedAtStartOfYear2)
      );
      expect(diffAfterYear2.lt(ethers.utils.parseUnits("10", 18))).to.be.true; // diff of less than 10 tokens in a year.

      // TODO: enable merkle verification!

      // generate LP tokens so we can claim some!
      const ticToMint = unclaimedAtEndOfYear2.div(20); // 5% of rewards are going to be issued
      const ticPrice = 10;
      const usdcToAdd = ticToMint.div(ticPrice); 
      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd);
      await merklePools.generateLPTokens(0, ticToMint, usdcToAdd, ticToMint.sub(1), usdcToAdd.sub(1), endOfYear2+6000);
      const lpTokenBalance = await exchange.balanceOf(merklePools.address);
      const ticPerLP = ticToMint.div(lpTokenBalance);
      
      const staker2unclaimedTic = await merklePools.getStakeTotalUnclaimed(staker2.address, 0);
      const lpTokenForStaker2 = lpTokenBalance.mul(staker2unclaimedTic).div(unclaimedAtEndOfYear2);
      const ticConsumedFromStaker2 = lpTokenForStaker2.mul(ticPerLP);

      expect(await exchange.balanceOf(staker2.address)).to.equal(0);
      await merklePools.connect(staker2).claim(0, 0, lpTokenForStaker2, ticConsumedFromStaker2, []);
      expect(await exchange.balanceOf(staker2.address)).to.equal(lpTokenForStaker2);
    });
  });
});
