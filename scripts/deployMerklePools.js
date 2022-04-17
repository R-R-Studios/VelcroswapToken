require("dotenv").config();
const {ethers, getNamedAccounts, upgrades } = require("hardhat");


async function main () {
  accounts = await ethers.getSigners();
  const { governance, tic, usdc, ticUsdcELP } = await getNamedAccounts();
  const MerklePools = await ethers.getContractFactory("MerklePools");
  const merklePools = await upgrades.deployProxy(MerklePools, [
    tic,
    usdc,
    ticUsdcELP,
    governance,
    governance
  ]);
  await merklePools.deployed();
  console.log("MerklePools deployed to ", merklePools.address);
};


// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });