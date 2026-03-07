// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IUpgradeNFT {
    function mint(address to, uint256 typeId) external returns (uint256);

    function mintAndRent(
        address owner,
        address renter,
        uint256 typeId,
        uint64 duration
    ) external returns (uint256);

    function setUser(uint256 tokenId, address user, uint64 expires) external;

    function ownerOf(uint256 tokenId) external view returns (address);

    function userOf(uint256 tokenId) external view returns (address);

    function isRentalActive(uint256 tokenId) external view returns (bool);
}

interface ITreasury {
    function receiveFee(address token, address from, uint256 amount) external;

    function feeRateBps() external view returns (uint256);

    function computeFee(uint256 amount) external view returns (uint256);
}

interface IPlayerRegistry {
    function isActivePlayer(address wallet) external view returns (bool);
}

/**
 * @title Marketplace
 * @author BlockchainGods
 * @notice Buy and rent upgrade NFTs for Node Defenders using SOUL or GODS.
 *         Buy price and rent price are set per upgrade type.
 *         Rental tiers control duration only — not price.
 *         Uses EIP-2612 permit for gasless token approvals.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE — deployer, can set prices, tiers, and delist
 *   OPERATOR_ROLE      — signing service, executes purchases on behalf of players
 *
 * Pricing model:
 *   Each upgrade type has its own buy price and flat rent price.
 *   Rental tiers define available durations (1 day, 7 days, 30 days).
 *   Rent cost = upgrade type rentPrice (flat, regardless of tier chosen).
 *   Player picks a tier for duration — price comes from the upgrade type.
 *
 * Buy flow:
 *   1. Player permit sig authorises SOUL/GODS spend (EIP-2612, no separate tx)
 *   2. Operator calls buyUpgrade — payment transferred, fee routed to Treasury
 *   3. UpgradeNFT minted to buyer wallet
 *
 * Rent flow:
 *   1. Player permit sig authorises SOUL/GODS spend (EIP-2612, no separate tx)
 *   2. Operator calls rentUpgrade with chosen tierId
 *   3. Flat rent price transferred, fee routed to Treasury
 *   4. UpgradeNFT minted to escrow (this contract), renter set as ERC-4907 user
 *   5. On expiry, userOf returns zero address automatically — no cleanup needed
 */
