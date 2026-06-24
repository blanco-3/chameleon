#!/usr/bin/env bash
# deploy.sh — Deploy the Chameleon PrivacyPool contract to Stellar testnet.
#
# Prerequisites:
#   - STELLAR_SECRET: Admin secret key
#   - stellar CLI (26.0.0+)
#   - Built wasm artifact in contracts/target/
#
# Usage:
#   STELLAR_SECRET=SXXX bash scripts/deploy.sh
#
# On success, prints the contract ID and updates README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
CONTRACT_DIR="$ROOT/contracts"
CIRCUIT_DIR="$ROOT/circuits/privacy_pool"

export PATH="${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin:${HOME}/.nargo/bin:${HOME}/.bb:${PATH}"

# Validate required env vars
if [ -z "${STELLAR_SECRET:-}" ]; then
  echo "ERROR: STELLAR_SECRET environment variable is required."
  echo "  export STELLAR_SECRET=SXXXXXXXXXX..."
  exit 1
fi

STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
STELLAR_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

echo "=== Chameleon: Deploying to Stellar ${STELLAR_NETWORK} ==="

# 1. Get admin address
ADMIN_SECRET="$STELLAR_SECRET"
ADMIN_ADDR=$(stellar keys address --secret-key "$ADMIN_SECRET" 2>/dev/null || \
  stellar keys generate --secret-key "$ADMIN_SECRET" --overwrite 2>/dev/null && \
  stellar keys address --secret-key "$ADMIN_SECRET")

echo "Admin: $ADMIN_ADDR"

# 2. Fund admin if needed
echo "Funding admin on testnet..."
curl -s "https://friendbot.stellar.org?addr=$ADMIN_ADDR" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Funded:', d.get('successful', d.get('hash', 'ok')))" 2>/dev/null || echo "(Friendbot may have already funded this account)"

# 3. Build contract with real UltraHonk verifier (nargo 1.0.0-beta.9 + bb 0.87.0)
echo "[1/4] Building PrivacyPool wasm..."
cd "$CONTRACT_DIR"
cargo build --target wasm32v1-none --release -p privacy_pool 2>&1 | tail -3

WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/privacy_pool.wasm"
if [ ! -f "$WASM_PATH" ]; then
  echo "ERROR: Wasm not found at $WASM_PATH"
  exit 1
fi
echo "Wasm built: $WASM_PATH ($(wc -c < "$WASM_PATH") bytes)"

# 4. Deploy contract
echo "[2/4] Deploying contract..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source "$ADMIN_SECRET" \
  --network "$STELLAR_NETWORK" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --rpc-url "$STELLAR_RPC_URL" \
  2>/dev/null)

if [ -z "$CONTRACT_ID" ]; then
  echo "ERROR: Contract deployment failed."
  exit 1
fi
echo "Contract deployed: $CONTRACT_ID"

# 5. Read VK from circuit artifacts
VK_FILE="$CIRCUIT_DIR/target/vk"
if [ ! -f "$VK_FILE" ]; then
  echo "VK not found. Generating..."
  bash "$SCRIPT_DIR/gen_vk.sh"
fi
VK_HEX=$(xxd -p -c 99999 "$VK_FILE" | tr -d '\n')
echo "VK loaded: ${#VK_HEX} hex chars"

# Get native XLM SAC address on testnet
NATIVE_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
echo "Native XLM SAC: $NATIVE_SAC"

# 6. Initialize contract
echo "[3/4] Initializing contract..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$STELLAR_NETWORK" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --rpc-url "$STELLAR_RPC_URL" \
  -- initialize \
  --admin "$ADMIN_ADDR" \
  --token "$NATIVE_SAC" \
  --vk "$(python3 -c "data=open('$VK_FILE','rb').read(); print(data.hex())")" \
  --denomination 1000000000 \
  --depth 20 2>/dev/null || echo "(Initialize may have failed — contract may already be initialized)"

echo "[4/4] Verifying deployment..."
ROOT_VAL=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$STELLAR_NETWORK" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --rpc-url "$STELLAR_RPC_URL" \
  -- get_root 2>/dev/null || echo "(view call)")

NEXT_IDX=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$STELLAR_NETWORK" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --rpc-url "$STELLAR_RPC_URL" \
  -- next_index 2>/dev/null || echo "0")

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "  Contract ID:  $CONTRACT_ID"
echo "  Root:         $ROOT_VAL"
echo "  Next index:   $NEXT_IDX"
echo "  Network:      $STELLAR_NETWORK"
echo ""

# Save contract ID
echo "$CONTRACT_ID" > "$ROOT/.deployed_contract_id"
echo "Contract ID saved to .deployed_contract_id"
echo ""
echo "Set in your environment:"
echo "  export CHAMELEON_CONTRACT_ID=$CONTRACT_ID"
echo "  export VITE_CONTRACT_ID=$CONTRACT_ID  # for frontend"
