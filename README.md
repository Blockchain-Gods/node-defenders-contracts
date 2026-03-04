# Node Defenders — Smart Contracts

Solidity smart contracts for the **Blockchain Gods** game economy.

Blockchain is used as backend infrastructure for asset ownership and economy management — not as a financial incentive mechanism. There are no play-to-earn mechanics.

---

## Contracts

### SoulToken (`SOUL`)

ERC-20 in-game currency earned through gameplay and spent in the marketplace.

- Daily mint limit (default: 1M SOUL/day) protects against exploit drains — admin adjustable
- `batchMint` for gas-efficient periodic settlement of in-game earnings
- ERC-20Permit (EIP-2612) collapses approve + spend into a single transaction
- No hard supply cap — supply is governed by the daily rate limit

### GodsToken (`GODS`)

ERC-20 premium currency with a hard supply cap of 100M GODS.

- Fixed maximum supply enforced on-chain
- Requires a non-empty `reason` string on every mint for auditability
- ERC-20Permit (EIP-2612) support

### PlayerRegistry

On-chain player profiles scoped by wallet address.

- Stores stats (games played, rounds survived, enemies killed), reputation score, SBT count, and ban status
- Stats are additive — the backend submits deltas, not absolute values
- One-time external wallet linking for custodial → self-custody migration
- `isActivePlayer()` returns false for unregistered or banned wallets
- `incrementSbtCount()` restricted to the registered SBT contract address

### SBT (Soulbound Achievement Token)

Non-transferable ERC-721 achievement tokens.

- All transfer paths revert — tokens are permanently bound to the minting wallet
- Achievement types registered on-chain with name, URI, `gameId`, and `modeId`
- One token per wallet per achievement type — duplicates revert
- Automatically calls `incrementSbtCount` on PlayerRegistry on mint

### UpgradeNFT

Rentable and ownable turret upgrade modules. Implements [ERC-4907](https://eips.ethereum.org/EIPS/eip-4907) for dual owner/user roles.

- `owner` — permanent holder via standard ERC-721 transfer
- `user` — temporary renter set by Marketplace with an expiry timestamp
- `userOf()` returns `address(0)` automatically after rental expiry — no cleanup needed
- Upgrade types registered on-chain with rarity, `gameId`, and metadata URI
- Stat values (damage, range, fire rate etc.) live off-chain in CDN/DB

### Treasury

Central economic hub — receives marketplace fees and distributes rewards.

- Tracks `soulReserves` and `godsReserves` separately for transparent accounting
- Fee rate configurable by admin, capped at 20% (`MAX_FEE_BPS = 2000`)
- Default fee rate: 5% (`feeRateBps = 500`)
- `distributeReward` and `batchDistributeReward` for prize and ranking payouts
- `withdrawReserves` for admin-controlled reserve management

### Marketplace

Buy and rent upgrade NFTs using SOUL or GODS.

- **Buy flow** — permanent ownership, NFT minted directly to buyer wallet
- **Rent flow** — NFT minted to Marketplace escrow, renter set as ERC-4907 user for the rental duration
- Rental tiers registered by admin with fixed duration and price (e.g. 1 day, 7 days, 30 days)
- Implements `IERC721Receiver` to hold rented NFTs in escrow
- Fee routed to Treasury via `receiveFee` on every transaction
- EIP-2612 permit support — no separate approval transaction needed

---

## Roles

| Role                 | Contract                              | Granted To                                      |
| -------------------- | ------------------------------------- | ----------------------------------------------- |
| `DEFAULT_ADMIN_ROLE` | All                                   | Deployer                                        |
| `MINTER_ROLE`        | SoulToken, GodsToken, SBT, UpgradeNFT | Signing service + Marketplace (UpgradeNFT only) |
| `RECORDER_ROLE`      | PlayerRegistry                        | Signing service                                 |
| `MARKETPLACE_ROLE`   | Treasury, UpgradeNFT                  | Marketplace contract                            |
| `DISTRIBUTOR_ROLE`   | Treasury                              | Signing service                                 |
| `OPERATOR_ROLE`      | Marketplace                           | Signing service                                 |

---

## Post-Deploy Wiring

After deployment, the following role grants must be executed in order:

```bash
registry.setSbtContract(sbt.address)
upgradeNFT.grantRole(MARKETPLACE_ROLE, marketplace.address)
upgradeNFT.grantRole(MINTER_ROLE, marketplace.address)
treasury.grantRole(MARKETPLACE_ROLE, marketplace.address)
```

---

## Deployment Order

Contracts must be deployed in dependency order:

```
1. PlayerRegistry, SoulToken, GodsToken   (no dependencies)
2. Treasury, SBT, UpgradeNFT              (depend on step 1)
3. Marketplace                            (depends on all of step 1 and 2)
4. Post-deploy wiring                     (role grants)
```

---

## Standards

| Standard                       | Used By                  |
| ------------------------------ | ------------------------ |
| ERC-20                         | SoulToken, GodsToken     |
| EIP-2612 (Permit)              | SoulToken, GodsToken     |
| ERC-721                        | SBT, UpgradeNFT          |
| ERC-4907 (Rentable NFT)        | UpgradeNFT               |
| ERC-4337 (Account Abstraction) | Post-beta migration path |

---

## Development

**Stack:** Hardhat v3, ethers v6, TypeScript, Mocha

```bash
# Install dependencies
npm install

# Compile
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Fuji testnet
npx hardhat run scripts/deploy.ts --network fuji

# Deploy to Avalanche mainnet
npx hardhat run scripts/deploy.ts --network avalanche
```

**Test coverage:** 251 tests across 7 contracts — tokens, NFTs, registry, treasury, and marketplace including all role access, error paths, EIP-2612 permit flows, ERC-4907 rental expiry, and inter-contract interactions.

---

## Network

| Network                     | Chain ID | RPC                                          |
| --------------------------- | -------- | -------------------------------------------- |
| Avalanche C-Chain (mainnet) | 43114    | `https://api.avax.network/ext/bc/C/rpc`      |
| Fuji Testnet                | 43113    | `https://api.avax-test.network/ext/bc/C/rpc` |

Gas pricing uses dynamic fees — `gasPrice: "auto"` in Hardhat config.