contract Marketplace is AccessControl, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IERC20 public immutable soulToken;
    IERC20 public immutable godsToken;

    IUpgradeNFT public immutable upgradeNFT;
    ITreasury public immutable treasury;
    IPlayerRegistry public immutable playerRegistry;

    // -------------------------------------------------------------------------
    // Rental tiers — duration only
    // -------------------------------------------------------------------------

    struct RentalTier {
        /// @notice Human-readable label e.g. "1 Day", "7 Days"
        string label;
        /// @notice Duration in seconds
        uint64 duration;
        /// @notice Whether this tier is active
        bool active;
    }

    /// @notice tierId => RentalTier
    mapping(uint256 => RentalTier) public rentalTiers;

    /// @notice Total registered rental tiers
    uint256 public totalRentalTiers;

    // -------------------------------------------------------------------------
    // Upgrade pricing — buy + rent price per type
    // -------------------------------------------------------------------------

    struct UpgradePrice {
        /// @notice One-time buy price in SOUL (wei)
        uint256 buyPriceSoul;
        /// @notice One-time buy price in GODS (wei) — 0 if not available in GODS
        uint256 buyPriceGods;
        /// @notice Flat rent price in SOUL (wei) — applied regardless of tier duration
        uint256 rentPriceSoul;
        /// @notice Flat rent price in GODS (wei) — 0 if not available in GODS
        uint256 rentPriceGods;
        /// @notice Whether this upgrade type is listed
        bool listed;
    }

    /// @notice typeId => UpgradePrice
    mapping(uint256 => UpgradePrice) public prices;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event UpgradePurchased(
        address indexed buyer,
        uint256 indexed tokenId,
        uint256 indexed typeId,
        address paymentToken,
        uint256 pricePaid,
        uint256 feePaid
    );
    event UpgradeRented(
        address indexed renter,
        uint256 indexed tokenId,
        uint256 indexed typeId,
        uint256 tierId,
        address paymentToken,
        uint256 pricePaid,
        uint256 feePaid,
        uint64 expires
    );
    event RentalTierRegistered(
        uint256 indexed tierId,
        string label,
        uint64 duration
    );
    event RentalTierDeactivated(uint256 indexed tierId);
    event UpgradePriceSet(
        uint256 indexed typeId,
        uint256 buyPriceSoul,
        uint256 rentPriceSoul,
        uint256 buyPriceGods,
        uint256 rentPriceGods
    );
    event UpgradeDelisted(uint256 indexed typeId);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error NotRegisteredPlayer(address wallet);
    error UpgradeNotListed(uint256 typeId);
    error InvalidTier(uint256 tierId);
    error InactiveTier(uint256 tierId);
    error UnsupportedPaymentToken(address token);
    error GodsPaymentNotAvailable();
    error RentNotAvailable(uint256 typeId);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _soulToken      Deployed SoulToken address
     * @param _godsToken      Deployed GodsToken address
     * @param _upgradeNFT     Deployed UpgradeNFT address
     * @param _treasury       Deployed Treasury address
     * @param _playerRegistry Deployed PlayerRegistry address
     * @param _signingService Signing service address — granted OPERATOR_ROLE
     */
    constructor(
        address _soulToken,
        address _godsToken,
        address _upgradeNFT,
        address _treasury,
        address _playerRegistry,
        address _signingService
    ) {
        if (_soulToken == address(0)) revert ZeroAddress();
        if (_godsToken == address(0)) revert ZeroAddress();
        if (_upgradeNFT == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_playerRegistry == address(0)) revert ZeroAddress();
        if (_signingService == address(0)) revert ZeroAddress();

        soulToken = IERC20(_soulToken);
        godsToken = IERC20(_godsToken);
        upgradeNFT = IUpgradeNFT(_upgradeNFT);
        treasury = ITreasury(_treasury);
        playerRegistry = IPlayerRegistry(_playerRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, _signingService);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // -------------------------------------------------------------------------
    // Tier management — duration only
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new rental tier.
     *         Tiers define available durations only — price comes from upgrade type.
     * @param label    Display label e.g. "1 Day", "7 Days", "30 Days"
     * @param duration Duration in seconds
     */
    function registerRentalTier(
        string calldata label,
        uint64 duration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (duration == 0) revert ZeroAmount();

        uint256 tierId = ++totalRentalTiers;

        rentalTiers[tierId] = RentalTier({
            label: label,
            duration: duration,
            active: true
        });

        emit RentalTierRegistered(tierId, label, duration);
    }

    /// @notice Deactivate a rental tier
    function deactivateRentalTier(
        uint256 tierId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tierId == 0 || tierId > totalRentalTiers)
            revert InvalidTier(tierId);
        rentalTiers[tierId].active = false;
        emit RentalTierDeactivated(tierId);
    }

    // -------------------------------------------------------------------------
    // Upgrade price management
    // -------------------------------------------------------------------------

    /**
     * @notice Set buy and rent prices for an upgrade type.
     *         Call this when registering a new upgrade type in UpgradeNFT.
     *         Can be called again anytime to update prices — overwrites existing.
     * @param typeId        Upgrade type ID from UpgradeNFT
     * @param buyPriceSoul  Buy price in SOUL (wei)
     * @param rentPriceSoul Flat rent price in SOUL (wei) — set 0 to disable renting
     * @param buyPriceGods  Buy price in GODS (wei) — set 0 to disable GODS payment
     * @param rentPriceGods Flat rent price in GODS (wei) — set 0 to disable GODS rent
     */
    function setUpgradePrice(
        uint256 typeId,
        uint256 buyPriceSoul,
        uint256 rentPriceSoul,
        uint256 buyPriceGods,
        uint256 rentPriceGods
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (buyPriceSoul == 0) revert ZeroAmount();

        prices[typeId] = UpgradePrice({
            buyPriceSoul: buyPriceSoul,
            buyPriceGods: buyPriceGods,
            rentPriceSoul: rentPriceSoul,
            rentPriceGods: rentPriceGods,
            listed: true
        });

        emit UpgradePriceSet(
            typeId,
            buyPriceSoul,
            rentPriceSoul,
            buyPriceGods,
            rentPriceGods
        );
    }

    /// @notice Delist an upgrade type from the marketplace
    function delistUpgrade(
        uint256 typeId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        prices[typeId].listed = false;
        emit UpgradeDelisted(typeId);
    }

    // -------------------------------------------------------------------------
    // Buy
    // -------------------------------------------------------------------------

    /**
     * @notice Purchase permanent ownership of an upgrade NFT.
     * @param buyer        Custodial wallet of the buyer
     * @param typeId       Upgrade type to purchase
     * @param paymentToken SOUL or GODS token address
     */
    function buyUpgrade(
        address buyer,
        uint256 typeId,
        address paymentToken
    ) external onlyRole(OPERATOR_ROLE) nonReentrant returns (uint256 tokenId) {
        if (buyer == address(0)) revert ZeroAddress();
        if (!playerRegistry.isActivePlayer(buyer))
            revert NotRegisteredPlayer(buyer);

        UpgradePrice memory price = _assertListed(typeId);
        (IERC20 token, uint256 totalPrice) = _resolveBuyPrice(
            price,
            paymentToken
        );

        uint256 fee = treasury.computeFee(totalPrice);

        token.safeTransferFrom(buyer, address(this), totalPrice);
        token.safeTransfer(address(treasury), fee);

        tokenId = upgradeNFT.mint(buyer, typeId);

        emit UpgradePurchased(
            buyer,
            tokenId,
            typeId,
            paymentToken,
            totalPrice,
            fee
        );
    }

    // -------------------------------------------------------------------------
    // Rent
    // -------------------------------------------------------------------------

    /**
     * @notice Rent an upgrade NFT for a chosen duration tier.
     *         Price is flat per upgrade type — tier determines duration only.
     * @param renter       Custodial wallet of the renter
     * @param typeId       Upgrade type to rent
     * @param tierId       Duration tier (1 = 1 day, 2 = 7 days, 3 = 30 days)
     * @param paymentToken SOUL or GODS token address
     */
    function rentUpgrade(
        address renter,
        uint256 typeId,
        uint256 tierId,
        address paymentToken
    ) external onlyRole(OPERATOR_ROLE) nonReentrant returns (uint256 tokenId) {
        if (renter == address(0)) revert ZeroAddress();
        if (!playerRegistry.isActivePlayer(renter))
            revert NotRegisteredPlayer(renter);
        if (tierId == 0 || tierId > totalRentalTiers)
            revert InvalidTier(tierId);

        RentalTier memory tier = rentalTiers[tierId];
        if (!tier.active) revert InactiveTier(tierId);

        UpgradePrice memory price = _assertListed(typeId);
        (IERC20 token, uint256 totalPrice) = _resolveRentPrice(
            price,
            paymentToken,
            typeId
        );

        uint256 fee = treasury.computeFee(totalPrice);

        token.safeTransferFrom(renter, address(this), totalPrice);
        token.safeTransfer(address(treasury), fee);

        tokenId = upgradeNFT.mintAndRent(
            address(this),
            renter,
            typeId,
            tier.duration
        );

        uint64 expires = uint64(block.timestamp) + tier.duration;

        emit UpgradeRented(
            renter,
            tokenId,
            typeId,
            tierId,
            paymentToken,
            totalPrice,
            fee,
            expires
        );
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Get all active rental tiers — call from UI to populate duration options
    function getActiveTiers() external view returns (RentalTier[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= totalRentalTiers; i++) {
            if (rentalTiers[i].active) activeCount++;
        }
        RentalTier[] memory active = new RentalTier[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 1; i <= totalRentalTiers; i++) {
            if (rentalTiers[i].active) active[idx++] = rentalTiers[i];
        }
        return active;
    }

    /// @notice Compute buy cost including fee for a given type and token
    function computeBuyCost(
        uint256 typeId,
        address paymentToken
    ) external view returns (uint256 total, uint256 fee) {
        UpgradePrice memory price = prices[typeId];
        (, total) = _resolveBuyPrice(price, paymentToken);
        fee = treasury.computeFee(total);
    }

    /// @notice Compute rent cost including fee for a given type and token
    ///         Price is flat per upgrade type — tier does not affect price
    function computeRentCost(
        uint256 typeId,
        address paymentToken
    ) external view returns (uint256 total, uint256 fee) {
        UpgradePrice memory price = prices[typeId];
        (, total) = _resolveRentPrice(price, paymentToken, typeId);
        fee = treasury.computeFee(total);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _assertListed(
        uint256 typeId
    ) internal view returns (UpgradePrice memory) {
        UpgradePrice memory price = prices[typeId];
        if (!price.listed) revert UpgradeNotListed(typeId);
        return price;
    }

    function _assertSupportedToken(address token) internal view {
        if (token != address(soulToken) && token != address(godsToken)) {
            revert UnsupportedPaymentToken(token);
        }
    }

    function _resolveBuyPrice(
        UpgradePrice memory price,
        address paymentToken
    ) internal view returns (IERC20 token, uint256 totalPrice) {
        _assertSupportedToken(paymentToken);
        if (paymentToken == address(godsToken)) {
            if (price.buyPriceGods == 0) revert GodsPaymentNotAvailable();
            return (godsToken, price.buyPriceGods);
        }
        return (soulToken, price.buyPriceSoul);
    }

    function _resolveRentPrice(
        UpgradePrice memory price,
        address paymentToken,
        uint256 typeId
    ) internal view returns (IERC20 token, uint256 totalPrice) {
        _assertSupportedToken(paymentToken);
        if (paymentToken == address(godsToken)) {
            if (price.rentPriceGods == 0) revert GodsPaymentNotAvailable();
            return (godsToken, price.rentPriceGods);
        }
        if (price.rentPriceSoul == 0) revert RentNotAvailable(typeId);
        return (soulToken, price.rentPriceSoul);
    }
}
