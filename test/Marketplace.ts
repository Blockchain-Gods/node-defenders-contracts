import { expect } from "chai";
import { parseEther } from "ethers";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { Marketplace } from "../types/ethers-contracts/Marketplace.sol/Marketplace.js";
import type { SoulToken } from "../types/ethers-contracts/SoulToken.js";
import type { GodsToken } from "../types/ethers-contracts/GodsToken.js";
import type { UpgradeNFT } from "../types/ethers-contracts/UpgradeNFT.sol/UpgradeNFT.js";
import type { Treasury } from "../types/ethers-contracts/Treasury.js";
import type { PlayerRegistry } from "../types/ethers-contracts/PlayerRegistry.js";
import { deployAll } from "./helpers/fixtures.js";

const T = (amount: number) => parseEther(amount.toString());
const Rarity = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
const ONE_DAY = 24 * 60 * 60;
const SEVEN_DAYS = 7 * ONE_DAY;

describe("Marketplace", () => {
  let marketplace: Marketplace;
  let soul: SoulToken;
  let gods: GodsToken;
  let upgradeNFT: UpgradeNFT;
  let treasury: Treasury;
  let registry: PlayerRegistry;
  let admin: HardhatEthersSigner;
  let signingService: HardhatEthersSigner;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let ethers: HardhatEthers;
  let soulAddress: string;
  let godsAddress: string;
  let marketplaceAddress: string;

  // Sets up:
  //   - upgrade typeId 1 registered + priced in both SOUL and GODS
  //   - rental tier 1 (1 day) + tier 2 (7 days)
  //   - player1 registered and funded with SOUL + GODS
  async function setup() {
    // Register upgrade type
    await upgradeNFT
      .connect(admin)
      .registerUpgradeType(
        "damage_boost_rare",
        "ipfs://damage_boost_rare",
        Rarity.Rare,
        1,
      );

    // Set buy price for typeId 1
    await marketplace.connect(admin).setUpgradePrice(1, T(100), T(10));

    // Register rental tiers
    await marketplace
      .connect(admin)
      .registerRentalTier("1 Day", ONE_DAY, T(10), T(1));
    await marketplace
      .connect(admin)
      .registerRentalTier("7 Days", SEVEN_DAYS, T(35), T(3));

    // Register player1
    await registry.connect(signingService).registerPlayer(player1.address);

    // Fund player1 with SOUL and GODS
    await soul.connect(signingService).mint(player1.address, T(10_000));
    await gods.connect(signingService).mint(player1.address, T(1_000), "setup");

    // Approve marketplace to spend player1's tokens
    await soul.connect(player1).approve(marketplaceAddress, T(10_000));
    await gods.connect(player1).approve(marketplaceAddress, T(1_000));
  }

  beforeEach(async () => {
    const connection = await hre.network.connect();
    ethers = connection.ethers;
    const deployed = await deployAll(ethers);
    ({
      marketplace,
      soul,
      gods,
      upgradeNFT,
      treasury,
      registry,
      admin,
      signingService,
      player1,
      player2,
      stranger,
    } = deployed);

    soulAddress = await soul.getAddress();
    godsAddress = await gods.getAddress();
    marketplaceAddress = await marketplace.getAddress();
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", () => {
    it("sets all contract references correctly", async () => {
      expect(await marketplace.soulToken()).to.equal(soulAddress);
      expect(await marketplace.godsToken()).to.equal(godsAddress);
      expect(await marketplace.upgradeNFT()).to.equal(
        await upgradeNFT.getAddress(),
      );
      expect(await marketplace.treasury()).to.equal(
        await treasury.getAddress(),
      );
      expect(await marketplace.playerRegistry()).to.equal(
        await registry.getAddress(),
      );
    });

    it("grants DEFAULT_ADMIN_ROLE to deployer", async () => {
      const role = await marketplace.DEFAULT_ADMIN_ROLE();
      expect(await marketplace.hasRole(role, admin.address)).to.be.true;
    });

    it("grants OPERATOR_ROLE to signing service", async () => {
      const role = await marketplace.OPERATOR_ROLE();
      expect(await marketplace.hasRole(role, signingService.address)).to.be
        .true;
    });
  });

  // ---------------------------------------------------------------------------
  // registerRentalTier()
  // ---------------------------------------------------------------------------

  describe("registerRentalTier()", () => {
    it("registers a new rental tier", async () => {
      await marketplace
        .connect(admin)
        .registerRentalTier("1 Day", ONE_DAY, T(10), T(1));
      const tier = await marketplace.rentalTiers(1);
      expect(tier.label).to.equal("1 Day");
      expect(tier.duration).to.equal(BigInt(ONE_DAY));
      expect(tier.priceSoul).to.equal(T(10));
      expect(tier.priceGods).to.equal(T(1));
      expect(tier.active).to.be.true;
    });

    it("increments totalRentalTiers", async () => {
      await marketplace
        .connect(admin)
        .registerRentalTier("1 Day", ONE_DAY, T(10), T(1));
      await marketplace
        .connect(admin)
        .registerRentalTier("7 Days", SEVEN_DAYS, T(35), T(3));
      expect(await marketplace.totalRentalTiers()).to.equal(2n);
    });

    it("emits RentalTierRegistered event", async () => {
      await expect(
        marketplace
          .connect(admin)
          .registerRentalTier("1 Day", ONE_DAY, T(10), T(1)),
      )
        .to.emit(marketplace, "RentalTierRegistered")
        .withArgs(1, "1 Day", ONE_DAY, T(10));
    });

    it("reverts on zero duration", async () => {
      await expect(
        marketplace.connect(admin).registerRentalTier("bad", 0, T(10), 0n),
      ).to.be.revertedWithCustomError(marketplace, "ZeroAmount");
    });

    it("reverts on zero SOUL price", async () => {
      await expect(
        marketplace.connect(admin).registerRentalTier("bad", ONE_DAY, 0n, 0n),
      ).to.be.revertedWithCustomError(marketplace, "ZeroAmount");
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        marketplace
          .connect(stranger)
          .registerRentalTier("1 Day", ONE_DAY, T(10), T(1)),
      ).to.be.revertedWithCustomError(
        marketplace,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // deactivateRentalTier()
  // ---------------------------------------------------------------------------

  describe("deactivateRentalTier()", () => {
    beforeEach(async () => {
      await marketplace
        .connect(admin)
        .registerRentalTier("1 Day", ONE_DAY, T(10), T(1));
    });

    it("deactivates a tier", async () => {
      await marketplace.connect(admin).deactivateRentalTier(1);
      const tier = await marketplace.rentalTiers(1);
      expect(tier.active).to.be.false;
    });

    it("emits RentalTierDeactivated event", async () => {
      await expect(marketplace.connect(admin).deactivateRentalTier(1))
        .to.emit(marketplace, "RentalTierDeactivated")
        .withArgs(1);
    });

    it("reverts on invalid tierId", async () => {
      await expect(
        marketplace.connect(admin).deactivateRentalTier(99),
      ).to.be.revertedWithCustomError(marketplace, "InvalidTier");
    });
  });

  // ---------------------------------------------------------------------------
  // setUpgradePrice() / delistUpgrade()
  // ---------------------------------------------------------------------------

  describe("setUpgradePrice()", () => {
    it("sets buy price for an upgrade type", async () => {
      await marketplace.connect(admin).setUpgradePrice(1, T(100), T(10));
      const price = await marketplace.prices(1);
      expect(price.buyPriceSoul).to.equal(T(100));
      expect(price.buyPriceGods).to.equal(T(10));
      expect(price.listed).to.be.true;
    });

    it("emits UpgradePriceSet event", async () => {
      await expect(marketplace.connect(admin).setUpgradePrice(1, T(100), T(10)))
        .to.emit(marketplace, "UpgradePriceSet")
        .withArgs(1, T(100), T(10));
    });

    it("reverts on zero SOUL price", async () => {
      await expect(
        marketplace.connect(admin).setUpgradePrice(1, 0n, T(10)),
      ).to.be.revertedWithCustomError(marketplace, "ZeroAmount");
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        marketplace.connect(stranger).setUpgradePrice(1, T(100), T(10)),
      ).to.be.revertedWithCustomError(
        marketplace,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("delistUpgrade()", () => {
    beforeEach(async () => {
      await marketplace.connect(admin).setUpgradePrice(1, T(100), T(10));
    });

    it("delists an upgrade type", async () => {
      await marketplace.connect(admin).delistUpgrade(1);
      const price = await marketplace.prices(1);
      expect(price.listed).to.be.false;
    });

    it("emits UpgradeDelisted event", async () => {
      await expect(marketplace.connect(admin).delistUpgrade(1))
        .to.emit(marketplace, "UpgradeDelisted")
        .withArgs(1);
    });
  });

  // ---------------------------------------------------------------------------
  // buyUpgrade()
  // ---------------------------------------------------------------------------

  describe("buyUpgrade()", () => {
    beforeEach(setup);

    it("mints NFT to buyer on SOUL purchase", async () => {
      await marketplace
        .connect(signingService)
        .buyUpgrade(player1.address, 1, soulAddress);
      expect(await upgradeNFT.ownerOf(1)).to.equal(player1.address);
    });

    it("routes fee to treasury on SOUL purchase", async () => {
      const price = T(100);
      const fee = (price * 500n) / 10_000n; // 5%
      await marketplace
        .connect(signingService)
        .buyUpgrade(player1.address, 1, soulAddress);
      expect(await treasury.soulReserves()).to.equal(fee);
    });

    it("deducts correct SOUL from buyer", async () => {
      const balanceBefore = await soul.balanceOf(player1.address);
      await marketplace
        .connect(signingService)
        .buyUpgrade(player1.address, 1, soulAddress);
      const balanceAfter = await soul.balanceOf(player1.address);
      expect(balanceBefore - balanceAfter).to.equal(T(100));
    });

    it("emits UpgradePurchased event", async () => {
      const fee = (T(100) * 500n) / 10_000n;
      await expect(
        marketplace
          .connect(signingService)
          .buyUpgrade(player1.address, 1, soulAddress),
      )
        .to.emit(marketplace, "UpgradePurchased")
        .withArgs(player1.address, 1, 1, soulAddress, T(100), fee);
    });

    it("mints NFT to buyer on GODS purchase", async () => {
      await marketplace
        .connect(signingService)
        .buyUpgrade(player1.address, 1, godsAddress);
      expect(await upgradeNFT.ownerOf(1)).to.equal(player1.address);
    });

    it("reverts for unregistered player", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .buyUpgrade(player2.address, 1, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "NotRegisteredPlayer");
    });

    it("reverts for unlisted upgrade type", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .buyUpgrade(player1.address, 99, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "UpgradeNotListed");
    });

    it("reverts when GODS price is not set but GODS payment used", async () => {
      // Set typeId 2 with no GODS price
      await upgradeNFT
        .connect(admin)
        .registerUpgradeType("range_boost", "ipfs://range", Rarity.Common, 1);
      await marketplace.connect(admin).setUpgradePrice(2, T(50), 0n);
      await expect(
        marketplace
          .connect(signingService)
          .buyUpgrade(player1.address, 2, godsAddress),
      ).to.be.revertedWithCustomError(marketplace, "GodsPaymentNotAvailable");
    });

    it("reverts on unsupported payment token", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .buyUpgrade(player1.address, 1, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(marketplace, "UnsupportedPaymentToken");
    });

    it("reverts when called by non-operator", async () => {
      await expect(
        marketplace
          .connect(stranger)
          .buyUpgrade(player1.address, 1, soulAddress),
      ).to.be.revertedWithCustomError(
        marketplace,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("reverts on zero buyer address", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .buyUpgrade(ethers.ZeroAddress, 1, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // rentUpgrade()
  // ---------------------------------------------------------------------------

  describe("rentUpgrade()", () => {
    beforeEach(setup);

    it("mints NFT to marketplace (escrow) and sets renter as ERC-4907 user", async () => {
      await marketplace
        .connect(signingService)
        .rentUpgrade(player1.address, 1, 1, soulAddress);
      expect(await upgradeNFT.ownerOf(1)).to.equal(marketplaceAddress);
      expect(await upgradeNFT.userOf(1)).to.equal(player1.address);
    });

    it("routes fee to treasury on rental", async () => {
      const price = T(10); // tier 1 SOUL price
      const fee = (price * 500n) / 10_000n;
      await marketplace
        .connect(signingService)
        .rentUpgrade(player1.address, 1, 1, soulAddress);
      expect(await treasury.soulReserves()).to.equal(fee);
    });

    it("deducts correct SOUL from renter", async () => {
      const balanceBefore = await soul.balanceOf(player1.address);
      await marketplace
        .connect(signingService)
        .rentUpgrade(player1.address, 1, 1, soulAddress);
      const balanceAfter = await soul.balanceOf(player1.address);
      expect(balanceBefore - balanceAfter).to.equal(T(10));
    });

    it("emits UpgradeRented event", async () => {
      const fee = (T(10) * 500n) / 10_000n;
      const tx = await marketplace
        .connect(signingService)
        .rentUpgrade(player1.address, 1, 1, soulAddress);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: any) => {
        try {
          const parsed = marketplace.interface.parseLog(log);
          return parsed?.name === "UpgradeRented";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
    });

    it("works with GODS payment on tier with GODS price set", async () => {
      await marketplace
        .connect(signingService)
        .rentUpgrade(player1.address, 1, 1, godsAddress);
      expect(await upgradeNFT.ownerOf(1)).to.equal(marketplaceAddress);
    });

    it("reverts for unregistered player", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .rentUpgrade(player2.address, 1, 1, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "NotRegisteredPlayer");
    });

    it("reverts for unlisted upgrade type", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .rentUpgrade(player1.address, 99, 1, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "UpgradeNotListed");
    });

    it("reverts for invalid tier", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .rentUpgrade(player1.address, 1, 99, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "InvalidTier");
    });

    it("reverts for inactive tier", async () => {
      await marketplace.connect(admin).deactivateRentalTier(1);
      await expect(
        marketplace
          .connect(signingService)
          .rentUpgrade(player1.address, 1, 1, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "InactiveTier");
    });

    it("reverts when called by non-operator", async () => {
      await expect(
        marketplace
          .connect(stranger)
          .rentUpgrade(player1.address, 1, 1, soulAddress),
      ).to.be.revertedWithCustomError(
        marketplace,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("reverts on zero renter address", async () => {
      await expect(
        marketplace
          .connect(signingService)
          .rentUpgrade(ethers.ZeroAddress, 1, 1, soulAddress),
      ).to.be.revertedWithCustomError(marketplace, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // getActiveTiers()
  // ---------------------------------------------------------------------------

  describe("getActiveTiers()", () => {
    it("returns empty array when no tiers registered", async () => {
      const tiers = await marketplace.getActiveTiers();
      expect(tiers.length).to.equal(0);
    });

    it("returns all active tiers", async () => {
      await marketplace
        .connect(admin)
        .registerRentalTier("1 Day", ONE_DAY, T(10), T(1));
      await marketplace
        .connect(admin)
        .registerRentalTier("7 Days", SEVEN_DAYS, T(35), T(3));
      const tiers = await marketplace.getActiveTiers();
      expect(tiers.length).to.equal(2);
    });

    it("excludes deactivated tiers", async () => {
      await marketplace
        .connect(admin)
        .registerRentalTier("1 Day", ONE_DAY, T(10), T(1));
      await marketplace
        .connect(admin)
        .registerRentalTier("7 Days", SEVEN_DAYS, T(35), T(3));
      await marketplace.connect(admin).deactivateRentalTier(1);
      const tiers = await marketplace.getActiveTiers();
      expect(tiers.length).to.equal(1);
      expect(tiers[0].label).to.equal("7 Days");
    });
  });

  // ---------------------------------------------------------------------------
  // computeBuyCost() / computeRentCost()
  // ---------------------------------------------------------------------------

  describe("computeBuyCost() / computeRentCost()", () => {
    beforeEach(setup);

    it("computeBuyCost returns correct total and fee for SOUL", async () => {
      const [total, fee] = await marketplace.computeBuyCost(1, soulAddress);
      expect(total).to.equal(T(100));
      expect(fee).to.equal((T(100) * 500n) / 10_000n);
    });

    it("computeBuyCost returns correct total and fee for GODS", async () => {
      const [total, fee] = await marketplace.computeBuyCost(1, godsAddress);
      expect(total).to.equal(T(10));
      expect(fee).to.equal((T(10) * 500n) / 10_000n);
    });

    it("computeRentCost returns correct total and fee for tier 1 SOUL", async () => {
      const [total, fee] = await marketplace.computeRentCost(1, soulAddress);
      expect(total).to.equal(T(10));
      expect(fee).to.equal((T(10) * 500n) / 10_000n);
    });
  });
});
