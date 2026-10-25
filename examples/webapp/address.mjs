import { BTCNotar } from "btcnotar";
console.log(new BTCNotar({ wif: process.env.OPRETURN_WIF_MAINNET }).address);