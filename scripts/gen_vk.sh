#!/usr/bin/env bash
# gen_vk.sh — Generate UltraHonk proof + verification key for the Chameleon circuit.
#
# Steps:
#   1. Compile circuit (nargo compile)
#   2. Solve witness (nargo execute)
#   3. Write VK (bb write_vk)
#   4. Generate proof (bb prove)
#   5. Verify proof locally (bb verify)
#
# Artifacts written to circuits/privacy_pool/target/:
#   privacy_pool.json  — ACIR
#   privacy_pool.gz    — witness
#   vk                 — verification key (3680 bytes)
#   proof              — UltraHonk proof (14656 bytes)
#   public_inputs      — 6 × 32-byte field elements

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUIT_DIR="$SCRIPT_DIR/../circuits/privacy_pool"

# Tool paths (prefer $PATH, fallback to default install locations)
NARGO="${NARGO:-${HOME}/.nargo/bin/nargo}"
BB="${BB:-${HOME}/.bb/bb}"

export PATH="${HOME}/.nargo/bin:${HOME}/.bb:${PATH}"

echo "=== Chameleon: Generating circuit artifacts ==="
echo "Circuit: $CIRCUIT_DIR"
echo "nargo: $($NARGO --version 2>&1 | head -1)"
echo "bb:    $($BB --version)"

cd "$CIRCUIT_DIR"

echo ""
echo "[1/5] Compiling circuit..."
$NARGO compile

echo "[2/5] Solving witness (using Prover.toml)..."
$NARGO execute

echo "[3/5] Writing verification key..."
$BB write_vk -b target/privacy_pool.json -o target/

echo "[4/5] Generating proof..."
$BB prove -b target/privacy_pool.json -w target/privacy_pool.gz -o target/

echo "[5/5] Verifying proof locally..."
$BB verify -k target/vk -p target/proof -i target/public_inputs

VK_SIZE=$(wc -c < target/vk | tr -d ' ')
PROOF_SIZE=$(wc -c < target/proof | tr -d ' ')

echo ""
echo "=== Circuit artifact generation COMPLETE ==="
echo "  VK size:    ${VK_SIZE} bytes"
echo "  Proof size: ${PROOF_SIZE} bytes"
echo "  Artifacts:  $CIRCUIT_DIR/target/"
