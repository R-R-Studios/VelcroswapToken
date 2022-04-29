require("dotenv").config();
const {ethers, getNamedAccounts, upgrades } = require("hardhat");


async function main () {
  accounts = await ethers.getSigners();
  const { governance, usdc } = await getNamedAccounts();
  const MerklePoolsForeign = await ethers.getContractFactory("MerklePoolsForeign");
  const merklePools = await upgrades.deployProxy(MerklePoolsForeign, [
    ethers.constants.AddressZero,
    usdc,
    ethers.constants.AddressZero,
    governance,
    governance
  ]);
  await merklePools.deployed();
  console.log("MerklePoolsForeign deployed to ", merklePools.address);
};


// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });