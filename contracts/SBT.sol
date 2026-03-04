// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface IPlayerRegistry {
    function incrementSbtCount(address wallet) external;
    function isActivePlayer(address wallet) external view returns (bool);
}

/**
 * @title SBT
 * @author BlockchainGods
 * @notice Soulbound achievement tokens for the Blockchain Gods universe.
 *         Non-transferable ERC-721 tokens permanently tied to a player wallet.
 *         Represent milestones, achievements, and verifiable game history.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE — deployer, can add new achievement types
 *   MINTER_ROLE        — signing service, mints SBTs on milestone events
 *
 * Achievement types:
 *   Each type has a typeId, name, and metadata URI.
 *   New types are registered by admin as the game expands.
 *   Examples: first_game, survival_10_rounds, tournament_winner, rental_veteran
 *
 * Soulbound enforcement:
 *   transferFrom, safeTransferFrom, and approve are all overridden to revert.
 *   Tokens are permanently bound to the minting wallet.
 */
contract SBT is ERC721, ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice PlayerRegistry contract reference
    IPlayerRegistry public immutable playerRegistry;

    // -------------------------------------------------------------------------
    // Achievement type registry
    // -------------------------------------------------------------------------

    struct AchievementType {
        /// @notice Short identifier e.g. "survival_10_rounds"
        string name;
        /// @notice Metadata URI for this achievement type (points to R2/CDN)
        string metadataURI;
        /// @notice Whether this type is currently active
        bool active;
        /// @notice gameId this achievement belongs to (0 = universal)
        uint256 gameId;
        /// @notice modeId this achievement belongs to (0 = universal)
        uint256 modeId;
    }

    /// @notice typeId => AchievementType
    mapping(uint256 => AchievementType) public achievementTypes;

    /// @notice Total registered achievement types
    uint256 public totalAchievementTypes;

    /// @notice wallet => typeId => whether already minted
    /// @dev    Prevents duplicate achievements per wallet
    mapping(address => mapping(uint256 => bool)) public hasMinted;

    /// @notice Running token ID counter
    uint256 private _nextTokenId;

    /// @notice tokenId => typeId
    mapping(uint256 => uint256) public tokenAchievementType;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event AchievementTypeRegistered(uint256 indexed typeId, string name, uint256 gameId, uint256 modeId);
    event AchievementTypeDeactivated(uint256 indexed typeId);
    event SBTMinted(address indexed wallet, uint256 indexed tokenId, uint256 indexed typeId, string name);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error Soulbound();
    error ZeroAddress();
    error InvalidAchievementType(uint256 typeId);
    error InactiveAchievementType(uint256 typeId);
    error AlreadyMinted(address wallet, uint256 typeId);
    error NotRegisteredPlayer(address wallet);
    error EmptyName();
    error EmptyURI();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param signingService   Signing service address — granted MINTER_ROLE
     * @param _playerRegistry  Deployed PlayerRegistry contract address
     */
    constructor(
        address signingService,
        address _playerRegistry
    ) ERC721("BlockchainGods Achievement", "BGACH") {
        if (signingService == address(0)) revert ZeroAddress();
        if (_playerRegistry == address(0)) revert ZeroAddress();

        playerRegistry = IPlayerRegistry(_playerRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, signingService);
    }

    // -------------------------------------------------------------------------
    // Achievement type management
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new achievement type.
     *         Called by admin when adding new milestones or expanding to new games.
     * @param name        Short identifier e.g. "tournament_winner"
     * @param metadataURI URI pointing to achievement metadata (R2/CDN)
     * @param gameId      Game this belongs to — 0 for universal achievements
     * @param modeId      Mode this belongs to — 0 for game-wide achievements
     */
    function registerAchievementType(
        string calldata name,
        string calldata metadataURI,
        uint256 gameId,
        uint256 modeId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(metadataURI).length == 0) revert EmptyURI();

        uint256 typeId = ++totalAchievementTypes;

        achievementTypes[typeId] = AchievementType({
            name: name,
            metadataURI: metadataURI,
            active: true,
            gameId: gameId,
            modeId: modeId
        });

        emit AchievementTypeRegistered(typeId, name, gameId, modeId);
    }

    /**
     * @notice Deactivate an achievement type — stops future mints of this type.
     *         Existing tokens of this type are unaffected.
     * @param typeId Achievement type to deactivate
     */
    function deactivateAchievementType(uint256 typeId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (typeId == 0 || typeId > totalAchievementTypes) revert InvalidAchievementType(typeId);
        achievementTypes[typeId].active = false;
        emit AchievementTypeDeactivated(typeId);
    }

    // -------------------------------------------------------------------------
    // Minting
    // -------------------------------------------------------------------------

    /**
     * @notice Mint an SBT to a player wallet.
     *         Called by the signing service when a player hits a milestone.
     *         Reverts if the player has already received this achievement type.
     * @param wallet Custodial wallet address
     * @param typeId Achievement type to mint
     */
    function mint(address wallet, uint256 typeId) external onlyRole(MINTER_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        if (typeId == 0 || typeId > totalAchievementTypes) revert InvalidAchievementType(typeId);
        if (!achievementTypes[typeId].active) revert InactiveAchievementType(typeId);
        if (hasMinted[wallet][typeId]) revert AlreadyMinted(wallet, typeId);
        if (!playerRegistry.isActivePlayer(wallet)) revert NotRegisteredPlayer(wallet);

        uint256 tokenId = ++_nextTokenId;

        hasMinted[wallet][typeId] = true;
        tokenAchievementType[tokenId] = typeId;

        _safeMint(wallet, tokenId);
        _setTokenURI(tokenId, achievementTypes[typeId].metadataURI);

        // Notify PlayerRegistry to increment sbtCount
        playerRegistry.incrementSbtCount(wallet);

        emit SBTMinted(wallet, tokenId, typeId, achievementTypes[typeId].name);
    }

    // -------------------------------------------------------------------------
    // Soulbound enforcement — all transfer paths revert
    // -------------------------------------------------------------------------

    function transferFrom(address, address, uint256) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Get achievement type details for a given token
    function getTokenAchievement(uint256 tokenId) external view returns (AchievementType memory) {
        return achievementTypes[tokenAchievementType[tokenId]];
    }

    /// @notice Check if a wallet has a specific achievement
    function hasAchievement(address wallet, uint256 typeId) external view returns (bool) {
        return hasMinted[wallet][typeId];
    }

    // -------------------------------------------------------------------------
    // Required overrides
    // -------------------------------------------------------------------------

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
