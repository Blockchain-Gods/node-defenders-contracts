// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title SoulToken
 * @author BlockchainGods
 * @notice In-game currency for Node Defenders.
 *         Earned through gameplay, spent in the marketplace.
 *         EIP-2612 permit enables gasless marketplace approvals.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE — deployer, can grant/revoke roles and update mint limit
 *   MINTER_ROLE        — signing service only, can mint and batch mint
 *
 * Key design decisions:
 *   - No hard supply cap — supply is controlled by daily mint rate limit
 *   - Daily mint limit resets every 24 hours, protecting against exploit drains
 *   - batchMint for periodic settlement of in-game earnings (gas efficient)
 *   - ERC20Burnable for marketplace spend mechanics (Spend + Win, staking)
 *   - ERC20Permit (EIP-2612) collapses approve + spend into one tx
 */
contract SoulToken is ERC20, ERC20Permit, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Max SOUL mintable per 24h window — admin adjustable
    /// @dev    Default: 1 million tokens with 18 decimals
    uint256 public dailyMintLimit = 1_000_000 * 10 ** 18;

    /// @notice Tracks how much has been minted in the current window
    uint256 public mintedToday;

    /// @notice Timestamp when the current 24h window started
    uint256 public windowStart;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event BatchMinted(
        address[] recipients,
        uint256[] amounts,
        uint256 totalMinted
    );
    event DailyMintLimitUpdated(uint256 oldLimit, uint256 newLimit);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ExceedsDailyMintLimit(uint256 requested, uint256 available);
    error ArrayLengthMismatch();
    error ZeroAddress();
    error ZeroAmount();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param signingService Address of the signing service wallet.
     *                       Granted MINTER_ROLE on deployment.
     */
    constructor(
        address signingService
    ) ERC20("Soul", "SOUL") ERC20Permit("Soul") {
        if (signingService == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, signingService);

        windowStart = block.timestamp;
    }

    // -------------------------------------------------------------------------
    // Minting
    // -------------------------------------------------------------------------

    /**
     * @notice Mint SOUL to a single recipient.
     *         Used for on-demand settlement (user requests withdrawal).
     * @param to     Recipient address (custodial wallet)
     * @param amount Amount in wei (18 decimals)
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _enforceDailyLimit(amount);
        _mint(to, amount);
    }

    /**
     * @notice Mint SOUL to multiple recipients in one transaction.
     *         Used for periodic settlement of in-game earnings.
     *         Gas efficient — one tx covers all wallets in a settlement batch.
     * @param recipients Array of custodial wallet addresses
     * @param amounts    Corresponding SOUL amounts in wei
     */
    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyRole(MINTER_ROLE) {
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();

        uint256 totalToMint = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalToMint += amounts[i];
        }

        _enforceDailyLimit(totalToMint);

        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            _mint(recipients[i], amounts[i]);
        }

        emit BatchMinted(recipients, amounts, totalToMint);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /**
     * @notice Update the daily mint limit.
     *         Call this as the game grows and player base expands.
     * @param newLimit New daily limit in wei
     */
    function setDailyMintLimit(
        uint256 newLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newLimit == 0) revert ZeroAmount();
        emit DailyMintLimitUpdated(dailyMintLimit, newLimit);
        dailyMintLimit = newLimit;
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Remaining mintable SOUL in the current 24h window
    function remainingDailyMint() external view returns (uint256) {
        if (block.timestamp >= windowStart + 24 hours) return dailyMintLimit;
        return dailyMintLimit - mintedToday;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    /**
     * @dev Resets the window if 24h have passed, then checks and updates
     *      the running mint total for the current window.
     */
    function _enforceDailyLimit(uint256 amount) internal {
        if (block.timestamp >= windowStart + 24 hours) {
            mintedToday = 0;
            windowStart = block.timestamp;
        }

        uint256 available = dailyMintLimit - mintedToday;
        if (amount > available) revert ExceedsDailyMintLimit(amount, available);

        mintedToday += amount;
    }
}
