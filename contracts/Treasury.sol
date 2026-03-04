// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Treasury
 * @author BlockchainGods
 * @notice Central economic hub for Node Defenders.
 *         Receives marketplace fees, holds reserves, and distributes rewards.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE  — deployer, can update fee rate and withdraw reserves
 *   MARKETPLACE_ROLE    — marketplace contract, can deposit fees
 *   DISTRIBUTOR_ROLE    — signing service, can trigger reward payouts
 *
 * Key design decisions:
 *   - Accepts both SOUL and GODS to future-proof reward distribution
 *   - Fee rate is configurable by admin (default 5%)
 *   - ReentrancyGuard on all withdrawal/distribution functions
 *   - SafeERC20 for safe token transfers
 *   - Separate balance tracking per token for transparent accounting
 */

contract Treasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MARKETPLACE_ROLE = keccak256("MARKETPLACE_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    /// @notice Marketplace fee in basis points (500 = 5%)
    uint256 public feeRateBps = 500;

    /// @notice Maximum fee cap — admin cannot set above 20%
    uint256 public constant MAX_FEE_BPS = 2000;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice SOUL token contract
    IERC20 public immutable soulToken;

    /// @notice GODS token contract
    IERC20 public immutable godsToken;

    /// @notice Tracked balance per token address
    mapping(address => uint256) public reserves;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event FeeReceived(
        address indexed token,
        address indexed from,
        uint256 amount
    );
    event RewardDistributed(
        address indexed token,
        address indexed recipient,
        uint256 amount,
        string reason
    );
    event BatchRewardDistributed(
        address indexed token,
        uint256 totalAmount,
        uint256 recipientCount
    );
    event FeeRateUpdated(uint256 oldRateBps, uint256 newRateBps);
    event ReservesWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error InvalidFeeRate(uint256 rate, uint256 max);
    error InsufficientReserves(uint256 requested, uint256 available);
    error UnsupportedToken(address token);
    error ArrayLengthMismatch();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _soulToken     Deployed SoulToken contract address
     * @param _godsToken     Deployed GodsToken contract address
     * @param _signingService Signing service address — granted DISTRIBUTOR_ROLE
     */
    constructor(
        address _soulToken,
        address _godsToken,
        address _signingService
    ) {
        if (_soulToken == address(0)) revert ZeroAddress();
        if (_godsToken == address(0)) revert ZeroAddress();
        if (_signingService == address(0)) revert ZeroAddress();

        soulToken = IERC20(_soulToken);
        godsToken = IERC20(_godsToken);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DISTRIBUTOR_ROLE, _signingService);
    }

    // -------------------------------------------------------------------------
    // Fee receipt — called by Marketplace
    // -------------------------------------------------------------------------

    /**
     * @notice Receive marketplace fees.
     *         Called by the Marketplace contract after every buy/rent.
     * @param token  SOUL or GODS token address
     * @param from   Payer address (buyer/renter custodial wallet)
     * @param amount Fee amount in wei
     */
    function receiveFee(
        address token,
        address from,
        uint256 amount
    ) external onlyRole(MARKETPLACE_ROLE) nonReentrant {
        _assertSupportedToken(token);
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(from, address(this), amount);
        reserves[token] += amount;

        emit FeeReceived(token, from, amount);
    }

    // -------------------------------------------------------------------------
    // Reward distribution — called by signing service
    // -------------------------------------------------------------------------

    /**
     * @notice Distribute a reward to a single recipient.
     *         Used for tournament prizes, ranking rewards, milestone payouts.
     * @param token     SOUL or GODS token address
     * @param recipient Custodial wallet address
     * @param amount    Amount in wei
     * @param reason    Audit trail label (e.g. "weekly_rank_1", "tournament_prize")
     */
    function distributeReward(
        address token,
        address recipient,
        uint256 amount,
        string calldata reason
    ) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        _assertSupportedToken(token);
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (reserves[token] < amount) {
            revert InsufficientReserves(amount, reserves[token]);
        }

        reserves[token] -= amount;
        IERC20(token).safeTransfer(recipient, amount);

        emit RewardDistributed(token, recipient, amount, reason);
    }

    /**
     * @notice Distribute rewards to multiple recipients in one transaction.
     *         Used for daily/weekly ranking payouts to top N players.
     * @param token      SOUL or GODS token address
     * @param recipients Array of custodial wallet addresses
     * @param amounts    Corresponding reward amounts in wei
     * @param reason     Audit trail label (e.g. "daily_ranking_payout")
     */
    function batchDistributeReward(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts,
        string calldata reason
    ) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        _assertSupportedToken(token);
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }

        if (reserves[token] < total) {
            revert InsufficientReserves(total, reserves[token]);
        }

        reserves[token] -= total;

        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            IERC20(token).safeTransfer(recipients[i], amounts[i]);
        }

        emit BatchRewardDistributed(token, total, recipients.length);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /**
     * @notice Update the marketplace fee rate.
     * @param newRateBps New rate in basis points (e.g. 500 = 5%)
     */
    function setFeeRate(
        uint256 newRateBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRateBps > MAX_FEE_BPS)
            revert InvalidFeeRate(newRateBps, MAX_FEE_BPS);
        emit FeeRateUpdated(feeRateBps, newRateBps);
        feeRateBps = newRateBps;
    }

    /**
     * @notice Withdraw reserves to a target address.
     *         Emergency use or operational funding.
     * @param token  SOUL or GODS token address
     * @param to     Destination address
     * @param amount Amount in wei
     */
    function withdrawReserves(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        _assertSupportedToken(token);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (reserves[token] < amount) {
            revert InsufficientReserves(amount, reserves[token]);
        }

        reserves[token] -= amount;
        IERC20(token).safeTransfer(to, amount);

        emit ReservesWithdrawn(token, to, amount);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Compute the fee amount for a given transaction value
    function computeFee(uint256 amount) external view returns (uint256) {
        return (amount * feeRateBps) / BPS_DENOMINATOR;
    }

    /// @notice SOUL reserve balance
    function soulReserves() external view returns (uint256) {
        return reserves[address(soulToken)];
    }

    /// @notice GODS reserve balance
    function godsReserves() external view returns (uint256) {
        return reserves[address(godsToken)];
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _assertSupportedToken(address token) internal view {
        if (token != address(soulToken) && token != address(godsToken)) {
            revert UnsupportedToken(token);
        }
    }
}
