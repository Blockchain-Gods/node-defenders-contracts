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
  const buyPriceSoul = ethers.parseEther("3000");
  const buyPriceGods = ethers.parseEther("300");

  console.log("Listing upgrade typeId 1...");
  await (
    await marketplace.setUpgradePrice(
      1n,
      ethers.parseEther("100"), // buyPriceSoul
      ethers.parseEther("20"), // rentPriceSoul (20% of buy)
      ethers.parseEther("1"), // buyPriceSoul
      ethers.parseEther("0.2"), // rentPriceGods (20% of buy)
    )
  ).wait();
  console.log("✓ typeId 1 listed");

  console.log("Listing upgrade typeId 2...");
  await (
    await marketplace.setUpgradePrice(
      2n,
      ethers.parseEther("2000"), // buyPriceSoul
      ethers.parseEther("400"), // rentPriceSoul (20% of buy)
      ethers.parseEther("200"), // buyPriceSoul
      ethers.parseEther("40"), // rentPriceGods (20% of buy)
    )
  ).wait();
  console.log("✓ typeId 2 listed");

  await (
    await marketplace.setUpgradePrice(
      3n,
      ethers.parseEther("3000"), // buyPriceSoul
      ethers.parseEther("600"), // rentPriceSoul (20% of buy)
      ethers.parseEther("300"), // buyPriceSoul
      ethers.parseEther("60"), // rentPriceGods (20% of buy)
    )
  ).wait();
  console.log("✓ typeId 3 listed");

  console.log("\nDone. Upgrade types listed on Marketplace.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
