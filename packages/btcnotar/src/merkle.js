import crypto from "node:crypto";

// Domain-separation prefixes so a leaf hash can never be replayed as an
// internal node (and vice versa) when reconstructing a root from a proof.
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function sha256(buf) {
    return crypto.createHash("sha256").update(buf).digest();
}

function toBuffer(hashHex) {
    if (typeof hashHex !== "string" || !/^[0-9a-fA-F]+$/.test(hashHex) || hashHex.length % 2 !== 0) {
        throw new Error(`Invalid hash: expected a hex string, got "${hashHex}"`);
    }
    return Buffer.from(hashHex, "hex");
}

function hashLeaf(hashHex) {
    return sha256(Buffer.concat([LEAF_PREFIX, toBuffer(hashHex)]));
}

function hashNode(left, right) {
    return sha256(Buffer.concat([NODE_PREFIX, left, right]));
}

/**
 * A Merkle tree over a list of document hashes.
 *
 * - Leaves are domain-separated (0x00 prefix) so they can't collide with
 *   internal nodes (0x01 prefix) — this prevents the classic
 *   leaf/node-confusion forgery against naive Merkle proofs.
 * - An unpaired node at the end of a level is carried up unchanged
 *   (no duplication), which avoids the CVE-2012-2459-style duplicate-leaf
 *   ambiguity that affects Bitcoin's own block Merkle tree.
 */
export class MerkleTree {
    /** @param {string[]} hashesHex - document hashes (hex-encoded) to anchor */
    constructor(hashesHex) {
        if (!Array.isArray(hashesHex) || hashesHex.length === 0) {
            throw new Error("MerkleTree requires a non-empty array of hex hashes");
        }
        this.leaves = hashesHex.map((h) => h.toLowerCase());
        this.layers = MerkleTree.buildLayers(this.leaves.map(hashLeaf));
    }

    static buildLayers(leafBuffers) {
        const layers = [leafBuffers];
        let current = leafBuffers;
        while (current.length > 1) {
            const next = [];
            for (let i = 0; i < current.length; i += 2) {
                if (i + 1 < current.length) {
                    next.push(hashNode(current[i], current[i + 1]));
                } else {
                    next.push(current[i]); // odd one out, carried up untouched
                }
            }
            layers.push(next);
            current = next;
        }
        return layers;
    }

    /** Merkle root, hex-encoded. */
    get root() {
        const top = this.layers[this.layers.length - 1];
        return top[0].toString("hex");
    }

    /**
     * Inclusion proof for the leaf at `index`: an ordered list of sibling
     * steps needed to recompute the root from that leaf's hash.
     * @returns {{position: "left"|"right", hash: string}[]}
     */
    getProof(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length) {
            throw new Error(`index out of range: ${index}`);
        }
        const proof = [];
        let idx = index;
        for (let level = 0; level < this.layers.length - 1; level++) {
            const layer = this.layers[level];
            const isRightNode = idx % 2 === 1;
            const siblingIdx = isRightNode ? idx - 1 : idx + 1;
            if (siblingIdx < layer.length) {
                proof.push({
                    position: isRightNode ? "left" : "right",
                    hash: layer[siblingIdx].toString("hex"),
                });
            }
            idx = Math.floor(idx / 2);
        }
        return proof;
    }

    /** Proof for the first leaf equal to `hashHex`. Throws if not found. */
    getProofForHash(hashHex) {
        const index = this.leaves.indexOf(hashHex.toLowerCase());
        if (index === -1) throw new Error(`hash not found in this tree: ${hashHex}`);
        return this.getProof(index);
    }

    /**
     * Recompute a root from a leaf hash + proof and compare it to `rootHex`.
     * This is the reversibility primitive: anyone holding only the original
     * document hash and its proof can independently verify inclusion,
     * without needing the full batch.
     */
    static verifyProof(hashHex, proof, rootHex) {
        try {
            let node = hashLeaf(hashHex);
            for (const step of proof) {
                const sibling = toBuffer(step.hash);
                node = step.position === "left" ? hashNode(sibling, node) : hashNode(node, sibling);
            }
            return node.toString("hex") === rootHex.toLowerCase();
        } catch {
            return false;
        }
    }
}
