const { expect } = require("chai");
const { ethers, deployments, upgrades } = require("hardhat");
const exchangeArtifact = require("@elasticswap/elasticswap/artifacts/src/contracts/Exchange.sol/Exchange.json");

const { BalanceTree } = require("../src/utils/BalanceTree");

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const TREE_FILL = {
  account: 0x0,
  poolId: 0,
  totalLPTokenAmount: 0,
  totalTICAmount: 0,
};

describe("MerklePoolsForeign", () => {
  let accounts;
  let exchangeFactory;
  let ticToken;
  let usdcToken;
  let exchange;
  let merklePools;
  let rewardRate;

  // configure relative weights for emissions of tokens (NOTE: ORDER MATTERS!)
  const poolWeights = {
    tic: 25,
    lp: 75,
  };

  beforeEach(async () => {
    rewardRate = ethers.utils.parseUnits("1", 18); // 1 TIC per second total!
    accounts = await ethers.getSigners();
    await deployments.fixture();

    // 1. get exchange factory
    // 2. create a new TIC<>USDC exchange
    // 3. deploy the MerklePoolsForeign (without TIC or ELP)
    // 4. create a new single sided staking pool with TIC
    // 5. create a new pool for ELP
    // 6. set weights and overall reward weight.
    // 7. test to make sure we can set these later.

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
    const MerklePoolsForeign = await ethers.getContractFactory(
      "MerklePoolsForeign"
    );
    merklePools = await upgrades.deployProxy(MerklePoolsForeign, [
      ethers.constants.AddressZero, // ticToken.address,
      usdcToken.address,
      ethers.constants.AddressZero, // exchange
      accounts[0].address,
      accounts[0].address,
    ]);
    await merklePools.deployed();

    // create two pools
    await merklePools.createPool(ticToken.address);
    await merklePools.createPool(exchange.address);

    // set overall reward rate
    await merklePools.setRewardRate(rewardRate);

    // set pool weights
    await merklePools.setRewardWeights(Object.values(poolWeights));

    // grant the minter role to account[0] so we can mint tokens freely for tests
    const minterRole = await ticToken.MINTER_ROLE();
    await ticToken.grantRole(minterRole, accounts[0].address);
  });

  describe("Initialize", () => {
    it("Properly sets initial variables", async () => {
      expect(await merklePools.ticToken()).to.eq(ethers.constants.AddressZero);
      expect(await merklePools.quoteToken()).to.eq(usdcToken.address);
      expect(await merklePools.elasticLPToken()).to.eq(
        ethers.constants.AddressZero
      );
      expect(await merklePools.governance()).to.eq(accounts[0].address);
    });
  });

  describe("setTicTokenAddress", () => {
    it("Can set the Tic address and needed approval", async () => {
      expect(await merklePools.ticToken()).to.eq(ethers.constants.AddressZero);
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      expect(await merklePools.ticToken()).to.eq(ticToken.address);
      expect(
        await ticToken.allowance(merklePools.address, exchange.address)
      ).to.eq(ethers.constants.MaxUint256);
    });
  });

  describe("setElasticLPTokenAddress", () => {
    it("Can set the elastic LP token address and needed approval from the quote", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      expect(await merklePools.elasticLPToken()).to.eq(exchange.address);
      expect(
        await usdcToken.allowance(merklePools.address, exchange.address)
      ).to.eq(ethers.constants.MaxUint256);
    });
  });

  describe("generateLPTokens", () => {
    it("can mint LP tokens", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);

      // clean start
      expect(await usdcToken.balanceOf(exchange.address)).to.eq(0);
      expect(await ticToken.balanceOf(exchange.address)).to.eq(0);
      const staker1 = accounts[2];
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);
      await ticToken.mint(
        accounts[0].address,
        ethers.utils.parseUnits("200", 18)
      );

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);

      // add approval for usdc
      await usdcToken.approve(
        merklePools.address,
        await usdcToken.balanceOf(accounts[0].address)
      );
      // add approval tic
      await ticToken.approve(
        merklePools.address,
        await ticToken.balanceOf(accounts[0].address)
      );

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10); // TIC = $10USDC

      const start = Math.round(Date.now() / 1000);
      const futureTime = start + 60 * 60 * 60 * 24 * 365;
      const expirationTimestamp = futureTime + 600;

      await ethers.provider.send("evm_setNextBlockTimestamp", [futureTime]);
      await ethers.provider.send("evm_mine");

      await expect(
        merklePools.generateLPTokens(
          0,
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

    it("it can handle slippage", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);

      // clean start
      const staker1 = accounts[2];
      const staker1TIC = ethers.utils.parseUnits("400", 18);
      await ticToken.mint(accounts[0].address, staker1TIC);
      await ticToken.mint(staker1.address, staker1TIC);
      await ticToken.mint(
        accounts[0].address,
        ethers.utils.parseUnits("200", 18)
      );

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);

      // add approval for usdc
      await usdcToken.approve(
        merklePools.address,
        await usdcToken.balanceOf(accounts[0].address)
      );
      // add approval tic
      await ticToken.approve(
        merklePools.address,
        await ticToken.balanceOf(accounts[0].address)
      );

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10); // TIC = $10USDC

      const start = Math.round(Date.now() / 1000);
      const futureTime = start + 60 * 60 * 60 * 24 * 365;
      const expirationTimestamp = futureTime + 600;

      await ethers.provider.send("evm_setNextBlockTimestamp", [futureTime]);
      await ethers.provider.send("evm_mine");

      await ticToken.approve(exchange.address, staker1TIC);
      await usdcToken.approve(exchange.address, staker1TIC);
      await exchange.addLiquidity(
        ticToBeMinted.sub(ethers.utils.parseUnits("3", 18)),
        usdcToAdd.sub(ethers.utils.parseUnits("10", 18)),
        0,
        0,
        accounts[0].address,
        expirationTimestamp
      );

      const ticBalanceBeforeGenerate = await ticToken.balanceOf(
        accounts[0].address
      );
      await merklePools.generateLPTokens(
        0,
        ticToBeMinted,
        usdcToAdd,
        ticToBeMinted.sub(ethers.utils.parseUnits("5", 18)),
        usdcToAdd.sub(ethers.utils.parseUnits("50", 18)),
        expirationTimestamp
      );
      const ticBalanceAfterGenerate = await ticToken.balanceOf(
        accounts[0].address
      );
      expect(await usdcToken.balanceOf(merklePools.address)).to.equal(0);
      expect(
        ticToBeMinted.gt(ticBalanceBeforeGenerate.sub(ticBalanceAfterGenerate))
      ).to.be.true;
    });

    it("it sends back extra quote token", async () => {
      // clean start
      const staker1 = accounts[2];
      const staker1TIC = ethers.utils.parseUnits("400", 18);
      await ticToken.mint(accounts[0].address, staker1TIC);
      await ticToken.mint(staker1.address, staker1TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);

      // add approval for usdc
      await usdcToken.approve(
        merklePools.address,
        await usdcToken.balanceOf(accounts[0].address)
      );

      // add approval tic
      await ticToken.approve(
        merklePools.address,
        await ticToken.balanceOf(accounts[0].address)
      );

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10); // TIC = $10USDC

      const start = Math.round(Date.now() / 1000);
      const futureTime = start + 60 * 60 * 60 * 24 * 365;
      const expirationTimestamp = futureTime + 600;

      await ethers.provider.send("evm_setNextBlockTimestamp", [futureTime]);
      await ethers.provider.send("evm_mine");

      await ticToken.approve(exchange.address, staker1TIC);
      await usdcToken.approve(exchange.address, staker1TIC);
      await exchange.addLiquidity(
        ticToBeMinted.sub(ethers.utils.parseUnits("3", 18)),
        usdcToAdd.sub(ethers.utils.parseUnits("10", 18)),
        0,
        0,
        accounts[0].address,
        expirationTimestamp
      );

      // add a bunch of extra usdc
      const usdcBalBefore = await usdcToken.balanceOf(accounts[0].address);
      const usdcToSendIn = usdcToAdd.add(ethers.utils.parseUnits("500", 18));

      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);

      await merklePools.generateLPTokens(
        0,
        ticToBeMinted,
        usdcToSendIn,
        ticToBeMinted.sub(ethers.utils.parseUnits("10", 18)),
        usdcToAdd.sub(ethers.utils.parseUnits("50", 18)),
        expirationTimestamp
      );
      // ensure its all sent back
      expect(await usdcToken.balanceOf(merklePools.address)).to.equal(0);
      const usdcBalAfter = await usdcToken.balanceOf(accounts[0].address);
      // change in balance is less than we sent in, we got refunded!
      expect(usdcBalBefore.sub(usdcBalAfter).lt(usdcToSendIn)).to.be.true;
    });

    it("fails from non governance address", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);

      // clean start
      const staker1 = accounts[2];
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);

      // add approval for usdc
      await usdcToken.approve(
        merklePools.address,
        await usdcToken.balanceOf(accounts[0].address)
      );
      // add approval tic
      await ticToken.approve(
        merklePools.address,
        await ticToken.balanceOf(accounts[0].address)
      );

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10); // TIC = $10USDC

      const start = Math.round(Date.now() / 1000);
      const futureTime = start + 60 * 60 * 60 * 24 * 365;
      const expirationTimestamp = futureTime + 600;

      await ethers.provider.send("evm_setNextBlockTimestamp", [futureTime]);
      await ethers.provider.send("evm_mine");

      await expect(
        merklePools
          .connect(staker1)
          .generateLPTokens(
            0,
            ticToBeMinted,
            usdcToAdd,
            ticToBeMinted.sub(1),
            usdcToAdd.sub(1),
            expirationTimestamp
          )
      ).to.be.revertedWith("MerklePools: ONLY_GOVERNANCE");
    });

    it("fails to mint more than outstanding unclaimed TIC in pool", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);

      // clean start
      const staker1 = accounts[2];
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);

      // add approval for usdc
      await usdcToken.approve(
        merklePools.address,
        await usdcToken.balanceOf(accounts[0].address)
      );
      // add approval tic
      await ticToken.approve(
        merklePools.address,
        await ticToken.balanceOf(accounts[0].address)
      );

      const usdcToAdd = ethers.utils.parseUnits("100", 18);

      const start = Math.round(Date.now() / 1000);
      const futureTime = start + 60 * 60 * 60 * 24 * 365;
      const expirationTimestamp = futureTime + 600;

      await ethers.provider.send("evm_setNextBlockTimestamp", [futureTime]);
      await ethers.provider.send("evm_mine");

      const ticToBeMinted = (await merklePools.getPoolTotalUnclaimed(0)).add(
        ethers.utils.parseUnits("10", 18)
      );

      await expect(
        merklePools.generateLPTokens(
          0,
          ticToBeMinted,
          usdcToAdd,
          ticToBeMinted.sub(1),
          usdcToAdd.sub(1),
          expirationTimestamp
        )
      ).to.be.revertedWith("MerklePools: NSF_UNCLAIMED");
    });

    it("fails for non existent pool", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);

      // clean start
      const staker1 = accounts[2];
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);

      // add approval for usdc
      await usdcToken.approve(
        merklePools.address,
        await usdcToken.balanceOf(accounts[0].address)
      );
      // add approval tic
      await ticToken.approve(
        merklePools.address,
        await ticToken.balanceOf(accounts[0].address)
      );

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10); // TIC = $10USDC

      const start = Math.round(Date.now() / 1000);
      const futureTime = start + 60 * 60 * 60 * 24 * 365;
      const expirationTimestamp = futureTime + 600;

      await ethers.provider.send("evm_setNextBlockTimestamp", [futureTime]);
      await ethers.provider.send("evm_mine");

      await expect(
        merklePools.generateLPTokens(
          2,
          ticToBeMinted,
          usdcToAdd,
          ticToBeMinted.sub(1),
          usdcToAdd.sub(1),
          expirationTimestamp
        )
      ).to.be.revertedWith("MerklePool: INVALID_INDEX");
    });
  });

  describe("getPoolTotalUnclaimed", () => {
    it("Handles 2 stakers in 1 pools correctly", async () => {
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

      // generate LP tokens so we can claim some!
      const ticToMint = unclaimedAtEndOfYear2.div(20); // 5% of rewards are going to be issued
      const ticPrice = 10;
      const usdcToAdd = ticToMint.div(ticPrice);

      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd);

      // add approval tic
      await ticToken.approve(merklePools.address, ticToMint);
      await ticToken.mint(accounts[0].address, ticToMint);

      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      await merklePools.generateLPTokens(
        0,
        ticToMint,
        usdcToAdd,
        ticToMint.sub(1),
        usdcToAdd.sub(1),
        endOfYear2 + 6000
      );

      const lpTokenBalance = await exchange.balanceOf(merklePools.address);
      const ticPerLP = ticToMint.div(lpTokenBalance);

      let staker2unclaimedTic = await merklePools.getStakeTotalUnclaimed(
        staker2.address,
        0
      );
      let staker1unclaimedTic = await merklePools.getStakeTotalUnclaimed(
        staker1.address,
        0
      );
      const unclaimedTotalsFromStakers =
        staker1unclaimedTic.add(staker2unclaimedTic);

      const lpTokenForStaker2 = lpTokenBalance
        .mul(staker2unclaimedTic)
        .div(unclaimedTotalsFromStakers);
      const lpTokenForStaker1 = lpTokenBalance
        .mul(staker1unclaimedTic)
        .div(unclaimedTotalsFromStakers);

      const ticConsumedFromStaker2 = lpTokenForStaker2.mul(ticPerLP);
      const ticConsumedFromStaker1 = lpTokenForStaker1.mul(ticPerLP);

      expect(await exchange.balanceOf(staker2.address)).to.equal(0);

      // generate the tree
      const tree1 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenForStaker1,
          totalTICAmount: ticConsumedFromStaker1,
        },
        {
          account: staker2.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenForStaker2,
          totalTICAmount: ticConsumedFromStaker2,
        },
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree1.getHexRoot());

      const proof1 = tree1.getProof(
        1,
        staker2.address,
        0,
        lpTokenForStaker2,
        ticConsumedFromStaker2
      );

      await merklePools
        .connect(staker2)
        .claim(1, 0, lpTokenForStaker2, ticConsumedFromStaker2, proof1);

      expect(await exchange.balanceOf(staker2.address)).to.equal(
        lpTokenForStaker2
      );
      const diffFromExpectedUnclaimed = (
        await merklePools.getStakeTotalUnclaimed(staker2.address, 0)
      ).sub(staker2unclaimedTic.sub(ticConsumedFromStaker2));
      expect(diffFromExpectedUnclaimed.lt(ethers.utils.parseUnits("1", 18))).to
        .be.true; // diff of less than 1 tokens

      // check global counts next
      const unclaimedAfterClaim = await merklePools.getPoolTotalUnclaimed(0);
      const diffFromGlobalUnclaimed = unclaimedAfterClaim.sub(
        unclaimedAtEndOfYear2.sub(ticConsumedFromStaker2)
      );

      expect(diffFromGlobalUnclaimed.lte(ethers.utils.parseUnits("2", 18))).to
        .be.true; // diff of less than 2 tokens

      // have staker1 claim the rest of the available LP
      expect(await exchange.balanceOf(staker1.address)).to.equal(0);

      const proof0 = tree1.getProof(
        0,
        staker1.address,
        0,
        lpTokenForStaker1,
        ticConsumedFromStaker1
      );

      await merklePools
        .connect(staker1)
        .claim(0, 0, lpTokenForStaker1, ticConsumedFromStaker1, proof0);

      expect(await exchange.balanceOf(staker1.address)).to.equal(
        lpTokenForStaker1
      );
      expect(
        (await exchange.balanceOf(merklePools.address)).lt(
          ethers.utils.parseUnits("1", 18)
        )
      ).to.be.true; // diff of less than 1 tokens

      // we have no stakers left, but still have unclaimed rewards, generate them and claim!
      const totalUnclaimed = await merklePools.getPoolTotalUnclaimedNotInLP(0);
      staker1unclaimedTic = await merklePools.getStakeTotalUnclaimed(
        staker1.address,
        0
      );
      staker2unclaimedTic = await merklePools.getStakeTotalUnclaimed(
        staker2.address,
        0
      );
      expect(
        totalUnclaimed
          .sub(staker1unclaimedTic.add(staker2unclaimedTic))
          .lt(ethers.utils.parseUnits("2", 18))
      ).to.be.true;

      const ticToMint2 = totalUnclaimed;
      const usdcToAdd2 = ticToMint2.div(ticPrice);
      await usdcToken.approve(merklePools.address, usdcToAdd2);
      await ticToken.mint(accounts[0].address, ticToMint2);
      await ticToken.approve(merklePools.address, ticToMint2);
      await merklePools.generateLPTokens(
        0,
        ticToMint2,
        usdcToAdd2,
        ticToMint2.sub(1),
        usdcToAdd2.sub(1),
        endOfYear2 + 6000
      );
      const lpTokensToDistro = await exchange.balanceOf(merklePools.address);
      const totalUnclaimedInStakes =
        staker1unclaimedTic.add(staker2unclaimedTic);

      const lptTokensTotalForStaker1 = lpTokenForStaker1.add(
        lpTokensToDistro.mul(staker1unclaimedTic).div(totalUnclaimedInStakes)
      );
      const lptTokensTotalForStaker2 = lpTokenForStaker2.add(
        lpTokensToDistro.mul(staker2unclaimedTic).div(totalUnclaimedInStakes)
      );

      expect(
        (await merklePools.getPoolTotalUnclaimedNotInLP(0)).lt(
          ethers.utils.parseUnits("2", 18)
        )
      ).to.be.true;

      // generate the tree
      const tree2 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lptTokensTotalForStaker1,
          totalTICAmount: ticConsumedFromStaker1.add(staker1unclaimedTic),
        },
        {
          account: staker2.address,
          poolId: 0,
          totalLPTokenAmount: lptTokensTotalForStaker2,
          totalTICAmount: ticConsumedFromStaker2.add(staker2unclaimedTic),
        },
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree2.getHexRoot());

      // generate proof
      const proof3 = tree2.getProof(
        0,
        staker1.address,
        0,
        lptTokensTotalForStaker1,
        ticConsumedFromStaker1.add(staker1unclaimedTic)
      );

      const proof4 = tree2.getProof(
        1,
        staker2.address,
        0,
        lptTokensTotalForStaker2,
        ticConsumedFromStaker2.add(staker2unclaimedTic)
      );

      await merklePools
        .connect(staker1)
        .claim(
          0,
          0,
          lptTokensTotalForStaker1,
          ticConsumedFromStaker1.add(staker1unclaimedTic),
          proof3
        );
      await merklePools
        .connect(staker2)
        .claim(
          1,
          0,
          lptTokensTotalForStaker2,
          ticConsumedFromStaker2.add(staker2unclaimedTic),
          proof4
        );

      expect(
        (await merklePools.getPoolTotalUnclaimedNotInLP(0)).lt(
          ethers.utils.parseUnits("2", 18)
        )
      ).to.be.true;
      expect(
        (await merklePools.getPoolTotalUnclaimed(0)).lt(
          ethers.utils.parseUnits("5", 18)
        )
      ).to.be.true;

      // fast forward again
      // advance block time
      const endOfYear3 = endOfYear2 + elapsedTime;
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear3]);
      await ethers.provider.send("evm_mine");

      expect(
        await merklePools.getStakeTotalDeposited(
          await merklePools.forfeitAddress(),
          0
        )
      ).to.equal(0);
      expect(
        await merklePools.getStakeTotalUnclaimed(
          await merklePools.forfeitAddress(),
          0
        )
      ).to.equal(0);

      // have both stakers exit
      await merklePools.connect(staker1).exit(0);
      await merklePools.connect(staker2).exit(0);

      expect(
        await merklePools.getStakeTotalDeposited(staker1.address, 0)
      ).to.equal(0);
      expect(
        await merklePools.getStakeTotalDeposited(staker2.address, 0)
      ).to.equal(0);
      expect(await merklePools.getPoolTotalDeposited(0)).to.eq(0);
      expect(await ticToken.balanceOf(merklePools.address)).to.equal(0);

      // the forfeit address should now have unclaimed tokens!
      expect(
        await merklePools.getStakeTotalDeposited(
          await merklePools.forfeitAddress(),
          0
        )
      ).to.equal(0);
      const forfeitUnclaimed = await merklePools.getStakeTotalUnclaimed(
        await merklePools.forfeitAddress(),
        0
      );
      expect(forfeitUnclaimed).to.not.equal(0);

      const ticToMint3 = await merklePools.getPoolTotalUnclaimedNotInLP(0);
      const usdcToAdd3 = ticToMint3.div(ticPrice);
      await usdcToken.approve(merklePools.address, usdcToAdd3);
      await ticToken.mint(accounts[0].address, ticToMint3);
      await ticToken.approve(merklePools.address, ticToMint3);
      await merklePools.generateLPTokens(
        0,
        ticToMint3,
        usdcToAdd3,
        ticToMint3.sub(1),
        usdcToAdd3.sub(1),
        endOfYear3 + 6000
      );

      // let's mint some and see if they can be claimed.
      expect(await exchange.balanceOf(accounts[0].address)).to.equal(0);
      const balanceToClaim = await exchange.balanceOf(merklePools.address);

      // generate the tree
      const tree3 = new BalanceTree([
        {
          account: accounts[0].address,
          poolId: 0,
          totalLPTokenAmount: await exchange.balanceOf(merklePools.address),
          totalTICAmount: forfeitUnclaimed,
        },
        TREE_FILL,
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree3.getHexRoot());

      // generate proof
      const proof5 = tree3.getProof(
        0,
        accounts[0].address,
        0,
        await exchange.balanceOf(merklePools.address),
        forfeitUnclaimed
      );

      await merklePools.claim(
        0,
        0,
        await exchange.balanceOf(merklePools.address),
        forfeitUnclaimed,
        proof5
      );
      expect(await exchange.balanceOf(accounts[0].address)).to.equal(
        balanceToClaim
      );
    });
  });

  describe("setMerkleRoot", () => {
    let tree;

    beforeEach(async () => {
      tree = new BalanceTree([
        {
          account: accounts[1].address,
          poolId: 0,
          totalLPTokenAmount: ethers.BigNumber.from(100),
          totalTICAmount: ethers.BigNumber.from(10000),
        },
        {
          account: accounts[2].address,
          poolId: 0,
          totalLPTokenAmount: ethers.BigNumber.from(150),
          totalTICAmount: ethers.BigNumber.from(15000),
        },
        {
          account: accounts[3].address,
          poolId: 0,
          totalLPTokenAmount: ethers.BigNumber.from(150),
          totalTICAmount: ethers.BigNumber.from(15000),
        },
      ]);
    });

    it("can be set by owner", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      expect(await merklePools.merkleRoot()).to.be.equal(ZERO_BYTES32);
      await merklePools.setMerkleRoot(tree.getHexRoot());
      expect(await merklePools.merkleRoot()).to.be.equal(tree.getHexRoot());
    });

    it("reverts when set by non owner", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      await expect(
        merklePools.connect(accounts[1]).setMerkleRoot(tree.getHexRoot())
      ).to.be.revertedWith("MerklePools: ONLY_GOVERNANCE");
    });

    it("emits MerkleRootUpdated", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      await expect(await merklePools.setMerkleRoot(tree.getHexRoot()))
        .to.emit(merklePools, "MerkleRootUpdated")
        .withArgs(tree.getHexRoot());
    });
  });

  describe("setRewardRates", () => {
    it("works correctly if staker stakes before first configuration", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      const staker1 = accounts[1];
      const MerklePools = await ethers.getContractFactory("MerklePools");
      const merklePools1 = await upgrades.deployProxy(MerklePools, [
        ticToken.address,
        usdcToken.address,
        exchange.address,
        accounts[0].address,
        accounts[0].address,
      ]);
      await merklePools1.deployed();

      // create pool
      await merklePools1.createPool(ticToken.address);
      await merklePools1.createPool(exchange.address);

      // stake prior to any weights being set.
      const amount = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, amount);
      await ticToken.connect(staker1).approve(merklePools1.address, amount);
      await merklePools1.connect(staker1).deposit(0, amount);

      const next = Math.round(Date.now() / 1000) + 3600;
      await ethers.provider.send("evm_setNextBlockTimestamp", [next]);
      await ethers.provider.send("evm_mine");
      await merklePools1.setRewardWeights([100, 100]);
      expect(await merklePools1.getPoolRewardWeight(0)).to.eq(100);
      expect(await merklePools1.getPoolRewardWeight(1)).to.eq(100);
    });
  });

  describe("claim", () => {
    it("emits TokensClaimed with correct variables", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);

      const staker1 = accounts[2];
      // transfer in TIC
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC.div(2));

      // get current unclaimed amount
      const start = Math.round(Date.now() / 1000);
      const elapsedTime = 60 * 60 * 24 * 365; // 1 year
      const endOfYear1 = start + elapsedTime;

      // advance block time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear1]);
      await ethers.provider.send("evm_mine");
      const unclaimedAtEndOfYear1 = await merklePools.getPoolTotalUnclaimed(0);

      // generate LP tokens so we can claim some!
      const ticPrice = 10;
      const usdcToAdd = unclaimedAtEndOfYear1.div(ticPrice);
      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd);
      await ticToken.approve(merklePools.address, unclaimedAtEndOfYear1);
      await ticToken.mint(accounts[0].address, unclaimedAtEndOfYear1);
      await merklePools.generateLPTokens(
        0,
        unclaimedAtEndOfYear1,
        usdcToAdd,
        unclaimedAtEndOfYear1.sub(1),
        usdcToAdd.sub(1),
        endOfYear1 + 6000
      );

      const lpTokenBalance = await exchange.balanceOf(merklePools.address);
      // generate the tree
      const tree1 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenBalance,
          totalTICAmount: unclaimedAtEndOfYear1,
        },
        TREE_FILL,
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree1.getHexRoot());
      const proof1 = tree1.getProof(
        0,
        staker1.address,
        0,
        lpTokenBalance,
        unclaimedAtEndOfYear1
      );

      await expect(
        await merklePools
          .connect(staker1)
          .claim(0, 0, lpTokenBalance, unclaimedAtEndOfYear1, proof1)
      )
        .to.emit(merklePools, "TokensClaimed")
        .withArgs(staker1.address, 0, 0, lpTokenBalance, unclaimedAtEndOfYear1);
    });

    it("fails with invalid proofs", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
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

      // get current unclaimed amount
      const start = Math.round(Date.now() / 1000);
      const elapsedTime = 60 * 60 * 24 * 365; // 1 year
      const endOfYear1 = start + elapsedTime;

      // advance block time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear1]);
      await ethers.provider.send("evm_mine");

      const unclaimedAtEndOfYear1 = await merklePools.getPoolTotalUnclaimed(0);

      // generate LP tokens so we can claim some!
      const ticPrice = 10;
      const usdcToAdd = unclaimedAtEndOfYear1.div(ticPrice);
      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd);
      await ticToken.approve(merklePools.address, unclaimedAtEndOfYear1);
      await ticToken.mint(accounts[0].address, unclaimedAtEndOfYear1);
      await merklePools.generateLPTokens(
        0,
        unclaimedAtEndOfYear1,
        usdcToAdd,
        unclaimedAtEndOfYear1.sub(1),
        usdcToAdd.sub(1),
        endOfYear1 + 6000
      );

      const lpTokenBalance = await exchange.balanceOf(merklePools.address);
      const ticPerLP = unclaimedAtEndOfYear1.div(lpTokenBalance);

      const staker2unclaimedTic = await merklePools.getStakeTotalUnclaimed(
        staker2.address,
        0
      );
      const staker1unclaimedTic = await merklePools.getStakeTotalUnclaimed(
        staker1.address,
        0
      );
      const unclaimedTotalsFromStakers =
        staker1unclaimedTic.add(staker2unclaimedTic);

      const lpTokenForStaker2 = lpTokenBalance
        .mul(staker2unclaimedTic)
        .div(unclaimedTotalsFromStakers);
      const lpTokenForStaker1 = lpTokenBalance
        .mul(staker1unclaimedTic)
        .div(unclaimedTotalsFromStakers);

      const ticConsumedFromStaker2 = lpTokenForStaker2.mul(ticPerLP);
      const ticConsumedFromStaker1 = lpTokenForStaker1.mul(ticPerLP);

      expect(await exchange.balanceOf(staker2.address)).to.equal(0);

      // generate the tree
      const tree1 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenForStaker1,
          totalTICAmount: ticConsumedFromStaker1,
        },
        {
          account: staker2.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenForStaker2,
          totalTICAmount: ticConsumedFromStaker2,
        },
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree1.getHexRoot());

      const proof1 = tree1.getProof(
        1,
        staker2.address,
        0,
        lpTokenForStaker2,
        ticConsumedFromStaker2
      );

      await expect(
        merklePools
          .connect(staker1)
          .claim(1, 0, lpTokenForStaker2, ticConsumedFromStaker2, proof1)
      ).to.be.revertedWith("MerklePools: INVALID_PROOF");

      await expect(
        merklePools
          .connect(staker2)
          .claim(
            1,
            0,
            lpTokenForStaker2.add(100),
            ticConsumedFromStaker2,
            proof1
          )
      ).to.be.revertedWith("MerklePools: INVALID_PROOF");

      await expect(
        merklePools
          .connect(staker2)
          .claim(1, 0, lpTokenForStaker2, ticConsumedFromStaker2, [])
      ).to.be.revertedWith("MerklePools: INVALID_PROOF");

      await expect(
        merklePools
          .connect(staker2)
          .claim(1, 1, lpTokenForStaker2, ticConsumedFromStaker2, proof1)
      ).to.be.revertedWith("MerklePools: INVALID_PROOF");

      await merklePools.setMerkleRoot(ZERO_BYTES32);

      await expect(
        merklePools
          .connect(staker2)
          .claim(1, 0, lpTokenForStaker2, ticConsumedFromStaker2, proof1)
      ).to.be.revertedWith("MerklePools: INVALID_PROOF");

      await merklePools.setMerkleRoot(tree1.getHexRoot());

      await merklePools
        .connect(staker2)
        .claim(1, 0, lpTokenForStaker2, ticConsumedFromStaker2, proof1);
    });

    it("fails before proof is set", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      const staker1 = accounts[2];
      // transfer in TIC
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC.div(2));

      // get current unclaimed amount
      const start = Math.round(Date.now() / 1000);
      const elapsedTime = 60 * 60 * 24 * 365; // 1 year
      const endOfYear1 = start + elapsedTime;

      // advance block time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear1]);
      await ethers.provider.send("evm_mine");
      const unclaimedAtEndOfYear1 = await merklePools.getPoolTotalUnclaimed(0);

      // generate LP tokens so we can claim some!
      const ticPrice = 10;
      const usdcToAdd = unclaimedAtEndOfYear1.div(ticPrice);
      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd);
      await ticToken.approve(merklePools.address, unclaimedAtEndOfYear1);
      await ticToken.mint(accounts[0].address, unclaimedAtEndOfYear1);
      await merklePools.generateLPTokens(
        0,
        unclaimedAtEndOfYear1,
        usdcToAdd,
        unclaimedAtEndOfYear1.sub(1),
        usdcToAdd.sub(1),
        endOfYear1 + 6000
      );

      const lpTokenBalance = await exchange.balanceOf(merklePools.address);
      // generate the tree
      const tree1 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenBalance,
          totalTICAmount: unclaimedAtEndOfYear1,
        },
        TREE_FILL,
      ]);

      const proof1 = tree1.getProof(
        0,
        staker1.address,
        0,
        lpTokenBalance,
        unclaimedAtEndOfYear1
      );

      await expect(
        merklePools
          .connect(staker1)
          .claim(0, 0, lpTokenBalance, unclaimedAtEndOfYear1, proof1)
      ).to.be.revertedWith("MerklePools: CLAIMS_DISABLED");

      const tree2 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 1,
          totalLPTokenAmount: lpTokenBalance,
          totalTICAmount: unclaimedAtEndOfYear1,
        },
        TREE_FILL,
      ]);

      await merklePools.setMerkleRoot(tree2.getHexRoot());
      await expect(
        merklePools
          .connect(staker1)
          .claim(0, 0, lpTokenBalance, unclaimedAtEndOfYear1, proof1)
      ).to.be.revertedWith("MerklePools: INVALID_PROOF");

      await merklePools.setMerkleRoot(ZERO_BYTES32);
      await expect(
        merklePools
          .connect(staker1)
          .claim(0, 0, lpTokenBalance, unclaimedAtEndOfYear1, proof1)
      ).to.be.revertedWith("MerklePools: INVALID_PROOF");

      await merklePools.setMerkleRoot(tree1.getHexRoot());
      await merklePools
        .connect(staker1)
        .claim(0, 0, lpTokenBalance, unclaimedAtEndOfYear1, proof1);
      expect(await exchange.balanceOf(staker1.address)).to.equal(
        lpTokenBalance
      );
    });

    it("transfers correct token amount for successive claims", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      const staker1 = accounts[2];
      // transfer in TIC
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);

      // stake tic
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC.div(2));

      // get current unclaimed amount
      const start = Math.round(Date.now() / 1000);
      const elapsedTime = 60 * 60 * 24 * 365; // 1 year
      const endOfYear1 = start + elapsedTime;

      // advance block time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear1]);
      await ethers.provider.send("evm_mine");
      const unclaimedAtEndOfYear1 = await merklePools.getPoolTotalUnclaimed(0);

      // generate LP tokens so we can claim some!
      const ticPrice = 10;
      const usdcToAdd = unclaimedAtEndOfYear1.div(ticPrice);
      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd);
      await ticToken.approve(merklePools.address, unclaimedAtEndOfYear1);
      await ticToken.mint(accounts[0].address, unclaimedAtEndOfYear1);
      await merklePools.generateLPTokens(
        0,
        unclaimedAtEndOfYear1,
        usdcToAdd,
        unclaimedAtEndOfYear1.sub(1),
        usdcToAdd.sub(1),
        endOfYear1 + 6000
      );

      const lpTokenBalance = await exchange.balanceOf(merklePools.address);

      // generate the tree
      const tree1 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenBalance.div(2),
          totalTICAmount: unclaimedAtEndOfYear1.div(2),
        },
        {
          account: exchange.address,
          poolId: 5,
          totalLPTokenAmount: 0,
          totalTICAmount: 0,
        },
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree1.getHexRoot());

      const proof1 = tree1.getProof(
        0,
        staker1.address,
        0,
        lpTokenBalance.div(2),
        unclaimedAtEndOfYear1.div(2)
      );
      await merklePools
        .connect(staker1)
        .claim(
          0,
          0,
          lpTokenBalance.div(2),
          unclaimedAtEndOfYear1.div(2),
          proof1
        );
      expect(await exchange.balanceOf(staker1.address)).to.equal(
        lpTokenBalance.div(2)
      );

      const tree2 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenBalance,
          totalTICAmount: unclaimedAtEndOfYear1,
        },
        {
          account: exchange.address,
          poolId: 5,
          totalLPTokenAmount: 0,
          totalTICAmount: 0,
        },
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree2.getHexRoot());
      const proof2 = tree2.getProof(
        0,
        staker1.address,
        0,
        lpTokenBalance,
        unclaimedAtEndOfYear1
      );
      await merklePools
        .connect(staker1)
        .claim(0, 0, lpTokenBalance, unclaimedAtEndOfYear1, proof2);
      expect(await exchange.balanceOf(staker1.address)).to.equal(
        lpTokenBalance
      );
    });

    it("works with address having claims in 2 pools", async () => {
      await merklePools.setElasticLPTokenAddress(exchange.address);
      await merklePools.setTicTokenAddress(ticToken.address);
      await merklePools.createPool(usdcToken.address);
      await merklePools.setRewardWeights([100, 10, 100]);

      const staker1 = accounts[2];
      // transfer in TIC and USDC
      const staker1TIC = ethers.utils.parseUnits("200", 18);
      await ticToken.mint(staker1.address, staker1TIC);
      await usdcToken.transfer(staker1.address, staker1TIC);

      // stake tic and usdc
      await ticToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await usdcToken.connect(staker1).approve(merklePools.address, staker1TIC);
      await merklePools.connect(staker1).deposit(0, staker1TIC);
      await merklePools.connect(staker1).deposit(2, staker1TIC);

      const start = Math.round(Date.now() / 1000);
      const elapsedTime = 60 * 60 * 24 * 365; // 1 year
      const endOfYear1 = start + elapsedTime;

      // advance block time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endOfYear1]);
      await ethers.provider.send("evm_mine");

      // create tree for claims
      const unclaimedAtEndOfYear1 = await merklePools.getPoolTotalUnclaimed(0);
      // generate LP tokens so we can claim some!
      const ticPrice = 10;
      const usdcToAdd = unclaimedAtEndOfYear1.div(ticPrice);
      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd.mul(2));
      await ticToken.approve(merklePools.address, unclaimedAtEndOfYear1);
      await ticToken.mint(accounts[0].address, unclaimedAtEndOfYear1);
      await merklePools.generateLPTokens(
        0,
        unclaimedAtEndOfYear1,
        usdcToAdd,
        unclaimedAtEndOfYear1.sub(1),
        usdcToAdd.sub(1),
        endOfYear1 + 6000
      );

      await ticToken.approve(merklePools.address, unclaimedAtEndOfYear1);
      await ticToken.mint(accounts[0].address, unclaimedAtEndOfYear1);
      // do the same for the usdc pool
      await merklePools.generateLPTokens(
        2,
        unclaimedAtEndOfYear1,
        usdcToAdd,
        unclaimedAtEndOfYear1.sub(1),
        usdcToAdd.sub(1),
        endOfYear1 + 6000
      );

      const lpTokenBalance = await exchange.balanceOf(merklePools.address);
      // generate the tree
      const tree1 = new BalanceTree([
        {
          account: staker1.address,
          poolId: 0,
          totalLPTokenAmount: lpTokenBalance.div(2),
          totalTICAmount: unclaimedAtEndOfYear1,
        },
        {
          account: staker1.address,
          poolId: 2,
          totalLPTokenAmount: lpTokenBalance.div(2),
          totalTICAmount: unclaimedAtEndOfYear1,
        },
      ]);

      // set the root
      await merklePools.setMerkleRoot(tree1.getHexRoot());
      const proof1 = tree1.getProof(
        0,
        staker1.address,
        0,
        lpTokenBalance.div(2),
        unclaimedAtEndOfYear1
      );

      const proof2 = tree1.getProof(
        1,
        staker1.address,
        2,
        lpTokenBalance.div(2),
        unclaimedAtEndOfYear1
      );

      await merklePools
        .connect(staker1)
        .claim(0, 0, lpTokenBalance.div(2), unclaimedAtEndOfYear1, proof1);

      await merklePools
        .connect(staker1)
        .claim(1, 2, lpTokenBalance.div(2), unclaimedAtEndOfYear1, proof2);

      expect(await exchange.balanceOf(staker1.address)).to.equal(
        lpTokenBalance
      );
    });
  });
});
