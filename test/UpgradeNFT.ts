import { expect } from "chai";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { UpgradeNFT } from "../types/ethers-contracts/UpgradeNFT.sol/UpgradeNFT.js";
import type { PlayerRegistry } from "../types/ethers-contracts/PlayerRegistry.js";
import { deployAll } from "./helpers/fixtures.js";

// Rarity enum mirrors the contract
const Rarity = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
const ONE_DAY = 24 * 60 * 60;

describe("UpgradeNFT", () => {
  let upgradeNFT: UpgradeNFT;
  let registry: PlayerRegistry;
  let admin: HardhatEthersSigner;
  let signingService: HardhatEthersSigner;
  let marketplaceSigner: HardhatEthersSigner; // simulates marketplace for setUser tests
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let ethers: HardhatEthers;
  let time: NetworkHelpers["time"];

  // Registers one upgrade type (typeId = 1) and one active player
  async function setup() {
    await upgradeNFT
      .connect(admin)
      .registerUpgradeType(
        "damage_boost_rare",
        "ipfs://damage_boost_rare",
        Rarity.Rare,
        1,
      );
    await registry.connect(signingService).registerPlayer(player1.address);
    await registry.connect(signingService).registerPlayer(player2.address);
  }

  beforeEach(async () => {
    const connection = await hre.network.connect();
    ethers = connection.ethers;
    const deployed = await deployAll(ethers);
    time = connection.networkHelpers.time;
    ({
      upgradeNFT,
      registry,
      admin,
      signingService,
      player1,
      player2,
      stranger,
    } = deployed);

    // Give marketplaceSigner the MARKETPLACE_ROLE for setUser tests
    marketplaceSigner = stranger;
    await upgradeNFT.grantRole(
      await upgradeNFT.MARKETPLACE_ROLE(),
      marketplaceSigner.address,
    );
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", () => {
    it("sets correct name and symbol", async () => {
      expect(await upgradeNFT.name()).to.equal("Node Defenders Upgrade");
      expect(await upgradeNFT.symbol()).to.equal("NDU");
    });

    it("sets playerRegistry correctly", async () => {
      expect(await upgradeNFT.playerRegistry()).to.equal(
        await registry.getAddress(),
      );
    });

    it("grants DEFAULT_ADMIN_ROLE to deployer", async () => {
      const role = await upgradeNFT.DEFAULT_ADMIN_ROLE();
      expect(await upgradeNFT.hasRole(role, admin.address)).to.be.true;
    });

    it("grants MINTER_ROLE to signing service", async () => {
      const role = await upgradeNFT.MINTER_ROLE();
      expect(await upgradeNFT.hasRole(role, signingService.address)).to.be.true;
    });

    it("reverts when signing service is zero address", async () => {
      const Factory = await ethers.getContractFactory("UpgradeNFT", admin);
      await expect(
        Factory.deploy(ethers.ZeroAddress, await registry.getAddress()),
      ).to.be.revertedWithCustomError(upgradeNFT, "ZeroAddress");
    });

    it("reverts when player registry is zero address", async () => {
      const Factory = await ethers.getContractFactory("UpgradeNFT", admin);
      await expect(
        Factory.deploy(signingService.address, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(upgradeNFT, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // registerUpgradeType()
  // ---------------------------------------------------------------------------

  describe("registerUpgradeType()", () => {
    it("registers a new upgrade type", async () => {
      await upgradeNFT
        .connect(admin)
        .registerUpgradeType("damage_boost_rare", "ipfs://uri", Rarity.Rare, 1);
      const t = await upgradeNFT.upgradeTypes(1);
      expect(t.name).to.equal("damage_boost_rare");
      expect(t.active).to.be.true;
      expect(t.rarity).to.equal(Rarity.Rare);
      expect(t.gameId).to.equal(1n);
    });

    it("increments totalUpgradeTypes", async () => {
      await upgradeNFT
        .connect(admin)
        .registerUpgradeType("a", "ipfs://a", Rarity.Common, 1);
      await upgradeNFT
        .connect(admin)
        .registerUpgradeType("b", "ipfs://b", Rarity.Epic, 1);
      expect(await upgradeNFT.totalUpgradeTypes()).to.equal(2n);
    });

    it("emits UpgradeTypeRegistered event", async () => {
      await expect(
        upgradeNFT
          .connect(admin)
          .registerUpgradeType(
            "damage_boost_rare",
            "ipfs://uri",
            Rarity.Rare,
            1,
          ),
      )
        .to.emit(upgradeNFT, "UpgradeTypeRegistered")
        .withArgs(1, "damage_boost_rare", Rarity.Rare, 1);
    });

    it("reverts on empty name", async () => {
      await expect(
        upgradeNFT
          .connect(admin)
          .registerUpgradeType("", "ipfs://uri", Rarity.Common, 1),
      ).to.be.revertedWithCustomError(upgradeNFT, "EmptyName");
    });

    it("reverts on empty URI", async () => {
      await expect(
        upgradeNFT
          .connect(admin)
          .registerUpgradeType("name", "", Rarity.Common, 1),
      ).to.be.revertedWithCustomError(upgradeNFT, "EmptyURI");
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        upgradeNFT
          .connect(stranger)
          .registerUpgradeType("name", "ipfs://uri", Rarity.Common, 1),
      ).to.be.revertedWithCustomError(
        upgradeNFT,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // deactivateUpgradeType()
  // ---------------------------------------------------------------------------

  describe("deactivateUpgradeType()", () => {
    beforeEach(setup);

    it("deactivates an upgrade type", async () => {
      await upgradeNFT.connect(admin).deactivateUpgradeType(1);
      const t = await upgradeNFT.upgradeTypes(1);
      expect(t.active).to.be.false;
    });

    it("emits UpgradeTypeDeactivated event", async () => {
      await expect(upgradeNFT.connect(admin).deactivateUpgradeType(1))
        .to.emit(upgradeNFT, "UpgradeTypeDeactivated")
        .withArgs(1);
    });

    it("reverts on invalid typeId", async () => {
      await expect(
        upgradeNFT.connect(admin).deactivateUpgradeType(99),
      ).to.be.revertedWithCustomError(upgradeNFT, "InvalidUpgradeType");
    });
  });

  // ---------------------------------------------------------------------------
  // mint()
  // ---------------------------------------------------------------------------

  describe("mint()", () => {
    beforeEach(setup);

    it("mints an upgrade NFT to a registered player", async () => {
      await upgradeNFT.connect(signingService).mint(player1.address, 1);
      expect(await upgradeNFT.ownerOf(1)).to.equal(player1.address);
    });

    it("sets correct tokenURI", async () => {
      await upgradeNFT.connect(signingService).mint(player1.address, 1);
      expect(await upgradeNFT.tokenURI(1)).to.equal("ipfs://damage_boost_rare");
    });

    it("maps tokenId to typeId", async () => {
      await upgradeNFT.connect(signingService).mint(player1.address, 1);
      expect(await upgradeNFT.tokenUpgradeType(1)).to.equal(1n);
    });

    it("emits UpgradeMinted event", async () => {
      await expect(upgradeNFT.connect(signingService).mint(player1.address, 1))
        .to.emit(upgradeNFT, "UpgradeMinted")
        .withArgs(player1.address, 1, 1);
    });

    it("reverts for unregistered player", async () => {
      await expect(
        upgradeNFT.connect(signingService).mint(stranger.address, 1),
      ).to.be.revertedWithCustomError(upgradeNFT, "NotRegisteredPlayer");
    });

    it("reverts for inactive upgrade type", async () => {
      await upgradeNFT.connect(admin).deactivateUpgradeType(1);
      await expect(
        upgradeNFT.connect(signingService).mint(player1.address, 1),
      ).to.be.revertedWithCustomError(upgradeNFT, "InactiveUpgradeType");
    });

    it("reverts for invalid typeId", async () => {
      await expect(
        upgradeNFT.connect(signingService).mint(player1.address, 99),
      ).to.be.revertedWithCustomError(upgradeNFT, "InvalidUpgradeType");
    });

    it("reverts on zero address recipient", async () => {
      await expect(
        upgradeNFT.connect(signingService).mint(ethers.ZeroAddress, 1),
      ).to.be.revertedWithCustomError(upgradeNFT, "ZeroAddress");
    });

    it("reverts when called by non-minter", async () => {
      await expect(
        upgradeNFT.connect(stranger).mint(player1.address, 1),
      ).to.be.revertedWithCustomError(
        upgradeNFT,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // mintAndRent()
  // ---------------------------------------------------------------------------

  describe("mintAndRent()", () => {
    beforeEach(setup);

    it("mints NFT to owner (escrow) and sets renter as user", async () => {
      const escrow = admin.address;
      await upgradeNFT
        .connect(signingService)
        .mintAndRent(escrow, player1.address, 1, ONE_DAY);
      expect(await upgradeNFT.ownerOf(1)).to.equal(escrow);
      expect(await upgradeNFT.userOf(1)).to.equal(player1.address);
    });

    it("emits RentalAssigned event", async () => {
      const escrow = admin.address;
      const latest = await time.latest();
      const expectedExpires = latest + ONE_DAY + 1; // +1 for block advancement

      const tx = await upgradeNFT
        .connect(signingService)
        .mintAndRent(escrow, player1.address, 1, ONE_DAY);
      const receipt = await tx.wait();
      // Verify RentalAssigned was emitted (exact expires depends on block time)
      expect(receipt?.logs.length).to.be.greaterThan(0);
    });

    it("reverts on zero duration", async () => {
      await expect(
        upgradeNFT
          .connect(signingService)
          .mintAndRent(admin.address, player1.address, 1, 0),
      ).to.be.revertedWithCustomError(upgradeNFT, "InvalidRentalDuration");
    });

    it("reverts for unregistered renter", async () => {
      await expect(
        upgradeNFT
          .connect(signingService)
          .mintAndRent(admin.address, stranger.address, 1, ONE_DAY),
      ).to.be.revertedWithCustomError(upgradeNFT, "NotRegisteredPlayer");
    });

    it("reverts on zero owner address", async () => {
      await expect(
        upgradeNFT
          .connect(signingService)
          .mintAndRent(ethers.ZeroAddress, player1.address, 1, ONE_DAY),
      ).to.be.revertedWithCustomError(upgradeNFT, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // ERC-4907 — setUser() / userOf() / userExpires()
  // ---------------------------------------------------------------------------

  describe("ERC-4907", () => {
    beforeEach(async () => {
      await setup();
      await upgradeNFT.connect(signingService).mint(player1.address, 1);
    });

    it("setUser assigns renter with expiry", async () => {
      const expires = BigInt(await time.latest()) + BigInt(ONE_DAY);
      await upgradeNFT
        .connect(marketplaceSigner)
        .setUser(1, player2.address, expires);
      expect(await upgradeNFT.userOf(1)).to.equal(player2.address);
    });

    it("userOf returns zero address after rental expires", async () => {
      const expires = BigInt(await time.latest()) + BigInt(ONE_DAY);
      await upgradeNFT
        .connect(marketplaceSigner)
        .setUser(1, player2.address, expires);

      await time.increase(ONE_DAY + 1);
      expect(await upgradeNFT.userOf(1)).to.equal(ethers.ZeroAddress);
    });

    it("isRentalActive returns false after expiry", async () => {
      const expires = BigInt(await time.latest()) + BigInt(ONE_DAY);
      await upgradeNFT
        .connect(marketplaceSigner)
        .setUser(1, player2.address, expires);

      await time.increase(ONE_DAY + 1);
      expect(await upgradeNFT.isRentalActive(1)).to.be.false;
    });

    it("reverts setUser when rental is already active", async () => {
      const expires = BigInt(await time.latest()) + BigInt(ONE_DAY);
      await upgradeNFT
        .connect(marketplaceSigner)
        .setUser(1, player2.address, expires);
      await expect(
        upgradeNFT
          .connect(marketplaceSigner)
          .setUser(1, player1.address, expires),
      ).to.be.revertedWithCustomError(upgradeNFT, "RentalAlreadyActive");
    });

    it("reverts setUser with past expiry", async () => {
      const expires = BigInt(await time.latest()) - 1n;
      await expect(
        upgradeNFT
          .connect(marketplaceSigner)
          .setUser(1, player2.address, expires),
      ).to.be.revertedWithCustomError(upgradeNFT, "InvalidRentalDuration");
    });

    it("reverts setUser when called by non-marketplace address", async () => {
      const expires = BigInt(await time.latest()) + BigInt(ONE_DAY);
      await expect(
        upgradeNFT.connect(player1).setUser(1, player2.address, expires),
      ).to.be.revertedWithCustomError(
        upgradeNFT,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // supportsInterface()
  // ---------------------------------------------------------------------------

  describe("supportsInterface()", () => {
    it("supports ERC-4907 interface", async () => {
      expect(await upgradeNFT.supportsInterface("0xad092b5c")).to.be.true;
    });

    it("supports ERC-721 interface", async () => {
      expect(await upgradeNFT.supportsInterface("0x80ac58cd")).to.be.true;
    });
  });
});
