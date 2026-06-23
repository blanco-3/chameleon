/**
 * merkle.ts — Off-chain incremental Merkle tree for Chameleon.
 *
 * Reconstructs the on-chain Merkle tree from deposit events, computes
 * authentication paths for withdrawal proofs, and mirrors the on-chain
 * `merkle.rs` insert logic.
 *
 * Hash function: Poseidon2([left, right]) via poseidon.ts — MUST match the
 * Soroban contract and Noir circuit (verified by `make test-crypto`).
 *
 * Tree parameters:
 *   TREE_DEPTH = 20, ROOT_HISTORY_SIZE = 30
 *   Zero leaf: Field(0) (empty slot sentinel)
 *   zeros[i+1] = Poseidon2([zeros[i], zeros[i]])
 */

import { hash2, hexToField, fieldToHex } from './poseidon';

export const TREE_DEPTH = 20;
export const ROOT_HISTORY_SIZE = 30;

/**
 * Precomputed zero values at each level.
 * zeros[0] = 0 (empty leaf)
 * zeros[i+1] = Poseidon2([zeros[i], zeros[i]])
 */
export function computeZeros(): bigint[] {
  const zeros: bigint[] = [0n];
  for (let i = 0; i < TREE_DEPTH; i++) {
    zeros.push(hash2(zeros[i], zeros[i]));
  }
  return zeros;
}

/** Cached zero values (computed once). */
export const ZEROS = computeZeros();

/** Merkle path proof for a single leaf. */
export interface MerkleProof {
  /** Leaf index in the tree (= deposit index). */
  leafIndex: number;
  /** Sibling hashes along the path from leaf to root (depth=20 elements). */
  pathElements: bigint[];
  /** Direction bits: 0 = leaf/node is left child, 1 = right child. */
  pathIndices: number[];
  /** Recomputed root (should match on-chain root at deposit time). */
  root: bigint;
}

/**
 * In-memory incremental Merkle tree that mirrors the Soroban contract's state.
 *
 * Rebuilt from deposit events by inserting commitments in order.
 */
export class MerkleTree {
  private leaves: bigint[] = [];
  private filledSubtrees: bigint[];
  private roots: bigint[] = [];
  private nextIndex = 0;

  constructor(readonly depth = TREE_DEPTH) {
    this.filledSubtrees = ZEROS.slice(0, depth);
  }

  /**
   * Insert a leaf (commitment) into the tree, updating filled subtrees and root.
   *
   * Mirrors `merkle.rs::insert()`.
   *
   * @param leaf 32-byte commitment as a BigInt field element
   * @returns The new Merkle root after insertion
   */
  insert(leaf: bigint): bigint {
    this.leaves.push(leaf);
    const idx = this.nextIndex++;
    let current = leaf;
    let filledIdx = idx;

    for (let i = 0; i < this.depth; i++) {
      let left: bigint, right: bigint;
      if (filledIdx % 2 === 0) {
        // Left child: store as new filled subtree, pair with zero
        left = current;
        right = ZEROS[i];
        this.filledSubtrees[i] = current;
      } else {
        // Right child: pair with stored left subtree
        left = this.filledSubtrees[i];
        right = current;
      }
      current = hash2(left, right);
      filledIdx = Math.floor(filledIdx / 2);
    }

    this.roots.push(current);
    return current;
  }

  /**
   * Compute the Merkle authentication path for the leaf at `leafIndex`.
   *
   * Rebuilds the full tree from all stored leaves to compute accurate siblings.
   *
   * @param leafIndex The position of the target leaf
   * @returns MerkleProof with pathElements, pathIndices, and root
   * @throws If leafIndex is out of range
   */
  generateProof(leafIndex: number): MerkleProof {
    if (leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range (tree has ${this.leaves.length} leaves)`);
    }

    // Build full tree level by level
    const treeSize = Math.pow(2, this.depth);
    // Level 0 = leaves
    const levels: bigint[][] = [];
    const leafLevel = [...this.leaves];
    // Pad with zeros
    while (leafLevel.length < treeSize) leafLevel.push(ZEROS[0]);
    levels.push(leafLevel);

    // Build upward
    for (let i = 0; i < this.depth; i++) {
      const prev = levels[i];
      const next: bigint[] = [];
      for (let j = 0; j < prev.length; j += 2) {
        next.push(hash2(prev[j], prev[j + 1] ?? ZEROS[i]));
      }
      levels.push(next);
    }

    // Root is levels[depth][0]
    const root = levels[this.depth][0];

    // Collect path elements and indices
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = leafIndex;

    for (let i = 0; i < this.depth; i++) {
      const isRight = idx % 2;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      pathElements.push(levels[i][siblingIdx] ?? ZEROS[i]);
      pathIndices.push(isRight);
      idx = Math.floor(idx / 2);
    }

    return { leafIndex, pathElements, pathIndices, root };
  }

  /** Return the current root. */
  getRoot(): bigint {
    return this.roots[this.roots.length - 1] ?? ZEROS[this.depth];
  }

  /** Return all roots (for root history ring buffer check). */
  getRootHistory(): bigint[] {
    return this.roots.slice(-ROOT_HISTORY_SIZE);
  }

  /** Return true if root is in the last ROOT_HISTORY_SIZE roots. */
  isKnownRoot(root: bigint): boolean {
    return this.getRootHistory().some(r => r === root);
  }

  /** Return the number of leaves inserted. */
  get size(): number {
    return this.leaves.length;
  }

  /**
   * Find the leaf index for a given commitment, or -1 if not found.
   */
  findLeafIndex(commitment: bigint): number {
    return this.leaves.indexOf(commitment);
  }

  /**
   * Serialize tree state for caching to disk.
   */
  serialize(): TreeState {
    return {
      leaves: this.leaves.map(l => fieldToHex(l)),
      filledSubtrees: this.filledSubtrees.map(f => fieldToHex(f)),
      roots: this.roots.map(r => fieldToHex(r)),
      nextIndex: this.nextIndex,
      depth: this.depth,
    };
  }

  /**
   * Restore tree state from a serialized snapshot.
   */
  static deserialize(state: TreeState): MerkleTree {
    const tree = new MerkleTree(state.depth);
    tree.leaves = state.leaves.map(hexToField);
    tree.filledSubtrees = state.filledSubtrees.map(hexToField);
    tree.roots = state.roots.map(hexToField);
    tree.nextIndex = state.nextIndex;
    return tree;
  }
}

/** Serializable tree state for caching. */
export interface TreeState {
  leaves: string[];       // hex-encoded field elements
  filledSubtrees: string[];
  roots: string[];
  nextIndex: number;
  depth: number;
}

/**
 * Verify a Merkle proof (matches circuit logic in merkle.nr).
 *
 * @param leaf The leaf value
 * @param pathElements Sibling hashes
 * @param pathIndices Direction bits (0=left, 1=right)
 * @param expectedRoot Expected root
 * @returns true if computed root matches expectedRoot
 */
export function verifyMerkleProof(
  leaf: bigint,
  pathElements: bigint[],
  pathIndices: number[],
  expectedRoot: bigint,
): boolean {
  let current = leaf;
  for (let i = 0; i < pathElements.length; i++) {
    const sibling = pathElements[i];
    const isRight = pathIndices[i];
    const left = isRight ? sibling : current;
    const right = isRight ? current : sibling;
    current = hash2(left, right);
  }
  return current === expectedRoot;
}
