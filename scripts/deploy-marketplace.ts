import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";

import * as dotenv from "dotenv";
dotenv.config();

/**
 * @title deploy-marketplace.ts
 * @author BlockchainGods
 * @notice Deploys only the Marketplace contract and wires it into existing contracts.
 *         Use this when redeploying Marketplace after changes.
 *         All other contracts remain untouched.
 *
 * Usage:
 *   Local:  npx hardhat run scripts/deploy-marketplace.ts --network localhost
 *   Fuji:   npx hardhat run scripts/deploy-marketplace.ts --network fuji
 *
 * Prerequisites:
 *   - All other contracts already deployed
 *   - deployments/<network>.json exists with existing contract addresses
 *   - Previous Marketplace address will be replaced in deployments/<network>.json
 *
 * What this script does:
 *   1. Loads existing deployment addresses from deployments/<network>.json
 *   2. Deploys new Marketplace contract
 *   3. Revokes MARKETPLACE_ROLE + MINTER_ROLE from old Marketplace on Treasury + UpgradeNFT
 *   4. Grants MARKETPLACE_ROLE + MINTER_ROLE to new Marketplace on Treasury + UpgradeNFT
 *   5. Seeds rental tiers and upgrade prices
 *   6. Updates deployments/<network>.json with new Marketplace address
 */

