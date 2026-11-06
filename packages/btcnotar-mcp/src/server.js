import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    BTCNotarClient,
    MempoolProvider,
    sha256Hex,
    sha256File,
    verifyProofFile,
    DEFAULT_SERVER_URL,
} from "btcnotar/client";

export const VERSION = "0.1.0";

const HEX64 = /^[0-9a-fA-F]{64}$/;

/** Client from env: BTCNOTAR_SERVER, BTCNOTAR_NETWORK, BTCNOTAR_MEMPOOL_API. */
export function clientFromEnv(env = process.env) {
    const network = env.BTCNOTAR_NETWORK || "mainnet";
    const provider = env.BTCNOTAR_MEMPOOL_API ? new MempoolProvider({ network, apiBase: env.BTCNOTAR_MEMPOOL_API }) : undefined;
    return new BTCNotarClient({ serverUrl: env.BTCNOTAR_SERVER || DEFAULT_SERVER_URL, network, provider });
}

/** Chain API for verify_proof_file. Default: none = mempool.space for the network in the proof file. */
export function proofProviderFromEnv(env = process.env) {
    if (!env.BTCNOTAR_MEMPOOL_API) return undefined;
    return new MempoolProvider({ network: env.BTCNOTAR_NETWORK || "mainnet", apiBase: env.BTCNOTAR_MEMPOOL_API });
}

// One document: a text, a SHA-256 hash, or a file path.
const target = {
    text: z.string().optional().describe("Text to notarize (hashed with SHA-256 as UTF-8). The text itself is never sent."),
    hash: z.string().optional().describe("SHA-256 hash, 64 hex characters."),
    file: z.string().optional().describe("Path to a file. Hashed locally; the file is never uploaded. Use an absolute path."),
};

function abs(p) {
    return path.resolve(p);
}

async function hashOf({ text, hash, file }) {
    const given = [text !== undefined, hash !== undefined, file !== undefined].filter(Boolean).length;
    if (given !== 1) throw new Error("give exactly one of: text, hash, file");
    if (hash !== undefined) {
        if (!HEX64.test(hash.trim())) throw new Error("hash must be 64 hex characters (SHA-256)");
        return hash.trim().toLowerCase();
    }
    if (file !== undefined) return sha256File(abs(file));
    return sha256Hex(text);
}

function ok(summary, data) {
    return {
        content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    };
}

function fail(err) {
    return { isError: true, content: [{ type: "text", text: `Error: ${err?.message || err}` }] };
}

const txUrl = (network, txid) => (network === "mainnet" ? `https://mempool.space/tx/${txid}` : `https://mempool.space/${network}/tx/${txid}`);

function explain(r, network) {
    if (r.valid && r.confirmed) return `On the Bitcoin blockchain since block ${r.blockHeight} (${r.date}). The document existed before this time. ${txUrl(network, r.txid)}`;
    if (r.valid) return `Transaction sent, waiting for a block (about 10 minutes). ${txUrl(network, r.txid)}`;
    const reasons = {
        pending: `In the queue. It will be written to Bitcoin at ${r.nextSettleAt ?? "the next settlement"} (about every hour). Check again after that.`,
        "unknown-hash": "Not notarized yet. Use the notarize tool first.",
        "no-proof-found": "No proof found.",
        "merkle-proof-mismatch": "INVALID: the proof does not match this hash.",
        "transaction-not-found": "INVALID: the transaction is not on the blockchain.",
        "on-chain-data-mismatch": "INVALID: the transaction does not contain this proof.",
        "document-hash-mismatch": "INVALID: the document was changed, or it is another file.",
    };
    return reasons[r.reason] || `Not valid: ${r.reason}`;
}

/**
 * Build the MCP server. `client` can be injected for tests.
 */
