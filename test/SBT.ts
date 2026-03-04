import { expect } from "chai";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { SBT } from "../types/ethers-contracts/SBT.sol/SBT.js";
import type { PlayerRegistry } from "../types/ethers-contracts/PlayerRegistry.js";
import { deployAll } from "./helpers/fixtures.js";

describe("SBT", () => {
  let sbt: SBT;
  let registry: PlayerRegistry;
  let admin: HardhatEthersSigner;
  let signingService: HardhatEthersSigner;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let ethers: HardhatEthers;

  // Helper — registers a player and an achievement type, returns typeId 1
  async function setup() {
    await registry.connect(signingService).registerPlayer(player1.address);
    await sbt
      .connect(admin)
      .registerAchievementType("first_game", "ipfs://first_game", 1, 0);
  }

  beforeEach(async () => {
    const connection = await hre.network.connect();
    ethers = connection.ethers;
    const deployed = await deployAll(ethers);
    ({ sbt, registry, admin, signingService, player1, player2, stranger } =
      deployed);
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", () => {
    it("sets correct name and symbol", async () => {
      expect(await sbt.name()).to.equal("BlockchainGods Achievement");
      expect(await sbt.symbol()).to.equal("BGACH");
    });

    it("grants DEFAULT_ADMIN_ROLE to deployer", async () => {
      const role = await sbt.DEFAULT_ADMIN_ROLE();
      expect(await sbt.hasRole(role, admin.address)).to.be.true;
    });

    it("grants MINTER_ROLE to signing service", async () => {
      const role = await sbt.MINTER_ROLE();
      expect(await sbt.hasRole(role, signingService.address)).to.be.true;
    });

    it("sets playerRegistry correctly", async () => {
      expect(await sbt.playerRegistry()).to.equal(await registry.getAddress());
    });

    it("reverts when signing service is zero address", async () => {
      const Factory = await ethers.getContractFactory("SBT", admin);
      await expect(
        Factory.deploy(ethers.ZeroAddress, await registry.getAddress()),
      ).to.be.revertedWithCustomError(sbt, "ZeroAddress");
    });

    it("reverts when player registry is zero address", async () => {
      const Factory = await ethers.getContractFactory("SBT", admin);
      await expect(
        Factory.deploy(signingService.address, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(sbt, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // registerAchievementType()
  // ---------------------------------------------------------------------------

  describe("registerAchievementType()", () => {
    it("registers a new achievement type", async () => {
      await sbt
        .connect(admin)
        .registerAchievementType("first_game", "ipfs://uri", 1, 0);
      const t = await sbt.achievementTypes(1);
      expect(t.name).to.equal("first_game");
      expect(t.active).to.be.true;
      expect(t.gameId).to.equal(1n);
      expect(t.modeId).to.equal(0n);
    });

    it("increments totalAchievementTypes", async () => {
      await sbt
        .connect(admin)
        .registerAchievementType("first_game", "ipfs://uri", 1, 0);
      await sbt
        .connect(admin)
        .registerAchievementType("survival_10", "ipfs://uri2", 1, 1);
      expect(await sbt.totalAchievementTypes()).to.equal(2n);
    });

    it("emits AchievementTypeRegistered event", async () => {
      await expect(
        sbt
          .connect(admin)
          .registerAchievementType("first_game", "ipfs://uri", 1, 0),
      )
        .to.emit(sbt, "AchievementTypeRegistered")
        .withArgs(1, "first_game", 1, 0);
    });

    it("reverts on empty name", async () => {
      await expect(
        sbt.connect(admin).registerAchievementType("", "ipfs://uri", 1, 0),
      ).to.be.revertedWithCustomError(sbt, "EmptyName");
    });

    it("reverts on empty URI", async () => {
      await expect(
        sbt.connect(admin).registerAchievementType("first_game", "", 1, 0),
      ).to.be.revertedWithCustomError(sbt, "EmptyURI");
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        sbt
          .connect(stranger)
          .registerAchievementType("first_game", "ipfs://uri", 1, 0),
      ).to.be.revertedWithCustomError(sbt, "AccessControlUnauthorizedAccount");
    });
  });

  // ---------------------------------------------------------------------------
  // deactivateAchievementType()
  // ---------------------------------------------------------------------------

  describe("deactivateAchievementType()", () => {
    beforeEach(async () => {
      await sbt
        .connect(admin)
        .registerAchievementType("first_game", "ipfs://uri", 1, 0);
    });

    it("deactivates an achievement type", async () => {
      await sbt.connect(admin).deactivateAchievementType(1);
      const t = await sbt.achievementTypes(1);
      expect(t.active).to.be.false;
    });

    it("emits AchievementTypeDeactivated event", async () => {
      await expect(sbt.connect(admin).deactivateAchievementType(1))
        .to.emit(sbt, "AchievementTypeDeactivated")
        .withArgs(1);
    });

    it("reverts on invalid typeId", async () => {
      await expect(
        sbt.connect(admin).deactivateAchievementType(99),
      ).to.be.revertedWithCustomError(sbt, "InvalidAchievementType");
    });
  });

  // ---------------------------------------------------------------------------
  // mint()
  // ---------------------------------------------------------------------------

  describe("mint()", () => {
    beforeEach(setup);

    it("mints an SBT to a registered player", async () => {
      await sbt.connect(signingService).mint(player1.address, 1);
      expect(await sbt.balanceOf(player1.address)).to.equal(1n);
    });

    it("sets tokenURI correctly", async () => {
      await sbt.connect(signingService).mint(player1.address, 1);
      expect(await sbt.tokenURI(1)).to.equal("ipfs://first_game");
    });

    it("marks hasMinted for wallet and typeId", async () => {
      await sbt.connect(signingService).mint(player1.address, 1);
      expect(await sbt.hasMinted(player1.address, 1)).to.be.true;
    });

    it("emits SBTMinted event", async () => {
      await expect(sbt.connect(signingService).mint(player1.address, 1))
        .to.emit(sbt, "SBTMinted")
        .withArgs(player1.address, 1, 1, "first_game");
    });

    it("increments sbtCount in PlayerRegistry", async () => {
      await sbt.connect(signingService).mint(player1.address, 1);
      const p = await registry.getProfile(player1.address);
      expect(p.sbtCount).to.equal(1n);
    });

    it("reverts on duplicate mint for same wallet and type", async () => {
      await sbt.connect(signingService).mint(player1.address, 1);
      await expect(
        sbt.connect(signingService).mint(player1.address, 1),
      ).to.be.revertedWithCustomError(sbt, "AlreadyMinted");
    });

    it("reverts for unregistered player", async () => {
      await expect(
        sbt.connect(signingService).mint(player2.address, 1),
      ).to.be.revertedWithCustomError(sbt, "NotRegisteredPlayer");
    });

    it("reverts for inactive achievement type", async () => {
      await sbt.connect(admin).deactivateAchievementType(1);
      await expect(
        sbt.connect(signingService).mint(player1.address, 1),
      ).to.be.revertedWithCustomError(sbt, "InactiveAchievementType");
    });

    it("reverts for invalid typeId", async () => {
      await expect(
        sbt.connect(signingService).mint(player1.address, 99),
      ).to.be.revertedWithCustomError(sbt, "InvalidAchievementType");
    });

    it("reverts on zero address wallet", async () => {
      await expect(
        sbt.connect(signingService).mint(ethers.ZeroAddress, 1),
      ).to.be.revertedWithCustomError(sbt, "ZeroAddress");
    });

    it("reverts when called by non-minter", async () => {
      await expect(
        sbt.connect(stranger).mint(player1.address, 1),
      ).to.be.revertedWithCustomError(sbt, "AccessControlUnauthorizedAccount");
    });
  });

  // ---------------------------------------------------------------------------
  // Soulbound enforcement
  // ---------------------------------------------------------------------------

  describe("Soulbound enforcement", () => {
    beforeEach(async () => {
      await setup();
      await sbt.connect(signingService).mint(player1.address, 1);
    });

    it("reverts on transferFrom", async () => {
      await expect(
        sbt.connect(player1).transferFrom(player1.address, player2.address, 1),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
    });

    it("reverts on safeTransferFrom", async () => {
      await expect(
        sbt
          .connect(player1)
          ["safeTransferFrom(address,address,uint256)"](
            player1.address,
            player2.address,
            1,
          ),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
    });

    it("reverts on approve", async () => {
      await expect(
        sbt.connect(player1).approve(player2.address, 1),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
    });

    it("reverts on setApprovalForAll", async () => {
      await expect(
        sbt.connect(player1).setApprovalForAll(player2.address, true),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
    });
  });

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  describe("hasAchievement()", () => {
    beforeEach(setup);

    it("returns false before mint", async () => {
      expect(await sbt.hasAchievement(player1.address, 1)).to.be.false;
    });

    it("returns true after mint", async () => {
      await sbt.connect(signingService).mint(player1.address, 1);
      expect(await sbt.hasAchievement(player1.address, 1)).to.be.true;
    });
  });
});
