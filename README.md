# Chameleon — Compliance-Aware Privacy Pool on Stellar

Chameleon is a Tornado-Cash-style privacy mixer for Stellar with built-in compliance. Users deposit
100 XLM and receive a secret note. To withdraw, they generate a zero-knowledge proof (UltraHonk/Noir)
proving their deposit is in the Merkle tree AND is not in a compliance blacklist — all without
revealing which deposit is theirs.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chameleon Flow                           │
│                                                                 │
│  User                  CLI / Frontend          Soroban Contract │
│   │                         │                        │          │
│   │── keygen ──────────────►│                        │          │
│   │   (nullifier, secret,   │                        │          │
│   │    commitment)          │                        │          │
│   │                         │                        │          │
│   │── deposit ─────────────►│── deposit(commitment)─►│          │
│   │   (100 XLM)             │                        │ insert   │
│   │                         │                        │ leaf     │
│   │                         │                        │ emit evt │
│   │                         │                        │          │
│   │── sync ────────────────►│ rebuild Merkle tree    │          │
│   │                         │ from events            │          │
│   │                         │                        │          │
│   │── prove ───────────────►│ nargo+bb proof gen     │          │
│   │   (to: recipient)       │ ZK: membership +       │          │
│   │                         │     non-blacklisted    │          │
│   │                         │                        │          │
│   │── withdraw ────────────►│── withdraw(proof) ────►│          │
│   │                         │                        │ verify   │
│   │                         │                        │ pay out  │
│   │◄─ 100 XLM ─────────────────────────────────────  │          │
└─────────────────────────────────────────────────────────────────┘
```

## Environment

| Tool | Version |
|------|---------|
| nargo (Noir) | 1.0.0-beta.22 |
| bb (Barretenberg) | 5.0.0-nightly.20260522 |
| rustc | 1.90.0 |
| cargo | 1.90.0 |
| stellar CLI | 26.0.0 |
| node | v25.6.0 |
| Rust wasm32 target | installed |

## Installation

```bash
# Install Noir
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup   # installs nargo

# Install Barretenberg
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
bbup     # auto-detects nargo version

# Install Stellar CLI
# https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli

# Install Rust wasm32 target
rustup target add wasm32-unknown-unknown

# Clone and build
git clone <repo>
cd chameleon
make build-circuit
make build-contracts
cd cli && npm install
cd frontend && npm install
```

## Quickstart

```bash
# 1. Generate a note
chameleon keygen

# 2. Deposit 100 XLM
chameleon deposit --note my.note.json

# 3. Sync tree from chain
chameleon sync

# 4. Generate withdrawal proof
chameleon prove --note my.note.json --to GDEST...

# 5. Withdraw
chameleon withdraw --proof proof.json
```

## Deployed Addresses (Testnet)

| Contract | Address |
|----------|---------|
| PrivacyPool | `CCIYD4T3FEFYASQ6F2MMUPLA6HB65U3XHEVENXFXZCJMANVPZWHYTOLX` |
| Admin | `GBOEXHMCP3J4R4FSGYBLGHWGCTQ4D2TNXI2R3N6R7J6GT4GQD2WBGS2I` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Explorer: https://stellar.expert/explorer/testnet/contract/CCIYD4T3FEFYASQ6F2MMUPLA6HB65U3XHEVENXFXZCJMANVPZWHYTOLX

## Architecture

See `DESIGN.md` for full specification.

- **Circuit:** `circuits/privacy_pool/` — Noir UltraHonk circuit
- **Contract:** `contracts/privacy_pool/` — Soroban Rust contract
- **CLI:** `cli/` — TypeScript Node CLI
- **Frontend:** `frontend/` — React+Vite UI

## Security Notes

1. **Never lose your note** — it contains your nullifier and secret. Losing it means losing 100 XLM.
2. Double-spend prevention: nullifier stored on-chain after withdrawal.
3. Anti-front-running: recipient/relayer/fee are bound into the ZK proof.
4. Blacklist freshness: stale proofs (wrong blacklist root) are rejected.
5. Root history: last 30 roots accepted to allow concurrent deposits.

## Hackathon Simplifications

| Simplification | Production equivalent |
|---|---|
| O(k) blacklist (16 slots) | Merkle non-membership proof |
| Single denomination (100 XLM) | Multi-denomination pools |
| Mock verifier fallback | Full on-chain UltraHonk verification |
| Single admin key | Multi-sig / DAO governance |
| Testnet only | Mainnet + audits |

> **TODO(verifier):** `rs-soroban-ultrahonk` integration — see `contracts/privacy_pool/src/verifier.rs`.
> Mock feature flag is active; swap in real verifier once wasm32 build is confirmed.

## Current Status

- [x] Phase 0 — Scaffold
- [x] Phase 1 — Verifier spike + version pinning
- [x] Phase 2 — Poseidon consistency + Merkle tree
- [x] Phase 3 — Noir circuit (`nargo test` 4/4 pass; `bb verify` succeeds)
- [x] Phase 4 — Soroban contract (10/10 tests pass, wasm build OK)
- [x] Phase 5 — Deployed to Stellar Testnet
- [x] Phase 6 — CLI / SDK
- [x] Phase 7 — Frontend (React + Vite)
- [x] Phase 8 — Demo scripts, CI, docs
