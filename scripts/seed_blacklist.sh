#!/usr/bin/env bash
# seed_blacklist.sh — Set a demo compliance blacklist on the deployed PrivacyPool.
#
# Usage:
#   STELLAR_SECRET=SXXX CHAMELEON_CONTRACT_ID=Cxxx bash scripts/seed_blacklist.sh
#
# Blacklists one demo commitment (0xbbbb...) so it cannot be withdrawn.

set -euo pipefail

export PATH="${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin:${HOME}/.nargo/bin:${HOME}/.bb:${PATH}"

STELLAR_SECRET="${STELLAR_SECRET:?Set STELLAR_SECRET}"
CONTRACT_ID="${CHAMELEON_CONTRACT_ID:?Set CHAMELEON_CONTRACT_ID}"
STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
STELLAR_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

ADMIN_ADDR=$(stellar keys address chameleon-admin 2>/dev/null || stellar keys address --secret-key "$STELLAR_SECRET")

echo "=== Seeding blacklist on $CONTRACT_ID ==="
echo "Admin: $ADMIN_ADDR"

# Demo blacklisted commitment (all 0xBB bytes — clearly fake/demo)
BLACKLISTED="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

# Compute blacklist_root via CLI node helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR/../cli"

BLACKLIST_ROOT=$(cd "$CLI_DIR" && node -e "
const p2 = require('@taceo/poseidon2');
const perm = p2.bn254.t4.permutation;
const BN254_R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const POW2_64 = 2n ** 64n;
function hash2(a, b) { return perm([a % BN254_R, b % BN254_R, 0n, 2n * POW2_64])[0]; }
const c = BigInt('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const root = hash2(c, 0n);
console.log(root.toString(16).padStart(64, '0'));
" 2>/dev/null)

echo "Blacklist root (hex): $BLACKLIST_ROOT"

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SECRET" \
  --network "$STELLAR_NETWORK" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --rpc-url "$STELLAR_RPC_URL" \
  -- set_blacklist \
  --admin "$ADMIN_ADDR" \
  --root "$BLACKLIST_ROOT" \
  --entries "[ \"$BLACKLISTED\" ]" \
  2>&1

echo ""
echo "Blacklist set. Demo blacklisted commitment: 0x${BLACKLISTED}"
echo "Any proof using blacklist_root=0 will now fail with StaleBlacklist."
echo "Any prover whose commitment is 0x${BLACKLISTED} cannot generate a valid proof."
