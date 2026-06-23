# Chameleon — Makefile
# All targets assume tools are in PATH: nargo, bb, stellar, node, cargo

NARGO   ?= $(HOME)/.nargo/bin/nargo
BB      ?= $(HOME)/.bb/bb
STELLAR ?= stellar
NODE    ?= node
CARGO   ?= $(HOME)/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo

CIRCUIT_DIR := circuits/privacy_pool
CONTRACT_DIR := contracts
CLI_DIR     := cli

.PHONY: help build-circuit gen-vk build-contracts test-contracts test-circuit test-crypto deploy demo clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

build-circuit: ## Compile the Noir circuit
	cd $(CIRCUIT_DIR) && $(NARGO) compile

gen-vk: build-circuit ## Generate proof + verification key (requires sample witness)
	bash scripts/gen_vk.sh

build-contracts: ## Build Soroban contracts for wasm32v1-none
	cd $(CONTRACT_DIR) && $(CARGO) build --target wasm32v1-none --release -p privacy_pool --features mock

build-contracts-mock: ## Build contracts with mock verifier (for testing)
	cd $(CONTRACT_DIR) && $(CARGO) build --target wasm32v1-none --release -p privacy_pool --features mock

test-contracts: ## Run Soroban unit tests (uses mock verifier)
	cd $(CONTRACT_DIR) && $(CARGO) test -p privacy_pool --features mock -- --test-threads=1

test-circuit: ## Run nargo tests
	cd $(CIRCUIT_DIR) && $(NARGO) test

test-crypto: ## Cross-implementation Poseidon2 consistency test
	cd $(CLI_DIR) && npx ts-node src/test_crypto.ts

deploy: ## Deploy to Stellar testnet (requires STELLAR_SECRET env var)
	bash scripts/deploy.sh

demo: ## Run the full demo (happy path + blacklisted path)
	bash scripts/demo.sh

clean: ## Remove build artifacts
	cd $(CIRCUIT_DIR) && rm -rf target/
	cd $(CONTRACT_DIR) && $(CARGO) clean
	cd $(CLI_DIR) && rm -rf dist/ node_modules/
