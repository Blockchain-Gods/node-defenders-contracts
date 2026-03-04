import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { SoulToken } from "../../types/ethers-contracts/SoulToken.js";
import type { GodsToken } from "../../types/ethers-contracts/GodsToken.js";
import type { PlayerRegistry } from "../../types/ethers-contracts/PlayerRegistry.js";
import type { Treasury } from "../../types/ethers-contracts/Treasury.js";
import type { SBT } from "../../types/ethers-contracts/SBT.sol/SBT.js";
import type { UpgradeNFT } from "../../types/ethers-contracts/UpgradeNFT.sol/UpgradeNFT.js";
import type { Marketplace } from "../../types/ethers-contracts/Marketplace.sol/Marketplace.js";

export interface DeployedContracts {
  soul: SoulToken;
  gods: GodsToken;
  registry: PlayerRegistry;
  treasury: Treasury;
  sbt: SBT;
  upgradeNFT: UpgradeNFT;
  marketplace: Marketplace;
  admin: HardhatEthersSigner;
  signingService: HardhatEthersSigner;
  player1: HardhatEthersSigner;
  player2: HardhatEthersSigner;
  player3: HardhatEthersSigner;
  stranger: HardhatEthersSigner;
}

/**
 * Deploys all contracts in dependency order and wires them together.
 *
 * Accepts the ethers instance from the caller's network connection so that
 * all contract interactions and time manipulation share the same EVM instance.
 * Without this, time.increase() in tests has no effect on the chain the
 * contracts are deployed on.
 *
 * Deployment order:
 *   1. PlayerRegistry, SoulToken, GodsToken  — no dependencies
 *   2. Treasury, SBT, UpgradeNFT             — depend on (1)
 *   3. Marketplace                           — depends on all of (1) and (2)
 *   4. Post-deploy wiring                    — role grants between contracts
 */
export async function deployAll(
  ethers: HardhatEthers,
): Promise<DeployedContracts> {
  const [admin, signingService, player1, player2, player3, stranger] =
    await ethers.getSigners();

  // ---------------------------------------------------------------------------
  // 1. No-dependency contracts
  // ---------------------------------------------------------------------------

  const RegistryFactory = await ethers.getContractFactory(
    "PlayerRegistry",
    admin,
  );
  const registry = (await RegistryFactory.deploy(
    signingService.address,
  )) as unknown as PlayerRegistry;
  await registry.waitForDeployment();

  const SoulFactory = await ethers.getContractFactory("SoulToken", admin);
  const soul = (await SoulFactory.deploy(
    signingService.address,
  )) as unknown as SoulToken;
  await soul.waitForDeployment();

  const GodsFactory = await ethers.getContractFactory("GodsToken", admin);
  const gods = (await GodsFactory.deploy(
    signingService.address,
  )) as unknown as GodsToken;
  await gods.waitForDeployment();

  // ---------------------------------------------------------------------------
  // 2. Contracts that depend on (1)
  // ---------------------------------------------------------------------------

  const TreasuryFactory = await ethers.getContractFactory("Treasury", admin);
  const treasury = (await TreasuryFactory.deploy(
    await soul.getAddress(),
    await gods.getAddress(),
    signingService.address,
  )) as unknown as Treasury;
  await treasury.waitForDeployment();

  const SBTFactory = await ethers.getContractFactory("SBT", admin);
  const sbt = (await SBTFactory.deploy(
    signingService.address,
    await registry.getAddress(),
  )) as unknown as SBT;
  await sbt.waitForDeployment();

  const UpgradeNFTFactory = await ethers.getContractFactory(
    "UpgradeNFT",
    admin,
  );
  const upgradeNFT = (await UpgradeNFTFactory.deploy(
    signingService.address,
    await registry.getAddress(),
  )) as unknown as UpgradeNFT;
  await upgradeNFT.waitForDeployment();

  // ---------------------------------------------------------------------------
  // 3. Marketplace — depends on everything
  // ---------------------------------------------------------------------------

  const MarketplaceFactory = await ethers.getContractFactory(
    "Marketplace",
    admin,
  );
  const marketplace = (await MarketplaceFactory.deploy(
    await soul.getAddress(),
    await gods.getAddress(),
    await upgradeNFT.getAddress(),
    await treasury.getAddress(),
    await registry.getAddress(),
    signingService.address,
  )) as unknown as Marketplace;
  await marketplace.waitForDeployment();

  // ---------------------------------------------------------------------------
  // 4. Post-deploy wiring
  // ---------------------------------------------------------------------------

  // Allow SBT contract to call incrementSbtCount on PlayerRegistry
  await registry.setSbtContract(await sbt.getAddress());

  // Allow Marketplace to call setUser on UpgradeNFT (secondary rentals)
  await upgradeNFT.grantRole(
    await upgradeNFT.MARKETPLACE_ROLE(),
    await marketplace.getAddress(),
  );

  // Allow Marketplace to call mint/mintAndRent on UpgradeNFT (buy/rent flows)
  await upgradeNFT.grantRole(
    await upgradeNFT.MINTER_ROLE(),
    await marketplace.getAddress(),
  );

  // Allow Marketplace to call receiveFee on Treasury
  await treasury.grantRole(
    await treasury.MARKETPLACE_ROLE(),
    await marketplace.getAddress(),
  );

  return {
    soul,
    gods,
    registry,
    treasury,
    sbt,
    upgradeNFT,
    marketplace,
    admin,
    signingService,
    player1,
    player2,
    player3,
    stranger,
  };
}
