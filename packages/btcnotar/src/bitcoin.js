import * as bitcoin from "bitcoinjs-lib";
import { OP_RETURN_MAX_BYTES } from "./chain.js";

export {
    MAGIC,
    OP_RETURN_MAX_BYTES,
    encodeOpReturnPayload,
    decodeOpReturnPayload,
    extractOpReturnData,
    scriptPushes,
    httpRequest,
    MempoolProvider,
} from "./chain.js";

/** nSequence that signals opt-in Replace-By-Fee (BIP 125). */
export const RBF_SEQUENCE = 0xfffffffd;

export function buildOpReturnScript(dataBuffer) {
    if (dataBuffer.length > OP_RETURN_MAX_BYTES) throw new Error("OP_RETURN > 80 bytes");
    return bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, dataBuffer]);
}

/**
 * Build, sign and serialize a single-input OP_RETURN transaction spending
 * one P2WPKH UTXO, with the (optional) change sent back to the same address.
 */
export function createOpReturnTx({ keyPair, fromAddress, utxo, dataBuffer, feeSat, network }) {
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
    const psbt = new bitcoin.Psbt({ network });

    psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: RBF_SEQUENCE, // opt-in Replace-By-Fee: the fee can be raised later
        witnessUtxo: { script: p2wpkh.output, value: BigInt(utxo.value) },
    });

    psbt.addOutput({ script: buildOpReturnScript(dataBuffer), value: 0n });

    const DUST_LIMIT = 1000n;
    let change = BigInt(utxo.value) - BigInt(feeSat);
    if (change <= 0n) throw new Error("Insufficient funds for fee");
    if (change < DUST_LIMIT) change = 0n;
    if (change > 0n) psbt.addOutput({ address: fromAddress, value: change });

    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    return { rawHex: tx.toHex(), txid: tx.getId() };
}

