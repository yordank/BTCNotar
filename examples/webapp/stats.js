// Public usage statistics for the landing page (GET /api/stats).
//
// Two kinds of numbers:
//  1. From the notary store (always correct, nothing extra to save):
//     anchored hashes, transactions, pending queue, recent batches.
//  2. Request counters (submits, checks, proof downloads, MCP calls, paid anchors).
//     Kept in memory and saved to <DATA_DIR>/stats.json every 30 s.
//  3. Outside numbers: npm / PyPI downloads, GitHub stars (cached 15 min).

import fs from "node:fs";
import path from "node:path";

const EXTERNAL_TTL_MS = 15 * 60 * 1000;
const STATS_TTL_MS = 30 * 1000;

export function createStats({ dataDir = "", notary = null, repo = "yordank/BTCNotar", npmPackages = ["btcnotar", "btcnotar-mcp"], pypiPackage = "btcnotar" } = {}) {
    const file = path.join(dataDir || "./.data", "stats.json");

    const counters = {
        since: new Date().toISOString(),
        hashesSubmitted: 0, // via /api/notary/hash(es)
        checks: 0, // /api/notary/verify + /api/notary/proof
        proofDownloads: 0, // /api/notary/prooffile
        mcpCalls: 0, // POST /mcp (tools/call only)
        paidAnchors: 0, // /api/opreturn (Lightning)
        lnInvoices: 0, // /api/ln/invoice
    };

    try {
        Object.assign(counters, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
        /* first start */
    }

    let dirty = false;
    const timer = setInterval(() => {
        if (!dirty) return;
        dirty = false;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(counters, null, 2));
        } catch (e) {
            console.error("[stats] save failed:", e?.message || e);
        }
    }, 30_000);
    timer.unref?.();

    function bump(key, n = 1) {
        counters[key] = (counters[key] || 0) + n;
        dirty = true;
    }

    // Express middleware: count successful requests by route.
    function middleware(req, res, next) {
        res.on("finish", () => {
            if (res.statusCode >= 400) return;
            const p = req.path;
            if (req.method === "POST" && p === "/api/notary/hash") bump("hashesSubmitted");
            else if (req.method === "POST" && p === "/api/notary/hashes") bump("hashesSubmitted", Array.isArray(req.body?.hashes) ? req.body.hashes.length : 1);
            else if (p.startsWith("/api/notary/verify/") || p.startsWith("/api/notary/proof/")) bump("checks");
            else if (p.startsWith("/api/notary/prooffile/")) bump("proofDownloads");
            else if (req.method === "POST" && p === "/mcp" && req.body?.method === "tools/call") bump("mcpCalls");
            else if (req.method === "POST" && p === "/api/opreturn") bump("paidAnchors");
            else if (req.method === "POST" && p === "/api/ln/invoice") bump("lnInvoices");
        });
        next();
    }

    // ---------- outside numbers (npm, PyPI, GitHub) ----------
    let external = null;
    let externalAt = 0;

    async function getJson(url) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
            const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "btcnotar-stats" } });
            return r.ok ? await r.json() : null;
        } catch {
            return null;
        } finally {
            clearTimeout(t);
        }
    }

    async function loadExternal() {
        if (external && Date.now() - externalAt < EXTERNAL_TTL_MS) return external;
        const today = new Date().toISOString().slice(0, 10);
        const npm = {};
        await Promise.all(
            npmPackages.map(async (name) => {
                const [week, total] = await Promise.all([
                    getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`),
                    getJson(`https://api.npmjs.org/downloads/point/2025-01-01:${today}/${name}`),
                ]);
                npm[name] = { lastWeek: week?.downloads ?? null, total: total?.downloads ?? null };
            })
        );
        const [pypi, gh] = await Promise.all([getJson(`https://pypistats.org/api/packages/${pypiPackage}/recent`), getJson(`https://api.github.com/repos/${repo}`)]);
        external = {
            npm,
            pypi: { lastMonth: pypi?.data?.last_month ?? null, lastWeek: pypi?.data?.last_week ?? null },
            github: { stars: gh?.stargazers_count ?? null, forks: gh?.forks_count ?? null },
        };
        externalAt = Date.now();
        return external;
    }

    // ---------- store numbers ----------
    async function loadChain() {
        if (!notary) return null;
        const batches = (await notary.store.listBatches()).filter((b) => b.status !== "signed");
        batches.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const anchoredHashes = batches.reduce((s, b) => s + (b.hashes?.length || 0), 0);
        const confirmed = batches.filter((b) => b.status === "confirmed" || b.blockHeight).length;
        return {
            network: notary.networkName || "mainnet",
            anchoredHashes,
            transactions: batches.length,
            confirmedTransactions: confirmed,
            largestBatch: batches.reduce((m, b) => Math.max(m, b.hashes?.length || 0), 0),
            firstAnchorAt: batches.length ? batches[batches.length - 1].createdAt : null,
            pendingHashes: await notary.pendingCount(),
            nextSettleAt: await notary.nextSettleAt().catch(() => null),
            recent: batches.slice(0, 8).map((b) => ({
                txid: b.txid,
                hashes: b.hashes?.length || 0,
                createdAt: b.createdAt,
                blockHeight: b.blockHeight ?? null,
            })),
        };
    }

    let cached = null;
    let cachedAt = 0;

    async function snapshot() {
        if (cached && Date.now() - cachedAt < STATS_TTL_MS) return cached;
        const [chain, ext] = await Promise.all([loadChain().catch(() => null), loadExternal().catch(() => null)]);
        cached = { updatedAt: new Date().toISOString(), chain, usage: { ...counters }, ...(ext || {}) };
        cachedAt = Date.now();
        return cached;
    }

    // GET /api/stats
    async function handler(req, res) {
        try {
            res.set("Cache-Control", "public, max-age=30");
            res.json(await snapshot());
        } catch (e) {
            res.status(500).json({ error: e?.message || String(e) });
        }
    }

    return { middleware, handler, bump, snapshot };
}
