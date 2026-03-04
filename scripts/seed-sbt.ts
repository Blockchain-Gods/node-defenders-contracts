import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

/**
 * @title seed-sbt.ts
 * @author BlockchainGods
 * @notice Registers initial SBT achievement types on the deployed SBT contract.
 *         Must be run by the deployer wallet (DEFAULT_ADMIN_ROLE).
 *         Run once after deploy — achievement types are permanent unless deactivated.
 *
 * Usage:
 *   npx hardhat run scripts/seed-sbt.ts --network fuji
 *
 * Prerequisites:
 *   - Contracts deployed (deployments/fuji.json must exist)
 *   - DEPLOYER_PRIVATE_KEY set in .env
 */

async function main() {
  const connection = await hre.network.connect();
  const ethers = connection.ethers;

  const deployer = new ethers.Wallet(
    process.env.DEPLOYER_PRIVATE_KEY!,
    ethers.provider,
  );

  const sbtAddress = "0x220F092833325FaE59599a53D51349eA1Fc3A03B";
  const registryAddress = "0x8EF5652A090E5a7584d986A69568969282215521";

  const SBT = await ethers.getContractFactory("SBT", deployer);
  const sbt = SBT.attach(sbtAddress);

  const PlayerRegistry = await ethers.getContractFactory(
    "PlayerRegistry",
    deployer,
  );
  const registry = PlayerRegistry.attach(registryAddress);

  // Register achievement types (gameId=1, modeId=1 = Node Defenders Survival)
  console.log("Registering achievement types...");

  await (
    await sbt.registerAchievementType(
      "first_game",
      "https://assets.blockchaingods.io/sbt/first_game.json",
      1n,
      1n,
    )
  ).wait();
  console.log("✓ typeId 1: first_game");

  await (
    await sbt.registerAchievementType(
      "survive_10_rounds",
      "https://assets.blockchaingods.io/sbt/survive_10_rounds.json",
      1n,
      1n,
    )
  ).wait();
  console.log("✓ typeId 2: survive_10_rounds");

  await (
    await sbt.registerAchievementType(
      "kill_100_enemies",
      "https://assets.blockchaingods.io/sbt/kill_100_enemies.json",
      1n,
      1n,
    )
  ).wait();
  console.log("✓ typeId 3: kill_100_enemies");

  console.log("\nDone. Achievement types registered.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
