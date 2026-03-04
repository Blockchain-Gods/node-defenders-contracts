import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";

import * as dotenv from "dotenv";
dotenv.config();
/**
 * @title deploy.ts
 * @author BlockchainGods
 * @notice Deploys all Node Defenders contracts in dependency order
 *         and wires up roles between them.
 *
 * Usage:
 *   Local:  npx hardhat run scripts/deploy.ts --network localhost
 *   Fuji:   npx hardhat run scripts/deploy.ts --network fuji
 *
 * After running, check deployments/<network>.json for all contract addresses.
 * These addresses are needed by the NestJS backend and signing service.
 *
 * Environment variables required (in .env):
 *   DEPLOYER_PRIVATE_KEY     — wallet that pays gas and becomes DEFAULT_ADMIN
 *   SIGNING_SERVICE_ADDRESS  — address of signing service wallet (gets MINTER/OPERATOR roles)
 */

async function main() {
  let ethers: HardhatEthers;
  const connection = await hre.network.connect();
  ethers = connection.ethers;

  // For Fuji/mainnet — use private key from env
  // For localhost — falls back to default hardhat accounts
  let deployer;
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    const wallet = new ethers.Wallet(
      process.env.DEPLOYER_PRIVATE_KEY,
      ethers.provider,
    );
    deployer = wallet;
  } else {
    [deployer] = await ethers.getSigners();
  }

  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "localhost" : network.name;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Node Defenders — Contract Deployment");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Network:   ${networkName} (chainId: ${network.chainId})`);
  console.log(`  Deployer:  ${deployer.address}`);

  const signingServiceAddress = process.env.SIGNING_SERVICE_ADDRESS;
  if (!signingServiceAddress) {
    throw new Error("SIGNING_SERVICE_ADDRESS not set in .env");
  }
  console.log(`  Signer:    ${signingServiceAddress}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // -------------------------------------------------------------------------
  // 1. SoulToken
  // -------------------------------------------------------------------------
  console.log("1/7  Deploying SoulToken...");
  const SoulToken = await ethers.getContractFactory("SoulToken", deployer);
  const soulToken = await SoulToken.deploy(signingServiceAddress);
  await soulToken.waitForDeployment();
  const soulAddress = await soulToken.getAddress();
  console.log(`     ✓ SoulToken deployed: ${soulAddress}\n`);

  // -------------------------------------------------------------------------
  // 2. GodsToken
  // -------------------------------------------------------------------------
  console.log("2/7  Deploying GodsToken...");
  const GodsToken = await ethers.getContractFactory("GodsToken", deployer);
  const godsToken = await GodsToken.deploy(signingServiceAddress);
  await godsToken.waitForDeployment();
  const godsAddress = await godsToken.getAddress();
  console.log(`     ✓ GodsToken deployed: ${godsAddress}\n`);

  // -------------------------------------------------------------------------
  // 3. Treasury
  // -------------------------------------------------------------------------
  console.log("3/7  Deploying Treasury...");
  const Treasury = await ethers.getContractFactory("Treasury", deployer);
  const treasury = await Treasury.deploy(
    soulAddress,
    godsAddress,
    signingServiceAddress,
  );
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log(`     ✓ Treasury deployed: ${treasuryAddress}\n`);

  // -------------------------------------------------------------------------
  // 4. PlayerRegistry
  // -------------------------------------------------------------------------
  console.log("4/7  Deploying PlayerRegistry...");
  const PlayerRegistry = await ethers.getContractFactory(
    "PlayerRegistry",
    deployer,
  );
  const playerRegistry = await PlayerRegistry.deploy(signingServiceAddress);
  await playerRegistry.waitForDeployment();
  const registryAddress = await playerRegistry.getAddress();
  console.log(`     ✓ PlayerRegistry deployed: ${registryAddress}\n`);

  // -------------------------------------------------------------------------
  // 5. SBT
  // -------------------------------------------------------------------------
  console.log("5/7  Deploying SBT...");
  const SBT = await ethers.getContractFactory("SBT", deployer);
  const sbt = await SBT.deploy(signingServiceAddress, registryAddress);
  await sbt.waitForDeployment();
  const sbtAddress = await sbt.getAddress();
  console.log(`     ✓ SBT deployed: ${sbtAddress}\n`);

  // -------------------------------------------------------------------------
  // 6. UpgradeNFT
  // -------------------------------------------------------------------------
  console.log("6/7  Deploying UpgradeNFT...");
  const UpgradeNFT = await ethers.getContractFactory("UpgradeNFT", deployer);
  const upgradeNFT = await UpgradeNFT.deploy(
    signingServiceAddress,
    registryAddress,
  );
  await upgradeNFT.waitForDeployment();
  const upgradeNFTAddress = await upgradeNFT.getAddress();
  console.log(`     ✓ UpgradeNFT deployed: ${upgradeNFTAddress}\n`);

  // -------------------------------------------------------------------------
  // 7. Marketplace
  // -------------------------------------------------------------------------
  console.log("7/7  Deploying Marketplace...");
  const Marketplace = await ethers.getContractFactory("Marketplace", deployer);
  const marketplace = await Marketplace.deploy(
    soulAddress,
    godsAddress,
    upgradeNFTAddress,
    treasuryAddress,
    registryAddress,
    signingServiceAddress,
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log(`     ✓ Marketplace deployed: ${marketplaceAddress}\n`);

  // -------------------------------------------------------------------------
  // Post-deploy role wiring
  // -------------------------------------------------------------------------
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wiring roles...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Treasury: grant MARKETPLACE_ROLE to Marketplace
  console.log("  Treasury  → granting MARKETPLACE_ROLE to Marketplace...");
  const MARKETPLACE_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MARKETPLACE_ROLE"),
  );
  await (await treasury.grantRole(MARKETPLACE_ROLE, marketplaceAddress)).wait();
  console.log("  ✓ Done\n");

  // PlayerRegistry: set SBT contract address
  console.log("  PlayerRegistry → setting SBT contract...");
  await (await playerRegistry.setSbtContract(sbtAddress)).wait();
  console.log("  ✓ Done\n");

  // UpgradeNFT: grant MARKETPLACE_ROLE to Marketplace
  console.log("  UpgradeNFT → granting MARKETPLACE_ROLE to Marketplace...");
  await (
    await upgradeNFT.grantRole(MARKETPLACE_ROLE, marketplaceAddress)
  ).wait();
  console.log("  ✓ Done\n");

  // -------------------------------------------------------------------------
  // Seed initial rental tiers
  // -------------------------------------------------------------------------
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Seeding rental tiers...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const oneDay = 86400n;
  const sevenDays = 604800n;
  const thirtyDays = 2592000n;

  // Prices in SOUL — 18 decimals
  // TODO: adjust these before Fuji / mainnet based on your economy model
  const tier1Price = ethers.parseEther("10"); // 10 SOUL / 1 day
  const tier2Price = ethers.parseEther("35"); // 35 SOUL / 7 days
  const tier3Price = ethers.parseEther("100"); // 100 SOUL / 30 days

  console.log("  Tier 1 — 1 Day   — 10 SOUL");
  await (
    await marketplace.registerRentalTier("1 Day", oneDay, tier1Price, 0n)
  ).wait();

  console.log("  Tier 2 — 7 Days  — 35 SOUL");
  await (
    await marketplace.registerRentalTier("7 Days", sevenDays, tier2Price, 0n)
  ).wait();

  console.log("  Tier 3 — 30 Days — 100 SOUL");
  await (
    await marketplace.registerRentalTier("30 Days", thirtyDays, tier3Price, 0n)
  ).wait();
  console.log("  ✓ Tiers seeded\n");

  // -------------------------------------------------------------------------
  // Save deployment addresses to file
  // -------------------------------------------------------------------------
  const deployments = {
    network: networkName,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    signingService: signingServiceAddress,
    contracts: {
      SoulToken: soulAddress,
      GodsToken: godsAddress,
      Treasury: treasuryAddress,
      PlayerRegistry: registryAddress,
      SBT: sbtAddress,
      UpgradeNFT: upgradeNFTAddress,
      Marketplace: marketplaceAddress,
    },
  };

  const deploymentsDir = path.join(process.cwd(), "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const outputPath = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(deployments, null, 2));

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployment complete");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Addresses saved to: deployments/${networkName}.json`);
  console.log("\n  Contract Addresses:");
  Object.entries(deployments.contracts).forEach(([name, address]) => {
    console.log(`    ${name.padEnd(16)} ${address}`);
  });
  console.log(
    "\n  ⚠️  Copy deployments/${networkName}.json to your NestJS and signing service .env files.",
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
