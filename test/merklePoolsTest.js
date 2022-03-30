const { expect } = require("chai");
const { ethers, deployments, getNamedAccounts } = require("hardhat");
const exchangeArtifact = require("@elasticswap/elasticswap/artifacts/src/contracts/Exchange.sol/Exchange.json");

const { BalanceTree } = require("../src/utils/BalanceTree");
const { parseBalanceMap } = require("../src/utils/parseBalanceMap");

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

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
      accounts[0].address,
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
      expect(await merklePools.ticToken()).to.eq(ticToken.address);
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

      const usdcToAdd = ethers.utils.parseUnits("100", 18);
      const ticToBeMinted = usdcToAdd.div(10); // TIC = $10USDC
      
      
      const start = Math.round(Date.now() / 1000);
      const futureTime = start + 60*60*60*24*365
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

      // TODO: enable merkle verification!

      // generate LP tokens so we can claim some!
      const ticToMint = unclaimedAtEndOfYear2.div(20); // 5% of rewards are going to be issued
      const ticPrice = 10;
      const usdcToAdd = ticToMint.div(ticPrice);
      expect(await exchange.balanceOf(merklePools.address)).to.equal(0);
      await usdcToken.approve(merklePools.address, usdcToAdd);
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
      const lpTokenForStaker2 = lpTokenBalance
        .mul(staker2unclaimedTic)
        .div(unclaimedAtEndOfYear2);
      const lpTokenForStaker1 = lpTokenBalance
        .mul(staker1unclaimedTic)
        .div(unclaimedAtEndOfYear2);

      const ticConsumedFromStaker2 = lpTokenForStaker2.mul(ticPerLP);
      const ticConsumedFromStaker1 = lpTokenForStaker1.mul(ticPerLP);

      expect(await exchange.balanceOf(staker2.address)).to.equal(0);
      await merklePools
        .connect(staker2)
        .claim(0, 0, lpTokenForStaker2, ticConsumedFromStaker2, []);
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
      expect(diffFromGlobalUnclaimed.lt(ethers.utils.parseUnits("1", 18))).to.be
        .true; // diff of less than 1 tokens

      // have staker1 claim the rest of the available LP
      expect(await exchange.balanceOf(staker1.address)).to.equal(0);
      await merklePools
        .connect(staker1)
        .claim(0, 0, lpTokenForStaker1, ticConsumedFromStaker1, []);
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
          ethers.utils.parseUnits("1", 18)
        )
      ).to.be.true;
      await merklePools
        .connect(staker1)
        .claim(
          0,
          0,
          lptTokensTotalForStaker1,
          ticConsumedFromStaker1.add(staker1unclaimedTic),
          []
        );
      await merklePools
        .connect(staker2)
        .claim(
          0,
          0,
          lptTokensTotalForStaker2,
          ticConsumedFromStaker2.add(staker2unclaimedTic),
          []
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

      //have both stakers exit
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
      await merklePools.claim(
        0,
        0,
        await exchange.balanceOf(merklePools.address),
        forfeitUnclaimed,
        []
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
      expect(await merklePools.merkleRoot()).to.be.equal(ZERO_BYTES32);
      await merklePools.setMerkleRoot(tree.getHexRoot());
      expect(await merklePools.merkleRoot()).to.be.equal(tree.getHexRoot());
    });

    it("reverts when set by non owner", async () => {
      await expect(
        merklePools.connect(accounts[1]).setMerkleRoot(tree.getHexRoot())
      ).to.be.revertedWith("MerklePools: only governance");
    });

    it("emits MerkleRootUpdated", async () => {
      await expect(await merklePools.setMerkleRoot(tree.getHexRoot()))
        .to.emit(merklePools, "MerkleRootUpdated")
        .withArgs(tree.getHexRoot());
    });
  });
});
