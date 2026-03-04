// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title PlayerRegistry
 * @author BlockchainGods
 * @notice On-chain record of player identity and reputation for Node Defenders.
 *         Maps custodial wallet addresses to player profiles.
 *         Serves as the reputation foundation for the cross-game universe.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE — deployer
 *   RECORDER_ROLE      — signing service, can register players and record stats
 *   SBT_CONTRACT_ROLE  — SBT contract, can increment SBT count on mint
 *
 * Key design decisions:
 *   - Wallet → PlayerProfile mapping, no PII stored on-chain
 *   - Reputation score computed from weighted stats, updatable by signing service
 *   - SBT count tracked here as a lightweight ref (full SBTs live in SBT contract)
 *   - Portable by design — readable by future games in the Blockchain Gods universe
 *   - Player can link an external wallet for future self-custody migration
 */
contract PlayerRegistry is AccessControl {
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    bytes32 public constant SBT_CONTRACT_ROLE = keccak256("SBT_CONTRACT_ROLE");

    // -------------------------------------------------------------------------
    // Data structures
    // -------------------------------------------------------------------------

    struct PlayerProfile {
        /// @notice Whether this wallet has been registered
        bool registered;
        /// @notice Unix timestamp of first registration
        uint256 registeredAt;
        /// @notice Total games played across all sessions
        uint256 gamesPlayed;
        /// @notice Total rounds survived across all sessions
        uint256 roundsSurvived;
        /// @notice Total enemies killed across all sessions
        uint256 enemiesKilled;
        /// @notice Number of SBTs minted to this wallet (ref count)
        uint256 sbtCount;
        /// @notice Reputation score — computed off-chain, written by signing service
        uint256 reputationScore;
        /// @notice Optional external wallet linked for self-custody migration
        address externalWallet;
        /// @notice Whether this player has been banned
        bool banned;
        /// @notice Lifetime ban count — persists through unbans, feeds reputation scoring
        uint256 banCount;
    }

    /// @notice wallet address => PlayerProfile
    mapping(address => PlayerProfile) public profiles;

    /// @notice Total registered players
    uint256 public totalPlayers;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event PlayerRegistered(address indexed wallet, uint256 timestamp);
    event StatsRecorded(
        address indexed wallet,
        uint256 gamesPlayed,
        uint256 roundsSurvived,
        uint256 enemiesKilled
    );
    event ReputationUpdated(
        address indexed wallet,
        uint256 oldScore,
        uint256 newScore
    );
    event SbtCountIncremented(address indexed wallet, uint256 newCount);
    event ExternalWalletLinked(
        address indexed custodialWallet,
        address indexed externalWallet
    );
    event PlayerBanned(address indexed wallet);
    event PlayerUnbanned(address indexed wallet);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error AlreadyRegistered(address wallet);
    error NotRegistered(address wallet);
    error PlayerIsBanned(address wallet);
    error ExternalWalletAlreadyLinked(address wallet);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param signingService Signing service address — granted RECORDER_ROLE
     */
    constructor(address signingService) {
        if (signingService == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RECORDER_ROLE, signingService);
    }

    // -------------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new custodial wallet as a player.
     *         Called by signing service when a new user is onboarded.
     * @param wallet Custodial wallet address generated for the player
     */
    function registerPlayer(address wallet) external onlyRole(RECORDER_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        if (profiles[wallet].registered) revert AlreadyRegistered(wallet);

        profiles[wallet] = PlayerProfile({
            registered: true,
            registeredAt: block.timestamp,
            gamesPlayed: 0,
            roundsSurvived: 0,
            enemiesKilled: 0,
            sbtCount: 0,
            reputationScore: 0,
            externalWallet: address(0),
            banned: false,
            banCount: 0
        });

        totalPlayers++;
        emit PlayerRegistered(wallet, block.timestamp);
    }

    // -------------------------------------------------------------------------
    // Stat recording
    // -------------------------------------------------------------------------

    /**
     * @notice Record cumulative stats for a player after a game session.
     *         Values are additive — pass deltas, not totals.
     * @param wallet        Custodial wallet address
     * @param games         Number of games completed in this session
     * @param rounds        Rounds survived in this session
     * @param enemies       Enemies killed in this session
     */
    function recordStats(
        address wallet,
        uint256 games,
        uint256 rounds,
        uint256 enemies
    ) external onlyRole(RECORDER_ROLE) {
        _assertActivePlayer(wallet);

        PlayerProfile storage profile = profiles[wallet];
        profile.gamesPlayed += games;
        profile.roundsSurvived += rounds;
        profile.enemiesKilled += enemies;

        emit StatsRecorded(
            wallet,
            profile.gamesPlayed,
            profile.roundsSurvived,
            profile.enemiesKilled
        );
    }

    /**
     * @notice Update a player's reputation score.
     *         Score is computed off-chain by your backend and written here.
     *         Keeps computation gas-free while keeping the result verifiable.
     * @param wallet    Custodial wallet address
     * @param newScore  New reputation score
     */
    function updateReputation(
        address wallet,
        uint256 newScore
    ) external onlyRole(RECORDER_ROLE) {
        _assertActivePlayer(wallet);

        uint256 oldScore = profiles[wallet].reputationScore;
        profiles[wallet].reputationScore = newScore;

        emit ReputationUpdated(wallet, oldScore, newScore);
    }

    /**
     * @notice Increment SBT count when a new SBT is minted to this wallet.
     *         Called by the SBT contract on every mint.
     * @param wallet Custodial wallet address
     */
    function incrementSbtCount(
        address wallet
    ) external onlyRole(SBT_CONTRACT_ROLE) {
        _assertActivePlayer(wallet);
        profiles[wallet].sbtCount++;
        emit SbtCountIncremented(wallet, profiles[wallet].sbtCount);
    }

    // -------------------------------------------------------------------------
    // External wallet linking
    // -------------------------------------------------------------------------

    /**
     * @notice Link an external self-custody wallet to a custodial wallet.
     *         Enables future migration path without losing reputation history.
     *         One-time operation per custodial wallet — cannot be changed once set.
     * @param custodialWallet  The in-game custodial wallet
     * @param externalWallet   The player's own external wallet (MetaMask etc.)
     */
    function linkExternalWallet(
        address custodialWallet,
        address externalWallet
    ) external onlyRole(RECORDER_ROLE) {
        _assertActivePlayer(custodialWallet);
        if (externalWallet == address(0)) revert ZeroAddress();
        if (profiles[custodialWallet].externalWallet != address(0)) {
            revert ExternalWalletAlreadyLinked(custodialWallet);
        }

        profiles[custodialWallet].externalWallet = externalWallet;
        emit ExternalWalletLinked(custodialWallet, externalWallet);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /**
     * @notice Grant SBT_CONTRACT_ROLE to the deployed SBT contract.
     *         Called once after SBT contract is deployed.
     * @param sbtContract Deployed SBT contract address
     */
    function setSbtContract(
        address sbtContract
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (sbtContract == address(0)) revert ZeroAddress();
        _grantRole(SBT_CONTRACT_ROLE, sbtContract);
    }

    /// @notice Ban a player wallet (e.g. cheating, exploit abuse)
    function banPlayer(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!profiles[wallet].registered) revert NotRegistered(wallet);
        profiles[wallet].banned = true;
        profiles[wallet].banCount++;
        emit PlayerBanned(wallet);
    }

    /// @notice Unban a player wallet
    function unbanPlayer(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!profiles[wallet].registered) revert NotRegistered(wallet);
        profiles[wallet].banned = false;
        emit PlayerUnbanned(wallet);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Get full profile for a wallet
    function getProfile(
        address wallet
    ) external view returns (PlayerProfile memory) {
        return profiles[wallet];
    }

    /// @notice Check if a wallet is a registered, active (non-banned) player
    function isActivePlayer(address wallet) external view returns (bool) {
        PlayerProfile memory p = profiles[wallet];
        return p.registered && !p.banned;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _assertActivePlayer(address wallet) internal view {
        if (!profiles[wallet].registered) revert NotRegistered(wallet);
        if (profiles[wallet].banned) revert PlayerIsBanned(wallet);
    }
}
