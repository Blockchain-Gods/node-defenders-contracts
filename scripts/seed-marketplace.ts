/**
 * @title seed-marketplace.ts
 * @author BlockchainGods
 * @notice Lists upgrade types on the Marketplace contract for testing.
 *         Must be run by the deployer wallet (DEFAULT_ADMIN_ROLE / OPERATOR_ROLE).
 *         Run once after deploy before testing buy/rent flows.
 *
 * Usage:
 *   npx hardhat run scripts/seed-marketplace.ts --network fuji
 *
 * Prerequisites:
 *   - Contracts deployed (deployments/fuji.json must exist)
 *   - DEPLOYER_PRIVATE_KEY set in .env
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

  const marketplaceAddress = "0x81d7cF52c007Cf12F967178eD0eDebb6cbC9eb65";
  const Marketplace = await ethers.getContractFactory("Marketplace", deployer);
  const marketplace = Marketplace.attach(marketplaceAddress);

  // Prices in SOUL (18 decimals)
  const buyPriceSoul = ethers.parseEther("50"); // 50 SOUL to buy
  const buyPriceGods = ethers.parseEther("5"); // 5 GODS to buy

  console.log("Listing upgrade typeId 1...");
  await (
    await marketplace.setUpgradePrice(1n, buyPriceSoul, buyPriceGods)
  ).wait();
  console.log("✓ typeId 1 listed: 50 SOUL / 5 GODS");

  console.log("Listing upgrade typeId 2...");
  await (
    await marketplace.setUpgradePrice(2n, buyPriceSoul, buyPriceGods)
  ).wait();
  console.log("✓ typeId 2 listed: 50 SOUL / 5 GODS");

  console.log("\nDone. Upgrade types listed on Marketplace.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
