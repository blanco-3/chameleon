# Chameleon — Design Specification

Chameleon is a compliance-aware privacy pool on the Stellar blockchain. It is a Tornado-Cash-style
mixer with a fixed denomination of 100 XLM plus a zero-knowledge compliance proof: when withdrawing,
a user proves in zero knowledge that their deposit commitment is NOT in a blacklist set, without
revealing which deposit is theirs.

---

## 1. Overview

Users deposit exactly 100 XLM and receive a secret note. To withdraw, they generate a Noir (UltraHonk)
proof demonstrating:
1. They know a (nullifier, secret) pair whose Poseidon commitment is in the Merkle tree (membership).
2. Poseidon(nullifier) equals the publicly known nullifier_hash (spend prevention).
3. Their commitment is NOT in any of the 16 blacklist slots (compliance).
4. The recipient, relayer, and fee are bound into the proof (anti-front-running).

---

## 2. Cryptography

- Hash: Poseidon over BN254 (Noir std library `std::hash::poseidon2`, t=2 sponge)
- Commitment: `C = Poseidon([nullifier, secret])`
- Nullifier hash: `NH = Poseidon([nullifier])`
- Merkle tree: binary incremental tree, depth 20, zeros computed with Poseidon
- Proof system: UltraHonk via Barretenberg (`bb`)

---

## 3. Parameters

| Parameter | Value |
|---|---|
| Denomination | 100 XLM = 1,000,000,000 stroops |
| Merkle depth | 20 |
| Root history size | 30 |
| Blacklist size (circuit) | 16 (zero-padded) |
| Zero leaf | `Poseidon([0, 0])` |

---

## 4. Directory Structure

```
chameleon/
├── circuits/
│   └── privacy_pool/
│       ├── Nargo.toml
│       └── src/
│           ├── main.nr          # top-level circuit
│           ├── hash.nr          # Poseidon wrappers
│           ├── merkle.nr        # Merkle proof verification
│           └── blacklist.nr     # Non-membership check
├── contracts/
│   ├── Cargo.toml               # workspace
│   ├── privacy_pool/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs           # contract entry points
│   │       ├── storage.rs       # storage keys/getters/setters
│   │       ├── errors.rs        # error enum
│   │       ├── merkle.rs        # incremental Merkle tree
│   │       └── verifier.rs      # UltraHonk verifier wrapper
│   └── vendor/                  # rs-soroban-ultrahonk vendored
├── cli/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # CLI entry point / commands
│       ├── note.ts              # Note keygen, serialization
│       ├── poseidon.ts          # Poseidon wrapper (noble-curves or noble-poseidon)
│       ├── merkle.ts            # Off-chain Merkle tree reconstruction
│       ├── prover.ts            # nargo/bb shell-out, proof serialization
│       └── stellar.ts           # Stellar SDK helpers, tx building
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── DepositCard.tsx
│       ├── WithdrawCard.tsx
│       └── NoteManager.tsx
├── scripts/
│   ├── gen_vk.sh
│   ├── deploy.sh
│   ├── seed_blacklist.sh
│   └── demo.sh
├── .github/
│   └── workflows/
│       └── ci.yml
├── Makefile
├── README.md
├── DESIGN.md
└── .gitignore
```

---

## 5. Component Specifications

### 5.1 Noir Circuit (`circuits/privacy_pool/src/main.nr`)

**Public inputs (in order):**
```
root          : Field   // Merkle root
nullifier_hash: Field   // Poseidon(nullifier)
recipient     : Field   // withdrawal destination (anti-malleability anchor)
relayer       : Field   // relayer address (0 if none)
fee           : Field   // fee in stroops (0 if none)
blacklist_root: Field   // Poseidon root of blacklist set (must match on-chain)
```

**Private inputs:**
```
nullifier      : Field
secret         : Field
path_elements  : [Field; 20]
path_indices   : [Field; 20]
blacklist      : [Field; 16]    // zero-padded
```

**Logic:**
1. `commitment = Poseidon([nullifier, secret])`
2. Assert `Poseidon([nullifier]) == nullifier_hash`
3. Verify Merkle path: `merkle_root(commitment, path_elements, path_indices) == root`
4. For each `b` in `blacklist`: if `b != 0`, assert `commitment != b`
5. Anti-malleability: `recipient`, `relayer`, `fee` are public inputs (constrained by being used in the proof)
6. `blacklist_root` is a public input constraining which blacklist was checked

