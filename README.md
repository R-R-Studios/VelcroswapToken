# Deployed Addresses

### TIC and Staking 
deployed commit [653d1e6](https://github.com/ElasticSwap/token/tree/653d1e687454d8934868747534c71b3a414c3b8c)

- [StakingPools](https://snowtrace.io/address/0x416494bD4FbEe227313b76a07A1e859928D7bA47) - 0x416494bD4FbEe227313b76a07A1e859928D7bA47
- [TIC Token](https://snowtrace.io/address/0x75739a693459f33B1FBcC02099eea3eBCF150cBe) - 0x75739a693459f33B1FBcC02099eea3eBCF150cBe
- [TIME Token DAO](https://snowtrace.io/address/0xBA41c2A2744e3749ab3E76FdFe6FCa5875D97660) - 0xBA41c2A2744e3749ab3E76FdFe6FCa5875D97660
- [TIME Token Team](https://snowtrace.io/address/0x31fa86c83aE739220CE4fa93391BB321cC77670E) - 0x31fa86c83aE739220CE4fa93391BB321cC77670E
- [TIME Token PreSeed](https://snowtrace.io/address/0x65C8CB3AFF7021c9A1579787e29B1c3D24c5cA59) - 0x65C8CB3AFF7021c9A1579787e29B1c3D24c5cA59

### MerklePools (AVAX)

deploy commit [3b38a12](https://github.com/ElasticSwap/token/commit/3b38a12a9a53350427da85bd1d4f372bf2fa8749)

- [Proxy](https://snowtrace.io/address/0x9b7b70f65ea5266ebd0a0f8435be832d39e71280) - 0x9b7b70f65ea5266ebd0a0f8435be832d39e71280
- [PoxyAdmin](https://snowtrace.io/address/0x9368a7d3a59861b528a2528725d55479f02ae135) - 0x9368a7d3a59861b528a2528725d55479f02ae135
- [Implementation](https://snowtrace.io/address/0xbe443274808af7f6daec7ad8ddf39f94f1603246) - 0xbe443274808af7f6daec7ad8ddf39f94f1603246

### MerklePoolsForeign (Mainnet)

deploy commit [23cfc6e](https://github.com/ElasticSwap/token/tree/23cfc6efd51bb04b8daf55f97bedd21e7bf66d5a)
- [Proxy](https://etherscan.io/address/0xc8d00c0a8d2ec4ec538a82461a7a7f5c3ac99d95) - 0xc8d00c0a8d2ec4ec538a82461a7a7f5c3ac99d95
- [PoxyAdmin](https://etherscan.io/address/0xbce91a72a03966d27edab52490a5749da5ae916f) - 0xbce91a72a03966d27edab52490a5749da5ae916f
- [Implementation](https://etherscan.io/address/0x0e5ba9a39A75e6AFdBCFFB422Fda80497F80a88c) - 0x0e5ba9a39A75e6AFdBCFFB422Fda80497F80a88c


### Mainnet deployment instructions
1. Update .env file for correct keys and addresses.
1. Update desired gas price in hardhat (https://snowtrace.io/gastracker)
1. Deploy contracts to avalanche `npx hardhat deploy --network avalanche  --export-all ./artifacts/deployments.json`
1. Verify on etherscan `npx hardhat --network avalanche etherscan-verify --api-key <APIKEY>`
1. Pre-mine TIC to DAO and mint all TIME tokens `HARDHAT_NETWORK="avalanche" node scripts/mintTokens.js` 
   1. Pre-mine tokens to DAO
   1. Mint DAO Time token to DAO
   1. Mint Team Time token to Team
   1. Mint Pre-Seed Time token to pre-seed
1. Create initial Sushi pool for TIC <> USDC from DAO and seed round
1. Add the new Sushi LP address to .env
1. Create pool for Sushi LP tokens `HARDHAT_NETWORK="avalanche" node scripts/createSushiPool.js`
1. Set weights for all pools `HARDHAT_NETWORK="avalanche" node scripts/setPoolWeights.js`
1. Confirm pool addresses and weights on snowscan.
1. Grant admin rights to DAO `HARDHAT_NETWORK="avalanche" node scripts/grantAdminToDAO.js` 
   1. Grant TIC Token admin DAO
   1. Grant DAO Time token admin and minter to DAO
   1. Grant Team Time token admin and minter to DAO
   1. Grant Pre-Seed Time token admin and minter to DAO
1. Confirm on snowscan correct admin permissions for the DAO for all 4 token contracts.
1. DAO accept pending governance from StakingPools.sol
1. Stake DAO time token
1. From DAO, call `setRewardRate` to enable staking for initial pools. LP, TIC, DAO 
1. Renounce all rights from deployer address `HARDHAT_NETWORK="avalanche" node scripts/renounceRoles.js` 
1. Publish all mainnet addresses
1. When ready from DAO, call setRewardRate to enable staking (~24 hrs later) and set updated pool weights. 


# Deploying MerklePools.sol with proxy to AVAX

1. update HH config with correct address for USDC<>TIC ELP address
1. Confirm the AVAX governance address
1. Set the correct desired gasPrice in HH config
1. `HARDHAT_NETWORK="avalanche" node scripts/deployMerklePools.js`
1. Transfer ownership of the proxy admin
1. Create pools