import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

/**
 * @title register-player.ts
 * @author BlockchainGods
 * @notice Registers a custodial player wallet in PlayerRegistry.
 *         Must be run by the signing service wallet (RECORDER_ROLE).
 *         Use for manual registration during testing — in production
 *         this is called by the NestJS API on first player login.
 *
 * Usage:
 *   PLAYER_WALLET=0x... npx hardhat run scripts/register-player.ts --network fuji
 */

async function main() {
  const connection = await hre.network.connect();
  const ethers = connection.ethers;

  const playerWallet = process.env.PLAYER_WALLET;
  if (!playerWallet) throw new Error("PLAYER_WALLET env var required");

  const signerWallet = new ethers.Wallet(
    process.env.SIGNING_SERVICE_PRIVATE_KEY!,
    ethers.provider,
  );

  const registryAddress = "0x8EF5652A090E5a7584d986A69568969282215521";
  const PlayerRegistry = await ethers.getContractFactory(
    "PlayerRegistry",
    signerWallet,
  );
  const registry = PlayerRegistry.attach(registryAddress);

  console.log(`Registering player: ${playerWallet}`);
  await (await registry.registerPlayer(playerWallet)).wait();
  console.log("✓ Player registered");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
