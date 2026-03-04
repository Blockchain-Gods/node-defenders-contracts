import { expect } from "chai";
import { parseEther } from "ethers";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { GodsToken } from "../types/ethers-contracts/GodsToken.js";
import { deployAll } from "./helpers/fixtures.js";

const GODS = (amount: number) => parseEther(amount.toString());
const MAX_SUPPLY = GODS(100_000_000);

describe("GodsToken", () => {
  let gods: GodsToken;
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
    time = connection.networkHelpers.time;
    const deployed = await deployAll(ethers);
    ({ gods, admin, signingService, player1, player2, stranger } = deployed);
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", () => {
    it("sets correct name and symbol", async () => {
      expect(await gods.name()).to.equal("Gods");
      expect(await gods.symbol()).to.equal("GODS");
    });

    it("sets MAX_SUPPLY to 100 million GODS", async () => {
      expect(await gods.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });

    it("grants DEFAULT_ADMIN_ROLE to deployer", async () => {
      const role = await gods.DEFAULT_ADMIN_ROLE();
      expect(await gods.hasRole(role, admin.address)).to.be.true;
    });

    it("grants MINTER_ROLE to signing service", async () => {
      const role = await gods.MINTER_ROLE();
      expect(await gods.hasRole(role, signingService.address)).to.be.true;
    });

    it("starts with zero total supply", async () => {
      expect(await gods.totalSupply()).to.equal(0n);
    });

    it("reverts when signing service is zero address", async () => {
      const Factory = await ethers.getContractFactory("GodsToken", admin);
      await expect(
        Factory.deploy(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(gods, "ZeroAddress");
    });
  });

  // ---------------------------------------------------------------------------
  // mint()
  // ---------------------------------------------------------------------------

  describe("mint()", () => {
    it("allows minter to mint with a valid reason", async () => {
      await gods
        .connect(signingService)
        .mint(player1.address, GODS(100), "tournament_win");
      expect(await gods.balanceOf(player1.address)).to.equal(GODS(100));
    });

    it("emits Disbursed event with correct data", async () => {
      await expect(
        gods
          .connect(signingService)
          .mint(player1.address, GODS(100), "tournament_win"),
      )
        .to.emit(gods, "Disbursed")
        .withArgs(player1.address, GODS(100), "tournament_win");
    });

    it("reverts when called by non-minter", async () => {
      await expect(
        gods
          .connect(stranger)
          .mint(player1.address, GODS(100), "tournament_win"),
      ).to.be.revertedWithCustomError(gods, "AccessControlUnauthorizedAccount");
    });

    it("reverts on zero address recipient", async () => {
      await expect(
        gods
          .connect(signingService)
          .mint(ethers.ZeroAddress, GODS(100), "tournament_win"),
      ).to.be.revertedWithCustomError(gods, "ZeroAddress");
    });

    it("reverts on zero amount", async () => {
      await expect(
        gods
          .connect(signingService)
          .mint(player1.address, 0n, "tournament_win"),
      ).to.be.revertedWithCustomError(gods, "ZeroAmount");
    });

    it("reverts on empty reason string", async () => {
      await expect(
        gods.connect(signingService).mint(player1.address, GODS(100), ""),
      ).to.be.revertedWithCustomError(gods, "EmptyReason");
    });

    it("reverts when amount exceeds remaining supply", async () => {
      await gods
        .connect(signingService)
        .mint(player1.address, MAX_SUPPLY, "seed");
      await expect(
        gods.connect(signingService).mint(player1.address, 1n, "extra"),
      ).to.be.revertedWithCustomError(gods, "ExceedsMaxSupply");
    });

    it("allows minting up to exact MAX_SUPPLY", async () => {
      await gods
        .connect(signingService)
        .mint(player1.address, MAX_SUPPLY, "full_mint");
      expect(await gods.totalSupply()).to.equal(MAX_SUPPLY);
    });
  });

  // ---------------------------------------------------------------------------
  // remainingSupply()
  // ---------------------------------------------------------------------------

  describe("remainingSupply()", () => {
    it("returns MAX_SUPPLY before any minting", async () => {
      expect(await gods.remainingSupply()).to.equal(MAX_SUPPLY);
    });

    it("decreases after minting", async () => {
      await gods
        .connect(signingService)
        .mint(player1.address, GODS(1_000_000), "airdrop");
      expect(await gods.remainingSupply()).to.equal(
        MAX_SUPPLY - GODS(1_000_000),
      );
    });

    it("returns zero when fully minted", async () => {
      await gods
        .connect(signingService)
        .mint(player1.address, MAX_SUPPLY, "full_mint");
      expect(await gods.remainingSupply()).to.equal(0n);
    });
  });

  // ---------------------------------------------------------------------------
  // Burn
  // ---------------------------------------------------------------------------

  describe("Burn", () => {
    beforeEach(async () => {
      await gods
        .connect(signingService)
        .mint(player1.address, GODS(1000), "setup");
    });

    it("allows holder to burn their own tokens", async () => {
      await gods.connect(player1).burn(GODS(500));
      expect(await gods.balanceOf(player1.address)).to.equal(GODS(500));
    });

    it("reduces total supply on burn", async () => {
      const before = await gods.totalSupply();
      await gods.connect(player1).burn(GODS(500));
      expect(await gods.totalSupply()).to.equal(before - GODS(500));
    });

    it("allows burnFrom with sufficient allowance", async () => {
      await gods.connect(player1).approve(stranger.address, GODS(300));
      await gods.connect(stranger).burnFrom(player1.address, GODS(300));
      expect(await gods.balanceOf(player1.address)).to.equal(GODS(700));
    });

    it("reverts burnFrom without sufficient allowance", async () => {
      await expect(
        gods.connect(stranger).burnFrom(player1.address, GODS(300)),
      ).to.be.revertedWithCustomError(gods, "ERC20InsufficientAllowance");
    });
  });

  // ---------------------------------------------------------------------------
  // Permit (EIP-2612)
  // ---------------------------------------------------------------------------

  describe("Permit (EIP-2612)", () => {
    it("allows gasless approval via valid permit signature", async () => {
      await gods
        .connect(signingService)
        .mint(player1.address, GODS(1000), "setup");

      const spender = player2.address;
      const value = GODS(500);
      const deadline = (await time.latest()) + 3600;
      const nonce = await gods.nonces(player1.address);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const domain = {
        name: "Gods",
        version: "1",
        chainId,
        verifyingContract: await gods.getAddress(),
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

      await gods.permit(player1.address, spender, value, deadline, v, r, s);
      expect(await gods.allowance(player1.address, spender)).to.equal(value);
    });

    it("reverts on expired permit deadline", async () => {
      const deadline = (await time.latest()) - 1;
      await expect(
        gods.permit(
          player1.address,
          player2.address,
          GODS(100),
          deadline,
          0,
          ethers.ZeroHash,
          ethers.ZeroHash,
        ),
      ).to.be.revertedWithCustomError(gods, "ERC2612ExpiredSignature");
    });
  });
});
