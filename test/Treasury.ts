import { expect } from "chai";
import { parseEther } from "ethers";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { Treasury } from "../types/ethers-contracts/Treasury.js";
import type { SoulToken } from "../types/ethers-contracts/SoulToken.js";
import type { GodsToken } from "../types/ethers-contracts/GodsToken.js";
import { deployAll } from "./helpers/fixtures.js";

const T = (amount: number) => parseEther(amount.toString());

describe("Treasury", () => {
  let treasury: Treasury;
  let soul: SoulToken;
  let gods: GodsToken;
  let admin: HardhatEthersSigner;
  let signingService: HardhatEthersSigner;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let player3: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let marketplaceSigner: HardhatEthersSigner;
  let ethers: HardhatEthers;
  let soulAddress: string;
  let godsAddress: string;
  let treasuryAddress: string;

  // Seeds the treasury with SOUL reserves so distribution tests work
  async function seedSoulReserves(amount: bigint) {
    // Mint tokens to player1, approve treasury, then deposit via receiveFee
    await soul.connect(signingService).mint(player1.address, amount);
    await soul.connect(player1).approve(treasuryAddress, amount);
    await treasury
      .connect(marketplaceSigner)
      .receiveFee(soulAddress, player1.address, amount);
  }

  async function seedGodsReserves(amount: bigint) {
    await gods.connect(signingService).mint(player1.address, amount, "seed");
    await gods.connect(player1).approve(treasuryAddress, amount);
    await treasury
      .connect(marketplaceSigner)
      .receiveFee(godsAddress, player1.address, amount);
  }

  beforeEach(async () => {
    const connection = await hre.network.connect();
    ethers = connection.ethers;
    const deployed = await deployAll(ethers);
    ({
      treasury,
      soul,
      gods,
      admin,
      signingService,
      player1,
      player2,
      player3,
      stranger,
    } = deployed);

    // Use stranger as a marketplace signer — grant MARKETPLACE_ROLE
    marketplaceSigner = stranger;
    await treasury.grantRole(
      await treasury.MARKETPLACE_ROLE(),
      marketplaceSigner.address,
    );

    soulAddress = await soul.getAddress();
    godsAddress = await gods.getAddress();
    treasuryAddress = await treasury.getAddress();
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", () => {
    it("sets soulToken correctly", async () => {
      expect(await treasury.soulToken()).to.equal(soulAddress);
    });

    it("sets godsToken correctly", async () => {
      expect(await treasury.godsToken()).to.equal(godsAddress);
    });

    it("sets default fee rate to 500 bps (5%)", async () => {
      expect(await treasury.feeRateBps()).to.equal(500n);
    });

    it("sets MAX_FEE_BPS to 2000 (20%)", async () => {
      expect(await treasury.MAX_FEE_BPS()).to.equal(2000n);
    });

    it("grants DEFAULT_ADMIN_ROLE to deployer", async () => {
      const role = await treasury.DEFAULT_ADMIN_ROLE();
      expect(await treasury.hasRole(role, admin.address)).to.be.true;
    });

    it("grants DISTRIBUTOR_ROLE to signing service", async () => {
      const role = await treasury.DISTRIBUTOR_ROLE();
      expect(await treasury.hasRole(role, signingService.address)).to.be.true;
    });

    it("starts with zero reserves for both tokens", async () => {
      expect(await treasury.soulReserves()).to.equal(0n);
      expect(await treasury.godsReserves()).to.equal(0n);
    });

    it("reverts when any constructor address is zero", async () => {
      const Factory = await ethers.getContractFactory("Treasury", admin);
      await expect(
        Factory.deploy(ethers.ZeroAddress, godsAddress, signingService.address),
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
      await expect(
        Factory.deploy(soulAddress, ethers.ZeroAddress, signingService.address),
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
      await expect(
        Factory.deploy(soulAddress, godsAddress, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // computeFee()
  // ---------------------------------------------------------------------------

  describe("computeFee()", () => {
    it("computes 5% of amount at default rate", async () => {
      expect(await treasury.computeFee(T(1000))).to.equal(T(50));
    });

    it("returns zero for zero amount", async () => {
      expect(await treasury.computeFee(0n)).to.equal(0n);
    });
  });

  // ---------------------------------------------------------------------------
  // receiveFee()
  // ---------------------------------------------------------------------------

  describe("receiveFee()", () => {
    beforeEach(async () => {
      await soul.connect(signingService).mint(player1.address, T(1000));
      await soul.connect(player1).approve(treasuryAddress, T(1000));
    });

    it("transfers SOUL from payer to treasury and updates reserves", async () => {
      await treasury
        .connect(marketplaceSigner)
        .receiveFee(soulAddress, player1.address, T(100));
      expect(await treasury.soulReserves()).to.equal(T(100));
    });

    it("emits FeeReceived event", async () => {
      await expect(
        treasury
          .connect(marketplaceSigner)
          .receiveFee(soulAddress, player1.address, T(100)),
      )
        .to.emit(treasury, "FeeReceived")
        .withArgs(soulAddress, player1.address, T(100));
    });

    it("works with GODS token", async () => {
      await gods.connect(signingService).mint(player1.address, T(500), "setup");
      await gods.connect(player1).approve(treasuryAddress, T(500));
      await treasury
        .connect(marketplaceSigner)
        .receiveFee(godsAddress, player1.address, T(200));
      expect(await treasury.godsReserves()).to.equal(T(200));
    });

    it("reverts when called by non-marketplace address", async () => {
      await expect(
        treasury
          .connect(player2)
          .receiveFee(soulAddress, player1.address, T(100)),
      ).to.be.revertedWithCustomError(
        treasury,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("reverts on unsupported token", async () => {
      await expect(
        treasury
          .connect(marketplaceSigner)
          .receiveFee(ethers.ZeroAddress, player1.address, T(100)),
      ).to.be.revertedWithCustomError(treasury, "UnsupportedToken");
    });

    it("reverts on zero amount", async () => {
      await expect(
        treasury
          .connect(marketplaceSigner)
          .receiveFee(soulAddress, player1.address, 0n),
      ).to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });

    it("reverts on zero payer address", async () => {
      await expect(
        treasury
          .connect(marketplaceSigner)
          .receiveFee(soulAddress, ethers.ZeroAddress, T(100)),
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // distributeReward()
  // ---------------------------------------------------------------------------

  describe("distributeReward()", () => {
    beforeEach(async () => {
      await seedSoulReserves(T(1000));
    });

    it("transfers SOUL to recipient and decrements reserves", async () => {
      await treasury
        .connect(signingService)
        .distributeReward(
          soulAddress,
          player2.address,
          T(100),
          "weekly_rank_1",
        );
      expect(await soul.balanceOf(player2.address)).to.equal(T(100));
      expect(await treasury.soulReserves()).to.equal(T(900));
    });

    it("emits RewardDistributed event", async () => {
      await expect(
        treasury
          .connect(signingService)
          .distributeReward(
            soulAddress,
            player2.address,
            T(100),
            "weekly_rank_1",
          ),
      )
        .to.emit(treasury, "RewardDistributed")
        .withArgs(soulAddress, player2.address, T(100), "weekly_rank_1");
    });

    it("reverts when reserves are insufficient", async () => {
      await expect(
        treasury
          .connect(signingService)
          .distributeReward(soulAddress, player2.address, T(2000), "too_much"),
      ).to.be.revertedWithCustomError(treasury, "InsufficientReserves");
    });

    it("reverts on zero recipient address", async () => {
      await expect(
        treasury
          .connect(signingService)
          .distributeReward(soulAddress, ethers.ZeroAddress, T(100), "prize"),
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });

    it("reverts on zero amount", async () => {
      await expect(
        treasury
          .connect(signingService)
          .distributeReward(soulAddress, player2.address, 0n, "prize"),
      ).to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });

    it("reverts when called by non-distributor", async () => {
      await expect(
        treasury
          .connect(player2)
          .distributeReward(soulAddress, player2.address, T(100), "prize"),
      ).to.be.revertedWithCustomError(
        treasury,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // batchDistributeReward()
  // ---------------------------------------------------------------------------

  describe("batchDistributeReward()", () => {
    beforeEach(async () => {
      await seedSoulReserves(T(1000));
    });

    it("distributes SOUL to multiple recipients", async () => {
      const recipients = [player2.address, player3.address];
      const amounts = [T(100), T(200)];
      await treasury
        .connect(signingService)
        .batchDistributeReward(
          soulAddress,
          recipients,
          amounts,
          "daily_ranking",
        );
      expect(await soul.balanceOf(player2.address)).to.equal(T(100));
      expect(await soul.balanceOf(player3.address)).to.equal(T(200));
      expect(await treasury.soulReserves()).to.equal(T(700));
    });

    it("emits BatchRewardDistributed event", async () => {
      const recipients = [player2.address, player3.address];
      const amounts = [T(100), T(200)];
      await expect(
        treasury
          .connect(signingService)
          .batchDistributeReward(
            soulAddress,
            recipients,
            amounts,
            "daily_ranking",
          ),
      )
        .to.emit(treasury, "BatchRewardDistributed")
        .withArgs(soulAddress, T(300), 2);
    });

    it("reverts when total exceeds reserves", async () => {
      await expect(
        treasury
          .connect(signingService)
          .batchDistributeReward(
            soulAddress,
            [player2.address, player3.address],
            [T(600), T(600)],
            "too_much",
          ),
      ).to.be.revertedWithCustomError(treasury, "InsufficientReserves");
    });

    it("reverts on array length mismatch", async () => {
      await expect(
        treasury
          .connect(signingService)
          .batchDistributeReward(
            soulAddress,
            [player2.address, player3.address],
            [T(100)],
            "mismatch",
          ),
      ).to.be.revertedWithCustomError(treasury, "ArrayLengthMismatch");
    });

    it("reverts when a recipient is zero address", async () => {
      await expect(
        treasury
          .connect(signingService)
          .batchDistributeReward(
            soulAddress,
            [player2.address, ethers.ZeroAddress],
            [T(100), T(100)],
            "bad_recipient",
          ),
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // setFeeRate()
  // ---------------------------------------------------------------------------

  describe("setFeeRate()", () => {
    it("updates fee rate", async () => {
      await treasury.connect(admin).setFeeRate(1000);
      expect(await treasury.feeRateBps()).to.equal(1000n);
    });

    it("emits FeeRateUpdated event", async () => {
      await expect(treasury.connect(admin).setFeeRate(1000))
        .to.emit(treasury, "FeeRateUpdated")
        .withArgs(500, 1000);
    });

    it("allows setting fee rate to zero", async () => {
      await treasury.connect(admin).setFeeRate(0);
      expect(await treasury.feeRateBps()).to.equal(0n);
    });

    it("reverts when rate exceeds MAX_FEE_BPS (20%)", async () => {
      await expect(
        treasury.connect(admin).setFeeRate(2001),
      ).to.be.revertedWithCustomError(treasury, "InvalidFeeRate");
    });

    it("allows setting exactly MAX_FEE_BPS", async () => {
      await treasury.connect(admin).setFeeRate(2000);
      expect(await treasury.feeRateBps()).to.equal(2000n);
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        treasury.connect(stranger).setFeeRate(1000),
      ).to.be.revertedWithCustomError(
        treasury,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // withdrawReserves()
  // ---------------------------------------------------------------------------

  describe("withdrawReserves()", () => {
    beforeEach(async () => {
      await seedSoulReserves(T(1000));
    });

    it("withdraws SOUL to target address", async () => {
      await treasury
        .connect(admin)
        .withdrawReserves(soulAddress, player2.address, T(500));
      expect(await soul.balanceOf(player2.address)).to.equal(T(500));
      expect(await treasury.soulReserves()).to.equal(T(500));
    });

    it("emits ReservesWithdrawn event", async () => {
      await expect(
        treasury
          .connect(admin)
          .withdrawReserves(soulAddress, player2.address, T(500)),
      )
        .to.emit(treasury, "ReservesWithdrawn")
        .withArgs(soulAddress, player2.address, T(500));
    });

    it("reverts when amount exceeds reserves", async () => {
      await expect(
        treasury
          .connect(admin)
          .withdrawReserves(soulAddress, player2.address, T(2000)),
      ).to.be.revertedWithCustomError(treasury, "InsufficientReserves");
    });

    it("reverts on zero recipient address", async () => {
      await expect(
        treasury
          .connect(admin)
          .withdrawReserves(soulAddress, ethers.ZeroAddress, T(100)),
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        treasury
          .connect(stranger)
          .withdrawReserves(soulAddress, player2.address, T(100)),
      ).to.be.revertedWithCustomError(
        treasury,
        "AccessControlUnauthorizedAccount",
      );
    });
  });
});