export function createServer({ client = clientFromEnv(), proofProvider = proofProviderFromEnv() } = {}) {
    const server = new McpServer(
        { name: "btcnotar", version: VERSION },
        {
            instructions:
                "btcnotar proves that a text or file existed at a certain time, using the Bitcoin blockchain. " +
                "Free, no key needed. Only the SHA-256 hash leaves this computer. " +
                "Flow: notarize -> wait about 1 hour -> check -> save_proof (keep the .btcnotar.json file next to the document). " +
                "verify_proof_file checks a saved proof against the blockchain without any btcnotar server.",
        }
    );

    server.registerTool(
        "hash",
        {
            title: "SHA-256 hash",
            description: "Compute the SHA-256 hash of a text or a file. Nothing is sent anywhere.",
            inputSchema: { text: target.text, file: target.file },
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async (args) => {
            try {
                const h = await hashOf(args);
                return ok(`SHA-256: ${h}`, { hash: h });
            } catch (e) {
                return fail(e);
            }
        }
    );

    server.registerTool(
        "notarize",
        {
            title: "Notarize on Bitcoin",
            description:
                "Notarize a text, a file or a SHA-256 hash on the Bitcoin blockchain for free. Only the hash is sent. " +
                "Returns status 'pending' and nextSettleAt (about 1 hour). Use 'check' after that time, then 'save_proof'.",
            inputSchema: target,
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
        },
        async (args) => {
            try {
                const h = await hashOf(args);
                const r = await client.submit(h);
                const summary =
                    r.status === "anchored"
                        ? `Already notarized (tx ${r.txid}). Use 'check' to verify.`
                        : `Queued. It will be written to Bitcoin at ${r.nextSettleAt ?? "the next settlement"}.`;
                return ok(summary, { ...r, hash: h, ...(args.file ? { file: abs(args.file) } : {}) });
            } catch (e) {
                return fail(e);
            }
        }
    );

    server.registerTool(
        "notarize_many",
        {
            title: "Notarize many on Bitcoin",
            description:
                "Notarize many texts, files or hashes in one call (all go into the same Bitcoin transaction). " +
                "Returns one result per item, in the same order.",
            inputSchema: {
                texts: z.array(z.string()).optional().describe("Texts to notarize."),
                hashes: z.array(z.string()).optional().describe("SHA-256 hashes (64 hex)."),
                files: z.array(z.string()).optional().describe("File paths (absolute). Hashed locally."),
            },
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
        },
        async ({ texts = [], hashes = [], files = [] }) => {
            try {
                const items = [
                    ...texts.map((t) => ({ text: t, hash: sha256Hex(t) })),
                    ...hashes.map((h) => ({ hash: h })),
                    ...(await Promise.all(files.map(async (f) => ({ file: abs(f), hash: await sha256File(abs(f)) })))),
                ];
                if (!items.length) throw new Error("give texts, hashes or files");
                if (items.length > 1000) throw new Error("max 1000 items per call");
                const res = await client.submitMany(items.map((i) => i.hash));
                const out = items.map((item, i) => ({ ...item, ...res[i] }));
                const bad = out.filter((o) => o.error).length;
                return ok(`Sent ${out.length - bad} of ${out.length}.${bad ? ` ${bad} failed (see "error").` : ""}`, out);
            } catch (e) {
                return fail(e);
            }
        }
    );

    server.registerTool(
        "check",
        {
            title: "Check on Bitcoin",
            description:
                "Check if a text, file or hash is on the Bitcoin blockchain. The proof is verified against the blockchain itself, " +
                "not trusted from the server. Returns block height and date when valid.",
            inputSchema: target,
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async (args) => {
            try {
                const h = await hashOf(args);
                const r = await client.verify(h);
                return ok(explain(r, client.network), { hash: h, ...r });
            } catch (e) {
                return fail(e);
            }
        }
    );

    server.registerTool(
        "save_proof",
        {
            title: "Save proof file",
            description:
                "Save the proof as a JSON file (.btcnotar.json). With this file the document can be verified later even without " +
                "any btcnotar server. Default location: next to the file (<file>.btcnotar.json), else <hash>.btcnotar.json. " +
                "Works only after the hash is in a Bitcoin transaction (use 'check' first).",
            inputSchema: {
                ...target,
                out: z.string().optional().describe("Where to save the proof file (absolute path)."),
            },
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
        },
        async ({ out, ...args }) => {
            try {
                const h = await hashOf(args);
                const target = abs(out || (args.file ? `${args.file}.btcnotar.json` : `${h}.btcnotar.json`));
                const pf = await client.saveProof(h, target);
                return ok(`Proof saved to ${target}. Keep it with the document.`, { path: target, proof: pf });
            } catch (e) {
                return fail(e);
            }
        }
    );

    server.registerTool(
        "verify_proof_file",
        {
            title: "Verify proof file",
            description:
                "Verify a saved .btcnotar.json proof file against the Bitcoin blockchain. No btcnotar server is used. " +
                "Give 'document' to also check that the proof belongs to that file (not changed).",
            inputSchema: {
                proof_file: z.string().describe("Path to the .btcnotar.json proof file."),
                document: z.string().optional().describe("Path to the original document (optional)."),
            },
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async ({ proof_file, document }) => {
            try {
                const r = await verifyProofFile(abs(proof_file), {
                    file: document ? abs(document) : undefined,
                    provider: proofProvider,
                });
                return ok(explain(r, client.network), r);
            } catch (e) {
                return fail(e);
            }
        }
    );

    return server;
}
