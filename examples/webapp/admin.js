// Admin tool: manual transactions with your ADMIN_KEY.
//
// Usage (from examples/webapp):
//   node --env-file=.env admin.js anchor <hash or text>   one OP_RETURN tx now (text is hashed with SHA-256)
//   node --env-file=.env admin.js settle                  anchor all queued hashes now (one Merkle tx)
//   node --env-file=.env admin.js balance                 Lightning wallet balance
//
// Env: ADMIN_KEY (required), SERVER_URL (default http://localhost:8787)
import crypto from "node:crypto";

const SERVER = (process.env.SERVER_URL || "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.ADMIN_KEY;

async function call(method, path, body) {
    const res = await fetch(SERVER + path, {
        method,
        headers: { "Content-Type": "application/json", "x-admin-key": KEY },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${data.error ? JSON.stringify(data.error) : res.statusText}`);
    return data;
}

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    if (!KEY) throw new Error("ADMIN_KEY is not set (put it in .env)");

    if (cmd === "anchor") {
        const input = rest.join(" ");
        if (!input) throw new Error('usage: admin.js anchor <hash or text>');
        const isHash = /^[0-9a-fA-F]{64}$/.test(input);
        const hashHex = isHash ? input.toLowerCase() : crypto.createHash("sha256").update(input, "utf8").digest("hex");
        if (!isHash) console.log(`SHA-256 of text: ${hashHex}`);
        const out = await call("POST", "/api/opreturn", { hashHex });
        console.log(JSON.stringify(out, null, 2));
        return;
    }
    if (cmd === "settle") {
        console.log(JSON.stringify(await call("POST", "/api/notary/settle"), null, 2));
        return;
    }
    if (cmd === "balance") {
        const { balanceSat } = await call("GET", "/api/balance");
        console.log(`Lightning balance: ${balanceSat} sat`);
        return;
    }
    console.log("Commands: anchor <hash or text> | settle | balance");
}

main().catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
});
