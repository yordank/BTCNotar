#!/usr/bin/env node
import fs from "node:fs";
import { BTCNotar, BTCNotarClient, sha256Hex, verifyProofFile } from "../index.js";
import { FileStore } from "../src/store.js";

// Load ./.env if it exists (Node 20.12+). No dotenv dependency needed.
try {
    process.loadEnvFile?.();
} catch {
    /* no .env file */
}

function usage() {
    console.log(`btcnotar - batch Bitcoin notarization CLI

Free public server (no key, no bitcoin needed):
  btcnotar submit <hash|text>  Send a hash to the server queue (text is hashed with SHA-256)
  btcnotar check <hash|text>   Get the proof from the server and verify it on the blockchain
  btcnotar wait <hash|text>    Wait until the hash is on the blockchain (polls every minute)
  btcnotar save <hash|text> [out.json]
                               Download the proof and save it (default: <hash>.btcnotar.json)

  Instead of <hash|text> you can use --file <path> (the file is hashed locally).

Verify a saved proof file (no server needed, only the blockchain):
  btcnotar verify-file <proof.json> [--doc <document>]

Own notary (needs BTCNOTAR_WIF and a funded address):
  btcnotar add <hash>        Queue a document hash for the next settlement
  btcnotar settle            Settle all pending hashes now (build Merkle tree + anchor on-chain)
  btcnotar proof <hash>      Print the stored proof for a hash
  btcnotar verify <hash>     Verify a hash against the live blockchain
  btcnotar address           Print the notary's Bitcoin address

Environment variables:
  BTCNOTAR_SERVER    Server for submit/check (or --server <url>). Default: the free public server
  BTCNOTAR_WIF       Bitcoin private key (WIF) used to fund/sign anchor transactions [required]
  BTCNOTAR_NETWORK   "mainnet" or "testnet" (default: mainnet)
  BTCNOTAR_STORE     Path to the JSON store file (default: ./.btcnotar/store.json)

  Variables can also be in a .env file in the current folder (Node 20.12+).
`);
}

function buildNotary() {
    const wif = process.env.BTCNOTAR_WIF;
    if (!wif) {
        console.error("Missing BTCNOTAR_WIF environment variable.");
        process.exit(1);
    }
    const network = process.env.BTCNOTAR_NETWORK || "mainnet";
    const filePath = process.env.BTCNOTAR_STORE || "./.btcnotar/store.json";
    return new BTCNotar({ wif, network, store: new FileStore({ filePath }) });
}

function toHash(input) {
    if (!input) throw new Error("give a hash or a text");
    return /^[0-9a-fA-F]{64}$/.test(input) ? input.toLowerCase() : sha256Hex(input);
}

// Take "--name value" out of args. Returns value or undefined.
function takeOpt(args, name) {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const value = args[i + 1];
    if (!value) throw new Error(`${name} needs a value`);
    args.splice(i, 2);
    return value;
}

function buildClient(args) {
    const serverUrl = takeOpt(args, "--server") || process.env.BTCNOTAR_SERVER || undefined; // undefined = public server
    return new BTCNotarClient({ serverUrl, network: process.env.BTCNOTAR_NETWORK || "mainnet" });
}

async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];

    if (!cmd || cmd === "-h" || cmd === "--help") return usage();

    if (cmd === "verify-file") {
        const doc = takeOpt(args, "--doc");
        const proofPath = args[1];
        if (!proofPath) throw new Error("usage: btcnotar verify-file <proof.json> [--doc <document>]");
        const out = await verifyProofFile(proofPath, { file: doc });
        console.log(JSON.stringify(out, null, 2));
        process.exit(out.valid ? 0 : 1);
        return;
    }

    if (["submit", "check", "wait", "save"].includes(cmd)) {
        const client = buildClient(args);
        const filePath = takeOpt(args, "--file");
        let hash, out;
        let rest = args.slice(1);
        if (filePath) {
            hash = sha256Hex(fs.readFileSync(filePath));
            console.log(`SHA-256: ${hash}`);
        } else {
            // "save" may end with an output .json path
            if (cmd === "save" && rest.length > 1 && rest[rest.length - 1].endsWith(".json")) out = rest.pop();
            const input = rest.join(" ");
            hash = toHash(input);
            if (hash !== input.toLowerCase()) console.log(`SHA-256: ${hash}`);
        }
        if (cmd === "save" && filePath && rest.length) out = rest[0];

        if (cmd === "submit") return console.log(JSON.stringify(await client.submit(hash), null, 2));

        if (cmd === "check") {
            const res = await client.verify(hash);
            console.log(JSON.stringify(res, null, 2));
            process.exit(res.valid ? 0 : 1);
        }

        if (cmd === "wait") {
            const record = await client.waitForProof(hash, {
                onUpdate: (u) => console.error(u.status === "pending" ? `pending, next settle: ${u.nextSettleAt}` : `in tx ${u.txid}, waiting for a block`),
            });
            console.log(`On the blockchain: tx ${record.txid}`);
            return;
        }

        // save
        const target = out || (filePath ? `${filePath}.btcnotar.json` : `${hash}.btcnotar.json`);
        const pf = await client.saveProof(hash, target);
        console.log(`Saved proof to ${target} (tx ${pf.txid})`);
        return;
    }

    const arg = args[1];

    if (cmd === "address") {
        const notary = buildNotary();
        console.log(notary.address);
        return;
    }

    if (cmd === "add") {
        if (!arg) throw new Error("usage: btcnotar add <hash>");
        const notary = buildNotary();
        const entry = await notary.addHash(arg);
        console.log(JSON.stringify(entry, null, 2));
        return;
    }

    if (cmd === "settle") {
        const notary = buildNotary();
        const batch = await notary.settle();
        console.log(batch ? JSON.stringify(batch, null, 2) : "Nothing pending.");
        return;
    }

    if (cmd === "proof") {
        if (!arg) throw new Error("usage: btcnotar proof <hash>");
        const notary = buildNotary();
        const proof = await notary.getProof(arg);
        console.log(proof ? JSON.stringify(proof, null, 2) : "No proof found for that hash.");
        return;
    }

    if (cmd === "verify") {
        if (!arg) throw new Error("usage: btcnotar verify <hash>");
        const notary = buildNotary();
        const result = await notary.verify(arg);
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.valid ? 0 : 1);
        return;
    }

    console.error(`Unknown command: ${cmd}`);
    usage();
    process.exit(1);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
