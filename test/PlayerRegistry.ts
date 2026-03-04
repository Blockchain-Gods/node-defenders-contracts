import { expect } from "chai";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { PlayerRegistry } from "../types/ethers-contracts/PlayerRegistry.js";
import type { SBT } from "../types/ethers-contracts/SBT.sol/SBT.js";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import { deployAll } from "./helpers/fixtures.js";

describe("PlayerRegistry", () => {
  let registry: PlayerRegistry;
  let sbt: SBT;
  let admin: HardhatEthersSigner;
  let signingService: HardhatEthersSigner;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let ethers: HardhatEthers;

  let time: NetworkHelpers["time"];

  beforeEach(async () => {
    const connection = await hre.network.connect();
    ethers = connection.ethers;
    const deployed = await deployAll(ethers);
    time = connection.networkHelpers.time;
    ({ registry, sbt, admin, signingService, player1, player2, stranger } =
      deployed);
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", () => {
    it("grants DEFAULT_ADMIN_ROLE to deployer", async () => {
      const role = await registry.DEFAULT_ADMIN_ROLE();
      expect(await registry.hasRole(role, admin.address)).to.be.true;
    });

    it("grants RECORDER_ROLE to signing service", async () => {
      const role = await registry.RECORDER_ROLE();
      expect(await registry.hasRole(role, signingService.address)).to.be.true;
    });

    it("starts with zero total players", async () => {
      expect(await registry.totalPlayers()).to.equal(0n);
    });

    it("reverts when signing service is zero address", async () => {
      const Factory = await ethers.getContractFactory("PlayerRegistry", admin);
      await expect(
        Factory.deploy(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // registerPlayer()
  // ---------------------------------------------------------------------------

  describe("registerPlayer()", () => {
    it("registers a new player", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      const profile = await registry.getProfile(player1.address);
      expect(profile.registered).to.be.true;
    });

    it("increments totalPlayers on registration", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      expect(await registry.totalPlayers()).to.equal(1n);
    });

    it("sets registeredAt close to block timestamp", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      const latest = await time.latest();
      const profile = await registry.getProfile(player1.address);
      expect(Number(profile.registeredAt)).to.be.closeTo(latest, 5);
    });

    it("initialises all stat fields to zero", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      const p = await registry.getProfile(player1.address);
      expect(p.gamesPlayed).to.equal(0n);
      expect(p.roundsSurvived).to.equal(0n);
      expect(p.enemiesKilled).to.equal(0n);
      expect(p.sbtCount).to.equal(0n);
      expect(p.reputationScore).to.equal(0n);
      expect(p.banned).to.be.false;
      expect(p.banCount).to.equal(0n);
    });

    it("emits PlayerRegistered event", async () => {
      const latest = await time.latest();
      await expect(
        registry.connect(signingService).registerPlayer(player1.address),
      )
        .to.emit(registry, "PlayerRegistered")
        .withArgs(player1.address, latest + 1);
    });

    it("reverts when called by non-recorder", async () => {
      await expect(
        registry.connect(stranger).registerPlayer(player1.address),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("reverts on zero address", async () => {
      await expect(
        registry.connect(signingService).registerPlayer(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("reverts on duplicate registration", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      await expect(
        registry.connect(signingService).registerPlayer(player1.address),
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });
  });

  // ---------------------------------------------------------------------------
  // recordStats()
  // ---------------------------------------------------------------------------

  describe("recordStats()", () => {
    beforeEach(async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
    });

    it("additively records stats", async () => {
      await registry
        .connect(signingService)
        .recordStats(player1.address, 3, 10, 50);
      await registry
        .connect(signingService)
        .recordStats(player1.address, 2, 5, 25);

      const p = await registry.getProfile(player1.address);
      expect(p.gamesPlayed).to.equal(5n);
      expect(p.roundsSurvived).to.equal(15n);
      expect(p.enemiesKilled).to.equal(75n);
    });

    it("emits StatsRecorded with cumulative totals", async () => {
      await registry
        .connect(signingService)
        .recordStats(player1.address, 3, 10, 50);
      await expect(
        registry.connect(signingService).recordStats(player1.address, 2, 5, 25),
      )
        .to.emit(registry, "StatsRecorded")
        .withArgs(player1.address, 5, 15, 75);
    });

    it("reverts for unregistered player", async () => {
      await expect(
        registry.connect(signingService).recordStats(player2.address, 1, 1, 1),
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("reverts for banned player", async () => {
      await registry.connect(admin).banPlayer(player1.address);
      await expect(
        registry.connect(signingService).recordStats(player1.address, 1, 1, 1),
      ).to.be.revertedWithCustomError(registry, "PlayerIsBanned");
    });

    it("reverts when called by non-recorder", async () => {
      await expect(
        registry.connect(stranger).recordStats(player1.address, 1, 1, 1),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateReputation()
  // ---------------------------------------------------------------------------

  describe("updateReputation()", () => {
    beforeEach(async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
    });

    it("updates reputation score", async () => {
      await registry
        .connect(signingService)
        .updateReputation(player1.address, 500);
      const p = await registry.getProfile(player1.address);
      expect(p.reputationScore).to.equal(500n);
    });

    it("emits ReputationUpdated with old and new score", async () => {
      await registry
        .connect(signingService)
        .updateReputation(player1.address, 300);
      await expect(
        registry.connect(signingService).updateReputation(player1.address, 600),
      )
        .to.emit(registry, "ReputationUpdated")
        .withArgs(player1.address, 300, 600);
    });

    it("reverts for unregistered player", async () => {
      await expect(
        registry.connect(signingService).updateReputation(player2.address, 100),
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });
  });

  // ---------------------------------------------------------------------------
  // incrementSbtCount()
  // ---------------------------------------------------------------------------

  describe("incrementSbtCount()", () => {
    beforeEach(async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
    });

    it("reverts when called directly by non-SBT-contract address", async () => {
      await expect(
        registry.connect(signingService).incrementSbtCount(player1.address),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("increments sbtCount when called via SBT mint", async () => {
      // Register achievement type and mint an SBT — this triggers incrementSbtCount
      await sbt
        .connect(admin)
        .registerAchievementType("first_game", "ipfs://first_game", 1, 0);
      await sbt.connect(signingService).mint(player1.address, 1);
      const p = await registry.getProfile(player1.address);
      expect(p.sbtCount).to.equal(1n);
    });
  });

  // ---------------------------------------------------------------------------
  // linkExternalWallet()
  // ---------------------------------------------------------------------------

  describe("linkExternalWallet()", () => {
    beforeEach(async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
    });

    it("links an external wallet", async () => {
      await registry
        .connect(signingService)
        .linkExternalWallet(player1.address, player2.address);
      const p = await registry.getProfile(player1.address);
      expect(p.externalWallet).to.equal(player2.address);
    });

    it("emits ExternalWalletLinked event", async () => {
      await expect(
        registry
          .connect(signingService)
          .linkExternalWallet(player1.address, player2.address),
      )
        .to.emit(registry, "ExternalWalletLinked")
        .withArgs(player1.address, player2.address);
    });

    it("reverts on second link attempt", async () => {
      await registry
        .connect(signingService)
        .linkExternalWallet(player1.address, player2.address);
      await expect(
        registry
          .connect(signingService)
          .linkExternalWallet(player1.address, stranger.address),
      ).to.be.revertedWithCustomError(registry, "ExternalWalletAlreadyLinked");
    });

    it("reverts when external wallet is zero address", async () => {
      await expect(
        registry
          .connect(signingService)
          .linkExternalWallet(player1.address, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // banPlayer() / unbanPlayer()
  // ---------------------------------------------------------------------------

  describe("banPlayer() / unbanPlayer()", () => {
    beforeEach(async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
    });

    it("bans a player", async () => {
      await registry.connect(admin).banPlayer(player1.address);
      const p = await registry.getProfile(player1.address);
      expect(p.banned).to.be.true;
    });

    it("increments banCount on each ban", async () => {
      await registry.connect(admin).banPlayer(player1.address);
      await registry.connect(admin).unbanPlayer(player1.address);
      await registry.connect(admin).banPlayer(player1.address);
      const p = await registry.getProfile(player1.address);
      expect(p.banCount).to.equal(2n);
    });

    it("unbans a player", async () => {
      await registry.connect(admin).banPlayer(player1.address);
      await registry.connect(admin).unbanPlayer(player1.address);
      const p = await registry.getProfile(player1.address);
      expect(p.banned).to.be.false;
    });

    it("emits PlayerBanned and PlayerUnbanned events", async () => {
      await expect(registry.connect(admin).banPlayer(player1.address))
        .to.emit(registry, "PlayerBanned")
        .withArgs(player1.address);
      await expect(registry.connect(admin).unbanPlayer(player1.address))
        .to.emit(registry, "PlayerUnbanned")
        .withArgs(player1.address);
    });

    it("reverts ban on unregistered player", async () => {
      await expect(
        registry.connect(admin).banPlayer(player2.address),
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("reverts when non-admin tries to ban", async () => {
      await expect(
        registry.connect(stranger).banPlayer(player1.address),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // isActivePlayer()
  // ---------------------------------------------------------------------------

  describe("isActivePlayer()", () => {
    it("returns false for unregistered wallet", async () => {
      expect(await registry.isActivePlayer(player1.address)).to.be.false;
    });

    it("returns true for registered, non-banned player", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      expect(await registry.isActivePlayer(player1.address)).to.be.true;
    });

    it("returns false for banned player", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      await registry.connect(admin).banPlayer(player1.address);
      expect(await registry.isActivePlayer(player1.address)).to.be.false;
    });

    it("returns true again after unban", async () => {
      await registry.connect(signingService).registerPlayer(player1.address);
      await registry.connect(admin).banPlayer(player1.address);
      await registry.connect(admin).unbanPlayer(player1.address);
      expect(await registry.isActivePlayer(player1.address)).to.be.true;
    });
  });
});
