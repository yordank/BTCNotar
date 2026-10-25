#!/usr/bin/env node
import "dotenv/config";
import { BTCNotar, BTCNotarClient, sha256Hex } from "../index.js";
import { FileStore } from "../src/store.js";

function usage() {
    console.log(`btcnotar - batch Bitcoin notarization CLI

Free public server (no key, no bitcoin needed):
  btcnotar submit <hash|text>  Send a hash to the server queue (text is hashed with SHA-256)
  btcnotar check <hash|text>   Get the proof from the server and verify it on the blockchain

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

function buildClient(args) {
    const i = args.indexOf("--server");
    const serverUrl = (i >= 0 ? args[i + 1] : process.env.BTCNOTAR_SERVER) || undefined; // undefined = public server
    if (i >= 0) args.splice(i, 2);
    return new BTCNotarClient({ serverUrl, network: process.env.BTCNOTAR_NETWORK || "mainnet" });
}

async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];

    if (!cmd || cmd === "-h" || cmd === "--help") return usage();

    if (cmd === "submit" || cmd === "check") {
        const client = buildClient(args);
        const input = args.slice(1).join(" ");
        const hash = toHash(input);
        if (hash !== input.toLowerCase()) console.log(`SHA-256: ${hash}`);
        const out = cmd === "submit" ? await client.submit(hash) : await client.verify(hash);
        console.log(JSON.stringify(out, null, 2));
        if (cmd === "check") process.exit(out.valid ? 0 : 1);
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
