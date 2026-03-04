// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPlayerRegistry {
    function isActivePlayer(address wallet) external view returns (bool);
}

/**
 * @title UpgradeNFT
 * @author BlockchainGods
 * @notice Rentable and ownable turret upgrade modules for Node Defenders.
 *         Implements ERC-4907 for dual owner/user roles.
 *         Owners hold permanently. Renters hold temporarily until expiry.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE — deployer, can register upgrade types
 *   MINTER_ROLE        — signing service, mints on buy/rent
 *   MARKETPLACE_ROLE   — marketplace contract, can set user role for rentals
 *
 * Upgrade types:
 *   Each type has a typeId, rarity, gameId, and metadata URI.
 *   Stat values (damage, range, fire rate etc.) live off-chain in your DB/CDN.
 *   On-chain only stores what is needed for ownership and rental enforcement.
 *
 * ERC-4907 summary:
 *   owner  = permanent holder, set via standard ERC-721 transfer
 *   user   = temporary renter, set by marketplace with an expiry timestamp
 *   userOf = returns zero address if rental has expired
 */
contract UpgradeNFT is
    ERC721,
    ERC721URIStorage,
    AccessControl,
    ReentrancyGuard
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant MARKETPLACE_ROLE = keccak256("MARKETPLACE_ROLE");

    /// @notice ERC-4907 interface ID
    bytes4 private constant _INTERFACE_ID_ERC4907 = 0xad092b5c;

    /// @notice PlayerRegistry contract reference
    IPlayerRegistry public immutable playerRegistry;

    // -------------------------------------------------------------------------
    // ERC-4907 user info
    // -------------------------------------------------------------------------

    struct UserInfo {
        /// @notice Current renter address
        address user;
        /// @notice Unix timestamp when rental expires
        uint64 expires;
    }

    /// @notice tokenId => UserInfo
    mapping(uint256 => UserInfo) private _users;

    // -------------------------------------------------------------------------
    // Upgrade type registry
    // -------------------------------------------------------------------------

    enum Rarity {
        Common,
        Uncommon,
        Rare,
        Epic,
        Legendary
    }

    struct UpgradeType {
        /// @notice Short identifier e.g. "damage_boost_rare"
        string name;
        /// @notice Metadata URI pointing to R2/CDN
        string metadataURI;
        /// @notice Rarity tier
        Rarity rarity;
        /// @notice gameId this upgrade belongs to
        uint256 gameId;
        /// @notice Whether this type is mintable
        bool active;
    }

    /// @notice typeId => UpgradeType
    mapping(uint256 => UpgradeType) public upgradeTypes;

    /// @notice Total registered upgrade types
    uint256 public totalUpgradeTypes;

    /// @notice tokenId => typeId
    mapping(uint256 => uint256) public tokenUpgradeType;

    /// @notice Running token ID counter
    uint256 private _nextTokenId;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice ERC-4907 required event
    event UpdateUser(
        uint256 indexed tokenId,
        address indexed user,
        uint64 expires
    );

    event UpgradeTypeRegistered(
        uint256 indexed typeId,
        string name,
        Rarity rarity,
        uint256 gameId
    );
    event UpgradeTypeDeactivated(uint256 indexed typeId);
    event UpgradeMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 indexed typeId
    );
    event RentalAssigned(
        uint256 indexed tokenId,
        address indexed renter,
        uint64 expires
    );
    event RentalExpired(uint256 indexed tokenId);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error InvalidUpgradeType(uint256 typeId);
    error InactiveUpgradeType(uint256 typeId);
    error NotRegisteredPlayer(address wallet);
    error NotOwner(uint256 tokenId, address caller);
    error InvalidRentalDuration();
    error RentalAlreadyActive(uint256 tokenId);
    error EmptyName();
    error EmptyURI();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param signingService  Signing service address — granted MINTER_ROLE
     * @param _playerRegistry Deployed PlayerRegistry contract address
     */
    constructor(
        address signingService,
        address _playerRegistry
    ) ERC721("Node Defenders Upgrade", "NDU") {
        if (signingService == address(0)) revert ZeroAddress();
        if (_playerRegistry == address(0)) revert ZeroAddress();

        playerRegistry = IPlayerRegistry(_playerRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, signingService);
    }

    // -------------------------------------------------------------------------
    // Upgrade type management
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new upgrade type.
     * @param name        Short identifier e.g. "range_boost_epic"
     * @param metadataURI URI pointing to upgrade metadata on R2/CDN
     * @param rarity      Rarity tier
     * @param gameId      Game this upgrade belongs to (1 = Node Defenders)
     */
    function registerUpgradeType(
        string calldata name,
        string calldata metadataURI,
        Rarity rarity,
        uint256 gameId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(metadataURI).length == 0) revert EmptyURI();

        uint256 typeId = ++totalUpgradeTypes;

        upgradeTypes[typeId] = UpgradeType({
            name: name,
            metadataURI: metadataURI,
            rarity: rarity,
            gameId: gameId,
            active: true
        });

        emit UpgradeTypeRegistered(typeId, name, rarity, gameId);
    }

    /**
     * @notice Deactivate an upgrade type — stops future mints.
     *         Existing tokens are unaffected.
     */
    function deactivateUpgradeType(
        uint256 typeId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (typeId == 0 || typeId > totalUpgradeTypes)
            revert InvalidUpgradeType(typeId);
        upgradeTypes[typeId].active = false;
        emit UpgradeTypeDeactivated(typeId);
    }

    // -------------------------------------------------------------------------
    // Minting — called by signing service via multicall on buy/rent
    // -------------------------------------------------------------------------

    /**
     * @notice Mint an upgrade NFT to a wallet (permanent ownership).
     *         Called by signing service as part of buy flow.
     * @param to     Recipient custodial wallet
     * @param typeId Upgrade type to mint
     */
    function mint(
        address to,
        uint256 typeId
    ) external onlyRole(MINTER_ROLE) nonReentrant returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        if (typeId == 0 || typeId > totalUpgradeTypes)
            revert InvalidUpgradeType(typeId);
        if (!upgradeTypes[typeId].active) revert InactiveUpgradeType(typeId);
        if (!playerRegistry.isActivePlayer(to)) revert NotRegisteredPlayer(to);

        uint256 tokenId = ++_nextTokenId;
        tokenUpgradeType[tokenId] = typeId;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, upgradeTypes[typeId].metadataURI);

        emit UpgradeMinted(to, tokenId, typeId);
        return tokenId;
    }

    /**
     * @notice Mint an upgrade NFT and immediately assign a renter.
     *         Called by signing service as part of rent flow.
     *         Owner = treasury/escrow address, User = renter wallet.
     * @param owner      Escrow/treasury address that holds the token
     * @param renter     Player renting the upgrade
     * @param typeId     Upgrade type to mint
     * @param duration   Rental duration in seconds
     */
    function mintAndRent(
        address owner,
        address renter,
        uint256 typeId,
        uint64 duration
    ) external onlyRole(MINTER_ROLE) nonReentrant returns (uint256) {
        if (owner == address(0) || renter == address(0)) revert ZeroAddress();
        if (typeId == 0 || typeId > totalUpgradeTypes)
            revert InvalidUpgradeType(typeId);
        if (!upgradeTypes[typeId].active) revert InactiveUpgradeType(typeId);
        if (!playerRegistry.isActivePlayer(renter))
            revert NotRegisteredPlayer(renter);
        if (duration == 0) revert InvalidRentalDuration();

        uint256 tokenId = ++_nextTokenId;
        tokenUpgradeType[tokenId] = typeId;

        _safeMint(owner, tokenId);
        _setTokenURI(tokenId, upgradeTypes[typeId].metadataURI);

        uint64 expires = uint64(block.timestamp) + duration;
        _users[tokenId] = UserInfo({user: renter, expires: expires});

        emit UpgradeMinted(owner, tokenId, typeId);
        emit UpdateUser(tokenId, renter, expires);
        emit RentalAssigned(tokenId, renter, expires);

        return tokenId;
    }

    // -------------------------------------------------------------------------
    // ERC-4907 — rental management
    // -------------------------------------------------------------------------

    /**
     * @notice Set or update the user (renter) for an existing token.
     *         Called by the Marketplace contract for secondary rentals.
     * @param tokenId  Token to assign renter to
     * @param user     Renter address
     * @param expires  Unix timestamp when rental expires
     */
    function setUser(
        uint256 tokenId,
        address user,
        uint64 expires
    ) external onlyRole(MARKETPLACE_ROLE) {
        if (_isRentalActive(tokenId)) revert RentalAlreadyActive(tokenId);
        if (expires <= block.timestamp) revert InvalidRentalDuration();

        _users[tokenId] = UserInfo({user: user, expires: expires});
        emit UpdateUser(tokenId, user, expires);
        emit RentalAssigned(tokenId, user, expires);
    }

    /**
     * @notice Returns the current user (renter) of a token.
     *         Returns zero address if no rental or rental has expired.
     * @param tokenId Token to query
     */
    function userOf(uint256 tokenId) public view returns (address) {
        UserInfo memory info = _users[tokenId];
        if (info.expires < block.timestamp) return address(0);
        return info.user;
    }

    /**
     * @notice Returns the expiry timestamp of the current rental.
     *         Returns 0 if no active rental.
     */
    function userExpires(uint256 tokenId) public view returns (uint64) {
        return _users[tokenId].expires;
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Get upgrade type details for a given token
    function getTokenUpgrade(
        uint256 tokenId
    ) external view returns (UpgradeType memory) {
        return upgradeTypes[tokenUpgradeType[tokenId]];
    }

    /// @notice Check whether a token has an active rental
    function isRentalActive(uint256 tokenId) external view returns (bool) {
        return _isRentalActive(tokenId);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _isRentalActive(uint256 tokenId) internal view returns (bool) {
        UserInfo memory info = _users[tokenId];
        return info.user != address(0) && info.expires >= block.timestamp;
    }

    // -------------------------------------------------------------------------
    // Required overrides
    // -------------------------------------------------------------------------

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        if (interfaceId == _INTERFACE_ID_ERC4907) return true;
        return super.supportsInterface(interfaceId);
    }
}
