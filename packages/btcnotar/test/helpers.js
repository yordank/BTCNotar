// Shared test helpers: random testnet key and an in-memory chain.
import crypto from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

export function sha256hex(s) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

export function testWif() {
    const keyPair = ECPair.makeRandom({ network: bitcoin.networks.testnet });
    return keyPair.toWIF();
}

/**
 * Minimal in-memory chain simulator implementing the same interface as
 * MempoolProvider, so settle()/verify() can be exercised end-to-end
 * without any network access.
 */
export class FakeProvider {
    constructor() {
        this.broadcasted = new Map(); // txid -> { rawHex, vout, confirmed }
    }

    async fetchUtxos() {
        return [{ txid: "f".repeat(64), vout: 0, value: 100000 }];
    }

    async fetchFeeRateSatVb() {
        return 5;
    }

    async broadcastTx(rawHex) {
        const tx = bitcoin.Transaction.fromHex(rawHex);
        const txid = tx.getId();
        this.broadcasted.set(txid, {
            vout: tx.outs.map((o) => ({ scriptpubkey: Buffer.from(o.script).toString("hex"), value: Number(o.value) })),
        });
        return txid;
    }

    async fetchTransaction(txid) {
        const tx = this.broadcasted.get(txid);
        if (!tx) return null;
        return {
            txid,
            confirmed: true,
            blockHeight: 900000,
            blockHash: "b".repeat(64),
            blockTime: 1750000000,
            vout: tx.vout,
        };
    }
}

