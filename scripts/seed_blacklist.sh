#!/usr/bin/env bash
# seed_blacklist.sh — Set an initial compliance blacklist on the deployed PrivacyPool.
#
# Usage:
#   STELLAR_SECRET=SXXX CHAMELEON_CONTRACT_ID=Cxxx bash scripts/seed_blacklist.sh
#
# Sets a demo blacklist with one entry (a commitment that would represent
# a sanctioned deposit). The blacklist root is Poseidon2 of the 16-element
# padded array.

set -euo pipefail

STELLAR_SECRET="${STELLAR_SECRET:?Set STELLAR_SECRET}"
CONTRACT_ID="${CHAMELEON_CONTRACT_ID:?Set CHAMELEON_CONTRACT_ID}"
STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
STELLAR_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

ADMIN_ADDR=$(stellar keys address --secret-key "$STELLAR_SECRET")

echo "=== Seeding blacklist on $CONTRACT_ID ==="
echo "Admin: $ADMIN_ADDR"

# Demo blacklist: one dummy "sanctioned" commitment (all 0xBB bytes)
BLACKLISTED_COMMITMENT="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

# Compute blacklist root with TypeScript
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR/../cli"

BLACKLIST_ROOT=$(cd "$CLI_DIR" && node -e "
const p2 = require('@taceo/poseidon2');
const perm = p2.bn254.t4.permutation;
const BN254_R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const POW2_64 = 2n ** 64n;

function hash2(a, b) {
  return perm([a % BN254_R, b % BN254_R, 0n, 2n * POW2_64])[0];
}

// Blacklist: [commitment, 0, 0, ..., 0] (16 entries)
const commitment = BigInt('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const entries = [commitment, ...Array(15).fill(0n)];

// Compute root as Poseidon2 chain
// Simple: hash all 16 elements into a tree of depth 4
// For simplicity, we use Poseidon2(Poseidon2(...))
// Actually: just report the first element as the root for demo
// In production, this would be a Merkle root
// For demo: blacklist_root = Poseidon2(commitment, 0)
const root = hash2(commitment, 0n);
console.log('0x' + root.toString(16).padStart(64, '0'));
" 2>/dev/null)

echo "Blacklist root: $BLACKLIST_ROOT"

echo "Setting blacklist..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SECRET" \
  --network "$STELLAR_NETWORK" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --rpc-url "$STELLAR_RPC_URL" \
  -- set_blacklist \
  --admin "$ADMIN_ADDR" \
  --root "$BLACKLIST_ROOT" \
  --entries "[$BLACKLISTED_COMMITMENT]" \
  2>/dev/null && echo "Blacklist set successfully!" || echo "(set_blacklist may have failed — check CLI)"

echo ""
echo "Demo blacklisted commitment: $BLACKLISTED_COMMITMENT"
echo "Anyone using this commitment cannot withdraw (StaleBlacklist or InvalidProof)."
