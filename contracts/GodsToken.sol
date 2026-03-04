// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title GodsToken
 * @author BlockchainGods
 * @notice Premium currency for Node Defenders — Blockchain Gods universe.
 *         Cannot be earned in-game. Acquired externally (purchase, airdrop,
 *         tournaments, staking rewards).
 *         EIP-2612 permit enables gasless marketplace approvals.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE — deployer, can grant/revoke roles
 *   MINTER_ROLE        — signing service only, used for airdrops and
 *                        tournament/staking rewards disbursement
 *
 * Key design decisions vs SoulToken:
 *   - Hard MAX_SUPPLY cap — scarcity is intentional for GODS
 *   - No batchMint — disbursements are less frequent, single mint is fine
 *   - No daily mint limit — MAX_SUPPLY is the constraint
 *   - ERC20Burnable for premium spend mechanics (Spend + Win, guild fees)
 *   - ERC20Permit (EIP-2612) for gasless marketplace approvals
 */
contract GodsToken is ERC20, ERC20Permit, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Hard supply cap — scarcity underpins GODS token value
    /// @dev    100 million tokens with 18 decimals
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Disbursed(address indexed recipient, uint256 amount, string reason);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ExceedsMaxSupply(uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();
    error EmptyReason();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param signingService Address of the signing service wallet.
     *                       Granted MINTER_ROLE on deployment.
     */
    constructor(
        address signingService
    ) ERC20("Gods", "GODS") ERC20Permit("Gods") {
        if (signingService == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, signingService);
    }

    // -------------------------------------------------------------------------
    // Minting
    // -------------------------------------------------------------------------

    /**
     * @notice Mint GODS to a recipient.
     *         Used for airdrops, tournament prizes, staking rewards.
     *         Not callable for in-game earn events — that is intentional.
     * @param to     Recipient address
     * @param amount Amount in wei (18 decimals)
     * @param reason Human-readable reason for audit trail (e.g. "tournament_win")
     */
    function mint(
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (bytes(reason).length == 0) revert EmptyReason();

        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) revert ExceedsMaxSupply(amount, available);

        _mint(to, amount);
        emit Disbursed(to, amount, reason);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Remaining mintable GODS supply
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}
