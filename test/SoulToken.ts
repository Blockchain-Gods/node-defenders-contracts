import { expect } from "chai";
import { parseEther } from "ethers";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { SoulToken } from "../types/ethers-contracts/SoulToken.js";

const SOUL = (amount: number) => parseEther(amount.toString());
const DAILY_LIMIT = SOUL(1_000_000);
const ONE_DAY = 24 * 60 * 60;

describe("SoulToken", () => {
  let soul: SoulToken;
  let admin: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let player3: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  // Single shared connection — all ethers calls and time manipulation
  // must go through the same instance or time.increase won't affect the chain
  // that the contract is deployed on.
  let ethers: HardhatEthers;
  let time: NetworkHelpers["time"];

  beforeEach(async () => {
    const connection = await hre.network.connect();
    ethers = connection.ethers;
    time = connection.networkHelpers.time;

    [admin, minter, player1, player2, player3, stranger] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("SoulToken", admin);
    soul = (await Factory.deploy(minter.address)) as unknown as SoulToken;
    await soul.waitForDeployment();
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", () => {
    it("sets the correct token name and symbol", async () => {
      expect(await soul.name()).to.equal("Soul");
      expect(await soul.symbol()).to.equal("SOUL");
    });

    it("grants DEFAULT_ADMIN_ROLE to deployer", async () => {
      const role = await soul.DEFAULT_ADMIN_ROLE();
      expect(await soul.hasRole(role, admin.address)).to.be.true;
    });

    it("grants MINTER_ROLE to signing service", async () => {
      const role = await soul.MINTER_ROLE();
      expect(await soul.hasRole(role, minter.address)).to.be.true;
    });

    it("sets default daily mint limit to 1 million SOUL", async () => {
      expect(await soul.dailyMintLimit()).to.equal(DAILY_LIMIT);
    });

    it("initialises mintedToday to zero", async () => {
      expect(await soul.mintedToday()).to.equal(0n);
    });

    it("sets windowStart close to deployment timestamp", async () => {
      const latest = await time.latest();
      const windowStart = await soul.windowStart();
      expect(Number(windowStart)).to.be.closeTo(latest, 5);
    });

    it("reverts when signing service is zero address", async () => {
      const Factory = await ethers.getContractFactory("SoulToken", admin);
      await expect(
        Factory.deploy(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(soul, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // mint()
  // ---------------------------------------------------------------------------

  describe("mint()", () => {
    it("allows minter to mint tokens to a recipient", async () => {
      await soul.connect(minter).mint(player1.address, SOUL(100));
      expect(await soul.balanceOf(player1.address)).to.equal(SOUL(100));
    });

    it("updates mintedToday after minting", async () => {
      await soul.connect(minter).mint(player1.address, SOUL(500));
      expect(await soul.mintedToday()).to.equal(SOUL(500));
    });

    it("reverts when called by non-minter", async () => {
      await expect(
        soul.connect(stranger).mint(player1.address, SOUL(100)),
      ).to.be.revertedWithCustomError(soul, "AccessControlUnauthorizedAccount");
    });

    it("reverts on zero recipient address", async () => {
      await expect(
        soul.connect(minter).mint(ethers.ZeroAddress, SOUL(100)),
      ).to.be.revertedWithCustomError(soul, "ZeroAddress");
    });

    it("reverts on zero amount", async () => {
      await expect(
        soul.connect(minter).mint(player1.address, 0n),
      ).to.be.revertedWithCustomError(soul, "ZeroAmount");
    });

    it("reverts when amount exceeds daily limit", async () => {
      await expect(
        soul.connect(minter).mint(player1.address, SOUL(1_000_001)),
      ).to.be.revertedWithCustomError(soul, "ExceedsDailyMintLimit");
    });

    it("allows minting up to exact daily limit", async () => {
      await soul.connect(minter).mint(player1.address, DAILY_LIMIT);
      expect(await soul.balanceOf(player1.address)).to.equal(DAILY_LIMIT);
    });
  });

  // ---------------------------------------------------------------------------
  // batchMint()
  // ---------------------------------------------------------------------------

  describe("batchMint()", () => {
    it("mints correct amounts to all recipients", async () => {
      const recipients = [player1.address, player2.address, player3.address];
      const amounts = [SOUL(100), SOUL(200), SOUL(300)];

      await soul.connect(minter).batchMint(recipients, amounts);

      expect(await soul.balanceOf(player1.address)).to.equal(SOUL(100));
      expect(await soul.balanceOf(player2.address)).to.equal(SOUL(200));
      expect(await soul.balanceOf(player3.address)).to.equal(SOUL(300));
    });

    it("emits BatchMinted event with correct data", async () => {
      const recipients = [player1.address, player2.address];
      const amounts = [SOUL(100), SOUL(200)];

      await expect(soul.connect(minter).batchMint(recipients, amounts))
        .to.emit(soul, "BatchMinted")
        .withArgs(recipients, amounts, SOUL(300));
    });

    it("updates mintedToday with the total batch amount", async () => {
      const recipients = [player1.address, player2.address];
      const amounts = [SOUL(100), SOUL(200)];

      await soul.connect(minter).batchMint(recipients, amounts);
      expect(await soul.mintedToday()).to.equal(SOUL(300));
    });

    it("reverts when array lengths mismatch", async () => {
      await expect(
        soul
          .connect(minter)
          .batchMint([player1.address, player2.address], [SOUL(100)]),
      ).to.be.revertedWithCustomError(soul, "ArrayLengthMismatch");
    });

    it("reverts when batch total exceeds daily limit", async () => {
      const recipients = [player1.address, player2.address];
      const amounts = [SOUL(600_000), SOUL(600_000)];

      await expect(
        soul.connect(minter).batchMint(recipients, amounts),
      ).to.be.revertedWithCustomError(soul, "ExceedsDailyMintLimit");
    });

    it("reverts when a recipient in the batch is zero address", async () => {
      const recipients = [player1.address, ethers.ZeroAddress];
      const amounts = [SOUL(100), SOUL(100)];

      await expect(
        soul.connect(minter).batchMint(recipients, amounts),
      ).to.be.revertedWithCustomError(soul, "ZeroAddress");
    });

    it("reverts when an amount in the batch is zero", async () => {
      const recipients = [player1.address, player2.address];
      const amounts = [SOUL(100), 0n];

      await expect(
        soul.connect(minter).batchMint(recipients, amounts),
      ).to.be.revertedWithCustomError(soul, "ZeroAmount");
    });

    it("reverts when called by non-minter", async () => {
      await expect(
        soul.connect(stranger).batchMint([player1.address], [SOUL(100)]),
      ).to.be.revertedWithCustomError(soul, "AccessControlUnauthorizedAccount");
    });
  });

  // ---------------------------------------------------------------------------
  // Daily limit & window reset
  // ---------------------------------------------------------------------------

  describe("Daily limit enforcement", () => {
    it("remainingDailyMint returns full limit at window start", async () => {
      expect(await soul.remainingDailyMint()).to.equal(DAILY_LIMIT);
    });

    it("remainingDailyMint decreases after minting", async () => {
      await soul.connect(minter).mint(player1.address, SOUL(250_000));
      expect(await soul.remainingDailyMint()).to.equal(SOUL(750_000));
    });

    it("resets window and allows full minting after 24h", async () => {
      await soul.connect(minter).mint(player1.address, DAILY_LIMIT);

      await time.increase(ONE_DAY);

      await soul.connect(minter).mint(player1.address, SOUL(500_000));
      expect(await soul.mintedToday()).to.equal(SOUL(500_000));
    });

    it("remainingDailyMint returns full limit after 24h without a new mint", async () => {
      await soul.connect(minter).mint(player1.address, SOUL(500_000));

      await time.increase(ONE_DAY);

      expect(await soul.remainingDailyMint()).to.equal(DAILY_LIMIT);
    });

    it("resets windowStart after first mint in new window", async () => {
      await time.increase(ONE_DAY);

      const before = await time.latest();
      await soul.connect(minter).mint(player1.address, SOUL(100));
      const windowStart = await soul.windowStart();

      expect(Number(windowStart)).to.be.closeTo(before, 5);
    });

    it("tracks cumulative mints within a window correctly", async () => {
      await soul.connect(minter).mint(player1.address, SOUL(300_000));
      await soul.connect(minter).mint(player2.address, SOUL(300_000));
      expect(await soul.mintedToday()).to.equal(SOUL(600_000));

      await expect(
        soul.connect(minter).mint(player3.address, SOUL(400_001)),
      ).to.be.revertedWithCustomError(soul, "ExceedsDailyMintLimit");
    });
  });

  // ---------------------------------------------------------------------------
  // setDailyMintLimit()
  // ---------------------------------------------------------------------------

  describe("setDailyMintLimit()", () => {
    it("allows admin to update the daily mint limit", async () => {
      await soul.connect(admin).setDailyMintLimit(SOUL(2_000_000));
      expect(await soul.dailyMintLimit()).to.equal(SOUL(2_000_000));
    });

    it("emits DailyMintLimitUpdated event", async () => {
      await expect(soul.connect(admin).setDailyMintLimit(SOUL(2_000_000)))
        .to.emit(soul, "DailyMintLimitUpdated")
        .withArgs(DAILY_LIMIT, SOUL(2_000_000));
    });

    it("reverts when called by non-admin", async () => {
      await expect(
        soul.connect(stranger).setDailyMintLimit(SOUL(2_000_000)),
      ).to.be.revertedWithCustomError(soul, "AccessControlUnauthorizedAccount");
    });

    it("reverts when new limit is zero", async () => {
      await expect(
        soul.connect(admin).setDailyMintLimit(0n),
      ).to.be.revertedWithCustomError(soul, "ZeroAmount");
    });
  });

  // ---------------------------------------------------------------------------
  // Burn (ERC20Burnable)
  // ---------------------------------------------------------------------------

  describe("Burn", () => {
    beforeEach(async () => {
      await soul.connect(minter).mint(player1.address, SOUL(1000));
    });

    it("allows holder to burn their own tokens", async () => {
      await soul.connect(player1).burn(SOUL(500));
      expect(await soul.balanceOf(player1.address)).to.equal(SOUL(500));
    });

    it("reduces total supply on burn", async () => {
      const supplyBefore = await soul.totalSupply();
      await soul.connect(player1).burn(SOUL(500));
      expect(await soul.totalSupply()).to.equal(supplyBefore - SOUL(500));
    });

    it("allows burnFrom with sufficient allowance", async () => {
      await soul.connect(player1).approve(stranger.address, SOUL(300));
      await soul.connect(stranger).burnFrom(player1.address, SOUL(300));
      expect(await soul.balanceOf(player1.address)).to.equal(SOUL(700));
    });

    it("reverts burnFrom without sufficient allowance", async () => {
      await expect(
        soul.connect(stranger).burnFrom(player1.address, SOUL(300)),
      ).to.be.revertedWithCustomError(soul, "ERC20InsufficientAllowance");
    });
  });

  // ---------------------------------------------------------------------------
  // Permit (EIP-2612)
  // ---------------------------------------------------------------------------

  describe("Permit (EIP-2612)", () => {
    it("allows gasless approval via valid permit signature", async () => {
      await soul.connect(minter).mint(player1.address, SOUL(1000));

      const spender = player2.address;
      const value = SOUL(500);
      const deadline = (await time.latest()) + 3600;
      const nonce = await soul.nonces(player1.address);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const domain = {
        name: "Soul",
        version: "1",
        chainId,
        verifyingContract: await soul.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const message = {
        owner: player1.address,
        spender,
        value,
        nonce,
        deadline,
      };
      const sig = await player1.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(sig);

      await soul.permit(player1.address, spender, value, deadline, v, r, s);
      expect(await soul.allowance(player1.address, spender)).to.equal(value);
    });

    it("reverts on expired permit deadline", async () => {
      const deadline = (await time.latest()) - 1;

      await expect(
        soul.permit(
          player1.address,
          player2.address,
          SOUL(100),
          deadline,
          0,
          ethers.ZeroHash,
          ethers.ZeroHash,
        ),
      ).to.be.revertedWithCustomError(soul, "ERC2612ExpiredSignature");
    });
  });
});
