#!/usr/bin/env node
// Notarize git commits on Bitcoin with the free btcnotar server.
//
// For every commit:  hash = SHA-256 of the raw commit object
//                    (the same bytes as `git cat-file commit <sha>`).
// The commit object contains the tree, the parents, the author and the message,
// so this one hash fixes the whole history up to that commit.
//
// The results go to a folder (default: ./btcnotar-proofs):
//   commits.json              ledger: sha -> hash, status, txid, block
//   <sha>.btcnotar.json       proof file, when the hash is in a Bitcoin block
//   README.md                 table for humans (shown on GitHub)
//
// Run it again and again (e.g. every hour from GitHub Actions): it sends only new
// commits and downloads proofs for commits that were waiting.
//
// Usage:
//   node scripts/notarize-commits.mjs [--all | --range A..B] [--out DIR] [--server URL] [--max N]
//     --all           every commit reachable from HEAD (default: same)
//     --range A..B    only commits in this git range (e.g. the commits of one push)
//
// Verify one commit later (only the blockchain is needed, not our server):
//   git cat-file commit <sha> > commit.bin
//   npx btcnotar verify-file btcnotar-proofs/<sha>.btcnotar.json --doc commit.bin
//
// No dependencies: Node 20+ and git.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SERVER = opt("--server", process.env.BTCNOTAR_SERVER || "https://proofofexistance-production.up.railway.app").replace(/\/+$/, "");
const OUT = path.resolve(opt("--out", "btcnotar-proofs"));
const RANGE = opt("--range", "");
const MAX = Number(opt("--max", 500));
const REPO_URL = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}` : "";
const CHUNK = 25; // server limit: 30 new hashes per minute per IP

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => execFileSync("git", a, { maxBuffer: 1 << 30 });

// ---------- ledger ----------
const ledgerPath = path.join(OUT, "commits.json");
fs.mkdirSync(OUT, { recursive: true });
let ledger = { version: 1, hashRule: "sha256(git cat-file commit <sha>)", server: SERVER, commits: {} };
try {
    ledger = { ...ledger, ...JSON.parse(fs.readFileSync(ledgerPath, "utf8")) };
} catch {
    /* new ledger */
}
const save = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");

// ---------- commits ----------
function listCommits() {
    const range = RANGE && !/^0+\.\./.test(RANGE) ? [RANGE] : ["HEAD"];
    const out = git("log", "--reverse", "--format=%H%x09%cI%x09%s", ...range).toString().trim();
    if (!out) return [];
    return out.split("\n").map((l) => {
        const [sha, date, ...s] = l.split("\t");
        return { sha, date, subject: s.join("\t") };
    });
}
const commitHash = (sha) => createHash("sha256").update(git("cat-file", "commit", sha)).digest("hex");

// ---------- server ----------
async function api(method, p, body) {
    const r = await fetch(SERVER + p, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, j };
}

function applyStatus(entry, s) {
    if (!s || s.error) return;
    if (s.status === "anchored" || s.txid) {
        entry.status = "anchored";
        entry.txid = s.txid;
        if (s.blockHeight) entry.blockHeight = s.blockHeight;
        if (s.blockTime) entry.blockTime = s.blockTime;
    } else if (s.status === "pending") {
        entry.status = "pending";
        entry.nextSettleAt = s.nextSettleAt;
    }
}

// 1) send new commits
async function submitNew(commits) {
    const fresh = commits.filter((c) => !ledger.commits[c.sha]?.submittedAt).slice(0, MAX);
    if (!fresh.length) return console.log("no new commits");
    console.log(`sending ${fresh.length} commit(s) to ${SERVER}`);
    for (let i = 0; i < fresh.length; i += CHUNK) {
        if (i > 0) {
            console.log("  waiting 61 s (rate limit)…");
            await sleep(61_000);
        }
        const part = fresh.slice(i, i + CHUNK).map((c) => ({ ...c, hash: commitHash(c.sha) }));
        const r = await api("POST", "/api/notary/hashes", { hashes: part.map((c) => c.hash) });
        if (!r.ok) {
            console.error(`  server error ${r.status}: ${r.j.error || ""} — will try again next run`);
            break;
        }
        part.forEach((c, k) => {
            const res = r.j.results?.[k] || {};
            if (res.error) return console.error(`  ${c.sha.slice(0, 7)}: ${res.error}`);
            const entry = (ledger.commits[c.sha] = { hash: c.hash, subject: c.subject, date: c.date, submittedAt: new Date().toISOString() });
            applyStatus(entry, res);
            console.log(`  ${c.sha.slice(0, 7)} ${entry.status.padEnd(8)} ${c.subject.slice(0, 60)}`);
        });
        save();
    }
}

// 2) check waiting commits, download proofs when they are in a block
async function refresh() {
    const waiting = Object.entries(ledger.commits).filter(([sha, e]) => !e.confirmed || !fs.existsSync(path.join(OUT, sha + ".btcnotar.json")));
    let done = 0;
    for (const [sha, e] of waiting) {
        const v = await api("GET", "/api/notary/verify/" + e.hash);
        if (!v.ok) continue;
        if (v.j.valid) {
            e.status = "anchored";
            e.txid = v.j.txid;
            e.blockHeight = v.j.blockHeight ?? null;
            e.blockTime = v.j.blockTime ?? null;
            e.confirmed = !!v.j.confirmed;
            if (e.confirmed) {
                const p = await api("GET", "/api/notary/prooffile/" + e.hash);
                if (p.ok) {
                    fs.writeFileSync(path.join(OUT, sha + ".btcnotar.json"), JSON.stringify(p.j, null, 2) + "\n");
                    done++;
                }
            }
        } else if (v.j.reason === "pending") {
            e.status = "pending";
            e.nextSettleAt = v.j.nextSettleAt;
        } else if (v.j.reason === "unknown-hash" || v.j.reason === "no-proof-found") {
            delete e.submittedAt; // lost (e.g. server reset): send again next run
            e.status = "unknown";
        }
    }
    save();
    console.log(`checked ${waiting.length} waiting commit(s), ${done} new proof file(s)`);
}

// 3) README table
function writeReadme(commits) {
    const order = new Map(commits.map((c, i) => [c.sha, i]));
    const rows = Object.entries(ledger.commits).sort((a, b) => (order.get(b[0]) ?? -1) - (order.get(a[0]) ?? -1) || String(b[1].date).localeCompare(String(a[1].date)));
    const n = rows.length;
    const inBlock = rows.filter(([, e]) => e.confirmed).length;
    const txs = new Set(rows.map(([, e]) => e.txid).filter(Boolean)).size;
    const link = (sha) => (REPO_URL ? `[\`${sha.slice(0, 7)}\`](${REPO_URL}/commit/${sha})` : `\`${sha.slice(0, 7)}\``);
    const md = [
        "# Commits notarized on Bitcoin",
        "",
        `Every commit of this repository is anchored on the Bitcoin blockchain with [btcnotar](https://btcnotar.com).`,
        "",
        `**${n}** commits · **${inBlock}** in a Bitcoin block · **${txs}** Bitcoin transactions · updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
        "",
        "## How to check a commit yourself",
        "",
        "```bash",
        "git cat-file commit <sha> > commit.bin          # the raw commit object",
        "npx btcnotar verify-file <sha>.btcnotar.json --doc commit.bin",
        "```",
        "",
        "The proof is checked against the Bitcoin blockchain only — not against btcnotar.com.",
        "The commit object contains the tree, the parents, the author and the message, so the proof covers the whole history up to that commit.",
        "",
        "| commit | date | message | status | Bitcoin tx | proof |",
        "|---|---|---|---|---|---|",
        ...rows.map(([sha, e]) => {
            const st = e.confirmed ? `✅ block ${e.blockHeight}` : e.status === "anchored" ? "⏳ in mempool" : e.status === "pending" ? "🕐 in queue" : "—";
            const tx = e.txid ? `[${e.txid.slice(0, 10)}…](https://mempool.space/tx/${e.txid})` : "";
            const pf = fs.existsSync(path.join(OUT, sha + ".btcnotar.json")) ? `[json](./${sha}.btcnotar.json)` : "";
            const msg = String(e.subject || "").replace(/\|/g, "\\|").slice(0, 70);
            return `| ${link(sha)} | ${String(e.date || "").slice(0, 10)} | ${msg} | ${st} | ${tx} | ${pf} |`;
        }),
        "",
    ].join("\n");
    fs.writeFileSync(path.join(OUT, "README.md"), md);
}

const commits = listCommits();
await submitNew(commits);
await refresh();
writeReadme(listCommitsAllSafe());

function listCommitsAllSafe() {
    try {
        return git("log", "--reverse", "--format=%H%x09%cI%x09%s", "HEAD")
            .toString()
            .trim()
            .split("\n")
            .map((l) => ({ sha: l.split("\t")[0] }));
    } catch {
        return commits;
    }
}
