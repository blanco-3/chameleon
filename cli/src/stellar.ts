/**
 * stellar.ts — Stellar SDK helpers for Chameleon.
 *
 * Provides transaction building, contract invocation, and event fetching
 * for the PrivacyPool Soroban contract on Stellar testnet.
 *
 * All functions that interact with the network are async and throw typed
 * errors on failure.
 */

import {
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Address,
  nativeToScVal,
  scValToNative,
  Contract,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';

/** Stellar testnet RPC URL. */
export const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org';

/** Stellar testnet network passphrase. */
export const TESTNET_NETWORK = Networks.TESTNET;

/** Default transaction timeout (seconds). */
export const TX_TIMEOUT_SECS = 60;

/** Denomination in stroops (100 XLM). */
export const DENOMINATION_STROOPS = 1_000_000_000n;

/** ChameleonError — typed error for CLI operations. */
export class ChameleonError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ChameleonError';
  }
}

/**
 * Create a Soroban RPC server client for testnet.
 */
export function makeServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(TESTNET_RPC_URL, { allowHttp: false });
}

/**
 * Fund a new account on testnet via Friendbot.
 *
 * @param address Stellar public key (G...)
 */
export async function fundAccount(address: string): Promise<void> {
  const resp = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  if (!resp.ok) {
    throw new ChameleonError(
      `Friendbot funding failed for ${address}: ${resp.statusText}`,
      'FRIENDBOT_FAILED',
    );
  }
}

/**
 * Build, simulate, sign, and submit a Soroban contract invocation.
 *
 * @param server   SorobanRpc server
 * @param keypair  Signing keypair
 * @param contract Contract address (C...)
 * @param method   Contract method name
 * @param args     XDR ScVal arguments
 * @returns Transaction result XDR value
 * @throws ChameleonError on simulation or submission failure
 */
export async function invokeContract(
  server: SorobanRpc.Server,
  keypair: Keypair,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal> {
  const account = await server.getAccount(keypair.publicKey());

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_NETWORK,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT_SECS)
    .build();

  // Simulate to get the footprint + auth
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new ChameleonError(
      `Simulation failed for ${method}: ${simResult.error}`,
      'SIMULATION_FAILED',
      simResult,
    );
  }

  // Assemble and sign
  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  assembled.sign(keypair);

  // Submit
  const sendResult = await server.sendTransaction(assembled);
  if (sendResult.status === 'ERROR') {
    throw new ChameleonError(
      `Transaction submission failed for ${method}: ${JSON.stringify(sendResult)}`,
      'TX_FAILED',
      sendResult,
    );
  }

  // Poll for result
  let getResult = await server.getTransaction(sendResult.hash);
  let attempts = 0;
  while (
    getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < 30
  ) {
    await new Promise(r => setTimeout(r, 2000));
    getResult = await server.getTransaction(sendResult.hash);
    attempts++;
  }

  if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    const meta = getResult.resultMetaXdr;
    // Extract return value — Protocol 22+ uses TransactionMeta v4; fall back to v3.
    if (meta) {
      let sorobanMeta: { returnValue: () => xdr.ScVal | null } | null = null;
      try { sorobanMeta = meta.v4().sorobanMeta(); } catch { /* not v4 */ }
      if (!sorobanMeta) {
        try { sorobanMeta = meta.v3().sorobanMeta(); } catch { /* not v3 */ }
      }
      const returnVal = sorobanMeta?.returnValue();
      if (returnVal) return returnVal;
    }
    return xdr.ScVal.scvVoid();
  } else {
    throw new ChameleonError(
      `Transaction failed: ${getResult.status}`,
      'TX_FAILED',
      getResult,
    );
  }
}

/**
 * Fetch deposit events from the contract for Merkle tree reconstruction.
 *
 * Returns an array of { commitment, leafIndex } tuples in insertion order.
 *
 * @param contractId Contract address
 * @param startLedger Ledger to start scanning from (use 0 for all history)
 */
export async function fetchDepositEvents(
  contractId: string,
  startLedger = 0,
): Promise<Array<{ commitment: string; leafIndex: number; txHash: string }>> {
  const server = makeServer();
  const events = await server.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [contractId],
        // Note: topic filter is applied client-side due to testnet RPC quirks
      },
    ],
  });

  const DEPOSIT_SYMBOL_B64 = nativeToScVal('deposit', { type: 'symbol' }).toXDR().toString('base64');

  const deposits: Array<{ commitment: string; leafIndex: number; txHash: string }> = [];
  for (const event of events.events) {
    try {
      // Filter: topic[0] must be Symbol("deposit")
      if (!event.topic[0] || event.topic[0].toXDR('base64') !== DEPOSIT_SYMBOL_B64) continue;
      // topics[0] = "deposit", topics[1] = leaf_index (u32)
      const leafIndexVal = event.topic[1];
      const dataVal = event.value;
      if (!leafIndexVal || !dataVal) continue;
      const leafIndex = Number(scValToNative(leafIndexVal));
      // commitment is a BytesN<32> stored as event data
      const rawData = scValToNative(dataVal) as Uint8Array;
      const commitment = '0x' + Buffer.from(rawData).toString('hex');
      deposits.push({ commitment, leafIndex, txHash: event.txHash });
    } catch {
      // Skip malformed events
    }
  }

  // Sort by leaf index to ensure correct order
  deposits.sort((a, b) => a.leafIndex - b.leafIndex);
  return deposits;
}

/**
 * Convert a 32-byte hex commitment to a Soroban BytesN<32> ScVal.
 */
export function commitmentToScVal(commitment: string): xdr.ScVal {
  const bytes = Buffer.from(commitment.startsWith('0x') ? commitment.slice(2) : commitment, 'hex');
  if (bytes.length !== 32) throw new ChameleonError('Commitment must be 32 bytes', 'INVALID_INPUT');
  return xdr.ScVal.scvBytes(bytes);
}

/**
 * Convert a Stellar address (G...) to a 32-byte field element for use as a
 * public input in the ZK circuit.
 *
 * The Stellar address is the 32-byte raw public key, interpreted as a big-endian
 * field element reduced mod BN254_R.
 *
 * @param address Stellar public key (G...)
 * @returns 32-byte hex field element
 */
export function addressToField(address: string): string {
  const kp = Keypair.fromPublicKey(address);
  const rawKey = kp.rawPublicKey();
  const bigint = BigInt('0x' + Buffer.from(rawKey).toString('hex'));
  const BN254_R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
  const reduced = bigint % BN254_R;
  return '0x' + reduced.toString(16).padStart(64, '0');
}

/**
 * Read-only contract call via simulation (no transaction submission).
 * Safe for view functions that don't mutate state.
 */
export async function readContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<xdr.ScVal> {
  const server = makeServer();
  // Use a well-known testnet account as source (read-only, doesn't submit)
  const DUMMY_SOURCE = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
  let account;
  try {
    account = await server.getAccount(DUMMY_SOURCE);
  } catch {
    // If the dummy account doesn't exist, create a minimal account object
    account = { accountId: () => DUMMY_SOURCE, sequenceNumber: () => '0', incrementSequenceNumber: () => {}, sequence: '0' } as any;
  }
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_NETWORK,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT_SECS)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new ChameleonError(`Read failed for ${method}: ${sim.error}`, 'READ_FAILED', sim);
  }
  const result = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result;
  return result?.retval ?? xdr.ScVal.scvVoid();
}
