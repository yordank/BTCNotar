#!/usr/bin/env node
import "dotenv/config";
import { BTCNotar } from "../index.js";
import { FileStore } from "../src/store.js";

function usage() {
    console.log(`btcnotar - batch Bitcoin notarization CLI

Usage:
  btcnotar add <hash>        Queue a document hash for the next settlement
  btcnotar settle            Settle all pending hashes now (build Merkle tree + anchor on-chain)
  btcnotar proof <hash>      Print the stored proof for a hash
  btcnotar verify <hash>     Verify a hash against the live blockchain
  btcnotar address           Print the notary's Bitcoin address

Environment variables:
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

async function main() {
    const [cmd, arg] = process.argv.slice(2);

    if (!cmd || cmd === "-h" || cmd === "--help") return usage();

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
