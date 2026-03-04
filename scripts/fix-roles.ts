/**
 * @title fix-roles.ts
 * @author BlockchainGods
 * @notice Grants MINTER_ROLE on UpgradeNFT to the Marketplace contract.
 *         Required for buyUpgrade / rentUpgrade to mint NFTs.
 *
 * Usage:
 *   npx hardhat run scripts/fix-roles.ts --network fuji
 */

import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const connection = await hre.network.connect();
  const ethers = connection.ethers;

  const deployer = new ethers.Wallet(
    process.env.DEPLOYER_PRIVATE_KEY!,
    ethers.provider,
  );

  const upgradeNFTAddress = "0x08Bd95D322550B2a17B46598840f1443d5832e71";
  const marketplaceAddress = "0x81d7cF52c007Cf12F967178eD0eDebb6cbC9eb65";

  const UpgradeNFT = await ethers.getContractFactory("UpgradeNFT", deployer);
  const upgradeNFT = UpgradeNFT.attach(upgradeNFTAddress);

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  console.log("Granting MINTER_ROLE on UpgradeNFT to Marketplace...");
  await (await upgradeNFT.grantRole(MINTER_ROLE, marketplaceAddress)).wait();
  console.log("✓ Done");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
