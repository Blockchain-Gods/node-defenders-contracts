/**
 * @title seed-upgradenft.ts
 * @author BlockchainGods
 * @notice Registers initial upgrade types on the UpgradeNFT contract.
 *         Must be run by the deployer wallet (DEFAULT_ADMIN_ROLE).
 *         Run once after deploy before testing buy/rent flows.
 *
 * Usage:
 *   npx hardhat run scripts/seed-upgradenft.ts --network fuji
 *
 * Prerequisites:
 *   - Contracts deployed (deployments/fuji.json must exist)
 *   - DEPLOYER_PRIVATE_KEY set in .env
 */

import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

// Matches UpgradeNFT.Rarity enum order
const Rarity = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
};

async function main() {
  const connection = await hre.network.connect();
  const ethers = connection.ethers;

  const deployer = new ethers.Wallet(
    process.env.DEPLOYER_PRIVATE_KEY!,
    ethers.provider,
  );

  const upgradeNFTAddress = "0x08Bd95D322550B2a17B46598840f1443d5832e71";
  const UpgradeNFT = await ethers.getContractFactory("UpgradeNFT", deployer);
  const upgradeNFT = UpgradeNFT.attach(upgradeNFTAddress);

  console.log("Registering upgrade types...");

  await (
    await upgradeNFT.registerUpgradeType(
      "Firewall Booster",
      "https://assets.yourdomain.com/upgrades/firewall_booster.json",
      Rarity.Common,
      1n, // gameId = Node Defenders
    )
  ).wait();
  console.log("✓ typeId 1: Firewall Booster (Common)");

  await (
    await upgradeNFT.registerUpgradeType(
      "Node Shield",
      "https://assets.yourdomain.com/upgrades/node_shield.json",
      Rarity.Uncommon,
      1n,
    )
  ).wait();
  console.log("✓ typeId 2: Node Shield (Uncommon)");

  console.log("\nDone. Upgrade types registered on UpgradeNFT.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