async function main() {
  let ethers: HardhatEthers;
  const connection = await hre.network.connect();
  ethers = connection.ethers;

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
  console.log("  Node Defenders — Marketplace Redeployment");
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
  // Load existing deployment addresses
  // -------------------------------------------------------------------------
  const deploymentsDir = path.resolve(process.cwd(), "../deployments");
  const deploymentsPath = path.resolve(deploymentsDir, `${networkName}.json`);
  console.log(`deployments path: ${deploymentsPath}`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `No deployments found for network ${networkName}. Run deploy.ts first.`,
    );
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const {
    SoulToken: soulAddress,
    GodsToken: godsAddress,
    Treasury: treasuryAddress,
    PlayerRegistry: registryAddress,
    UpgradeNFT: upgradeNFTAddress,
    Marketplace: oldMarketplaceAddress,
  } = deployments.contracts;

  console.log("  Loaded existing addresses:");
  console.log(`    SoulToken      ${soulAddress}`);
  console.log(`    GodsToken      ${godsAddress}`);
  console.log(`    Treasury       ${treasuryAddress}`);
  console.log(`    PlayerRegistry ${registryAddress}`);
  console.log(`    UpgradeNFT     ${upgradeNFTAddress}`);
  console.log(`    Marketplace    ${oldMarketplaceAddress} (replacing)\n`);

  // -------------------------------------------------------------------------
  // Deploy new Marketplace
  // -------------------------------------------------------------------------
  console.log("  Deploying new Marketplace...");
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
  const newMarketplaceAddress = await marketplace.getAddress();
  console.log(`  ✓ Marketplace deployed: ${newMarketplaceAddress}\n`);

  // -------------------------------------------------------------------------
  // Revoke roles from old Marketplace
  // -------------------------------------------------------------------------
  const MARKETPLACE_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MARKETPLACE_ROLE"),
  );
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  // Attach to existing contracts using their ABIs
  const treasury = await ethers.getContractAt(
    "Treasury",
    treasuryAddress,
    deployer,
  );
  const upgradeNFT = await ethers.getContractAt(
    "UpgradeNFT",
    upgradeNFTAddress,
    deployer,
  );

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Revoking roles from old Marketplace...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log(
    "  Treasury  → revoking MARKETPLACE_ROLE from old Marketplace...",
  );
  await (
    await treasury.revokeRole(MARKETPLACE_ROLE, oldMarketplaceAddress)
  ).wait();
  console.log("  ✓ Done\n");

  console.log(
    "  UpgradeNFT → revoking MARKETPLACE_ROLE from old Marketplace...",
  );
  await (
    await upgradeNFT.revokeRole(MARKETPLACE_ROLE, oldMarketplaceAddress)
  ).wait();
  console.log("  ✓ Done\n");

  console.log("  UpgradeNFT → revoking MINTER_ROLE from old Marketplace...");
  await (
    await upgradeNFT.revokeRole(MINTER_ROLE, oldMarketplaceAddress)
  ).wait();
  console.log("  ✓ Done\n");

  // -------------------------------------------------------------------------
  // Grant roles to new Marketplace
  // -------------------------------------------------------------------------
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Granting roles to new Marketplace...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("  Treasury  → granting MARKETPLACE_ROLE to new Marketplace...");
  await (
    await treasury.grantRole(MARKETPLACE_ROLE, newMarketplaceAddress)
  ).wait();
  console.log("  ✓ Done\n");

  console.log("  UpgradeNFT → granting MARKETPLACE_ROLE to new Marketplace...");
  await (
    await upgradeNFT.grantRole(MARKETPLACE_ROLE, newMarketplaceAddress)
  ).wait();
  console.log("  ✓ Done\n");

  console.log("  UpgradeNFT → granting MINTER_ROLE to new Marketplace...");
  await (await upgradeNFT.grantRole(MINTER_ROLE, newMarketplaceAddress)).wait();
  console.log("  ✓ Done\n");

  // -------------------------------------------------------------------------
  // Seed rental tiers — duration only
  // -------------------------------------------------------------------------
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Seeding rental tiers...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const oneDay = 86400n;
  const sevenDays = 604800n;
  const thirtyDays = 2592000n;

  console.log("  Tier 1 — 1 Day");
  await (await marketplace.registerRentalTier("1 Day", oneDay)).wait();

  console.log("  Tier 2 — 7 Days");
  await (await marketplace.registerRentalTier("7 Days", sevenDays)).wait();

  console.log("  Tier 3 — 30 Days");
  await (await marketplace.registerRentalTier("30 Days", thirtyDays)).wait();
  console.log("  ✓ Tiers seeded\n");

  // -------------------------------------------------------------------------
  // Seed upgrade prices — buy + rent per type
  // TODO: adjust prices before mainnet
  // -------------------------------------------------------------------------
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Seeding upgrade prices...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await (
    await marketplace.setUpgradePrice(
      6n,
      ethers.parseEther("100"), // buyPriceSoul
      ethers.parseEther("20"), // rentPriceSoul (20% of buy)
      ethers.parseEther("1"), // buyPriceSoul
      ethers.parseEther("0.2"), // rentPriceGods (20% of buy)
    )
  ).wait();
  console.log("✓ typeId 6 listed");

  console.log("Listing upgrade typeId 7...");
  await (
    await marketplace.setUpgradePrice(
      7n,
      ethers.parseEther("2000"), // buyPriceSoul
      ethers.parseEther("400"), // rentPriceSoul (20% of buy)
      ethers.parseEther("200"), // buyPriceSoul
      ethers.parseEther("40"), // rentPriceGods (20% of buy)
    )
  ).wait();
  console.log("✓ typeId 7 listed");

  await (
    await marketplace.setUpgradePrice(
      8n,
      ethers.parseEther("3000"), // buyPriceSoul
      ethers.parseEther("600"), // rentPriceSoul (20% of buy)
      ethers.parseEther("300"), // buyPriceSoul
      ethers.parseEther("60"), // rentPriceGods (20% of buy)
    )
  ).wait();
  console.log("✓ typeId 8 listed");

  // -------------------------------------------------------------------------
  // Update deployments file
  // -------------------------------------------------------------------------
  deployments.contracts.Marketplace = newMarketplaceAddress;
  deployments.updatedAt = new Date().toISOString();
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Marketplace redeployment complete");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Old Marketplace: ${oldMarketplaceAddress}`);
  console.log(`  New Marketplace: ${newMarketplaceAddress}`);
  console.log(`  deployments/${networkName}.json updated\n`);
  console.log(
    "  ⚠️  Update MARKETPLACE_ADDRESS in your NestJS and signing service .env files.",
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