### 5.2 Soroban Contract (`contracts/privacy_pool/`)

**Storage keys:**
- `Admin` → Address
- `Token` → Address (native XLM SAC)
- `Denomination` → i128
- `NextIndex` → u32
- `FilledSubtree(level: u32)` → BytesN<32>
- `Root` → BytesN<32>
- `RootHistory(idx: u32)` → BytesN<32>
- `RootHistoryCurrent` → u32
- `Commitment(c: BytesN<32>)` → bool
- `Nullifier(n: BytesN<32>)` → bool
- `VerificationKey` → Bytes
- `BlacklistRoot` → BytesN<32>
- `BlacklistEntry(i: u32)` → BytesN<32>

**Error codes:**
```
1  AlreadyInitialized
2  NotInitialized
3  InvalidDenomination
4  CommitmentExists
5  TreeFull
6  UnknownRoot
7  NullifierSpent
8  InvalidProof
9  StaleBlacklist
10 Unauthorized
11 InvalidPublicInputs
12 FeeTooHigh
```

**Functions:**
- `initialize(admin, token, vk, denomination, depth)` — one-time setup
- `deposit(from, commitment)` — pull 100 XLM, insert leaf, emit event
- `withdraw(root, nullifier_hash, recipient, relayer, fee, blacklist_root, proof, public_inputs)` — verify proof, pay out
- `set_blacklist(admin, root, entries)` — update blacklist root + entries
- `set_vk(admin, vk)` — rotate verification key
- `get_root() -> BytesN<32>`
- `is_known_root(root) -> bool`
- `is_spent(nullifier_hash) -> bool`
- `next_index() -> u32`
- `blacklist_root() -> BytesN<32>`

### 5.3 Verifier (`contracts/privacy_pool/src/verifier.rs`)

Wraps `rs-soroban-ultrahonk`. The mock feature returns `true` for any structurally valid input.
Real verifier decodes `vk` as the UltraHonk verification key bytes from `bb write_vk`,
`proof` as the bytes from `bb prove`, and `public_inputs` as a `Vec<[u8;32]>` big-endian field elements.

TODO(verifier): wire in `rs-soroban-ultrahonk::verify` once crate is confirmed to build for wasm32.

### 5.4 CLI (`cli/src/`)

**Note format (`*.note.json`):**
```json
{
  "nullifier": "0x...",
  "secret": "0x...",
  "commitment": "0x...",
  "depositTxHash": "...",
  "leafIndex": 0
}
```

**Commands:**
- `chameleon keygen` → generates nullifier, secret, commitment; writes `note.json`
- `chameleon deposit --note <file>` → submits deposit tx, fills in depositTxHash
- `chameleon sync` → fetches deposit events, rebuilds Merkle tree, saves state
- `chameleon prove --note <file> --to <address> [--relayer <addr>] [--fee <stroops>]` → builds Prover.toml, runs nargo/bb, outputs proof.json
- `chameleon withdraw --proof <file>` → submits withdrawal tx
- `chameleon demo` → runs full happy path + blacklisted-blocked path

### 5.5 Frontend (`frontend/src/`)

- `DepositCard` — generate note, deposit 100 XLM, display note save warning
- `WithdrawCard` — load note, input recipient, generate proof, withdraw
- `NoteManager` — save/load note.json with explicit warning about fund loss

---

## 6. Security Properties

1. **Double-spend prevention**: nullifier_hash stored on-chain after first withdrawal; duplicates rejected.
2. **Anti-front-running**: recipient, relayer, fee bound into ZK proof; any tampering invalidates proof.
3. **Root history**: last 30 roots accepted; prevents griefing by new deposits racing with proof generation.
4. **Blacklist freshness**: `blacklist_root` public input must match current on-chain value; stale proofs rejected.
5. **Admin key rotation**: `set_vk` allows verifier upgrade without redeployment.

---

## 7. Hackathon Simplifications

| Simplification | Production equivalent |
|---|---|
| O(k) blacklist check (16 entries) | Merkle non-membership proof (Semaphore-style) |
| Single fixed denomination (100 XLM) | Multi-denomination or arbitrary amounts |
| Mock verifier fallback | Full on-chain UltraHonk verification |
| Single admin key | Multi-sig / governance |
| Testnet only | Mainnet deployment with audits |
