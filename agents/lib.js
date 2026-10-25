// Shared helpers for the developer and reviewer agents.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(AGENTS_DIR, "..");
export const PLAN_FILE = path.join(AGENTS_DIR, "PLAN.md");
export const LOG_FILE = path.join(AGENTS_DIR, "WORKLOG.md");

export const POLL_MS = Number(process.env.AGENT_POLL_MS || 10_000);
export const MAX_ROUNDS = Number(process.env.AGENT_MAX_ROUNDS || 5);
export const MAX_FAILURES = 3;
export const RUN_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 30 * 60_000);
export const AUTO_COMMIT = process.env.AGENT_AUTO_COMMIT !== "0";

// Status states written to WORKLOG.md
export const S = {
    DEV_WORKING: "DEV_WORKING",
    DEV_DONE: "DEV_DONE",
    REVIEW_WORKING: "REVIEW_WORKING",
    REVIEW_CHANGES: "REVIEW_CHANGES",
    REVIEW_APPROVED: "REVIEW_APPROVED",
    ALL_DONE: "ALL_DONE",
    BLOCKED: "BLOCKED",
};

export function log(who, msg) {
    const t = new Date().toLocaleTimeString();
    console.log(`[${t}] [${who}] ${msg}`);
}

function readLog() {
    return fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8") : "";
}

// Last "STATUS: X | task N | round R" line in WORKLOG.md, or null.
export function readStatus() {
    const lines = readLog().split(/\r?\n/).filter((l) => l.startsWith("STATUS: "));
    if (!lines.length) return null;
    const m = lines.at(-1).match(/^STATUS: (\w+)(?: \| task (\d+))?(?: \| round (\d+))?/);
    if (!m) return null;
    return { state: m[1], task: m[2] ? Number(m[2]) : null, round: m[3] ? Number(m[3]) : null };
}

export function writeStatus(state, task, round) {
    let line = `STATUS: ${state}`;
    if (task != null) line += ` | task ${task}`;
    if (round != null) line += ` | round ${round}`;
    fs.appendFileSync(LOG_FILE, `${line}\n\n`);
}

export function appendEntry(title, body) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    fs.appendFileSync(LOG_FILE, `## ${title} · ${stamp}\n\n${body.trim()}\n\n`);
}

// The last entry written by the given role ("DEVELOPER" or "REVIEWER").
export function lastEntry(role) {
    const parts = readLog().split(/^## /m).filter((p) => p.includes(`· ${role} ·`));
    if (!parts.length) return "";
    return parts.at(-1).replace(/^STATUS: .*$/gm, "").trim();
}

// Tasks from PLAN.md: lines like "- [ ] text" or "- [x] text".
export function readTasks() {
    const lines = fs.readFileSync(PLAN_FILE, "utf8").split(/\r?\n/);
    const tasks = [];
    lines.forEach((line, i) => {
        const m = line.match(/^\s*[-*] \[( |x|X)\] (.+)$/);
        if (m) tasks.push({ num: tasks.length + 1, line: i, done: m[1] !== " ", text: m[2].trim() });
    });
    return tasks;
}

export function markTaskDone(num) {
    const task = readTasks().find((t) => t.num === num);
    if (!task) return;
    const raw = fs.readFileSync(PLAN_FILE, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const lines = raw.split(/\r?\n/);
    lines[task.line] = lines[task.line].replace("[ ]", "[x]");
    fs.writeFileSync(PLAN_FILE, lines.join(eol));
}

export function git(cmd) {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

// Run Claude Code headless. The prompt goes through stdin (no quoting issues on Windows).
export function runClaude({ prompt, settings, permissionMode = "default" }) {
    const args = [
        "-p",
        "--output-format", "json",
        "--permission-mode", permissionMode,
        "--settings", path.join(AGENTS_DIR, settings),
    ];
    if (process.env.AGENT_MODEL) args.push("--model", process.env.AGENT_MODEL);

    return new Promise((resolve) => {
        const child = spawn("claude", args, { cwd: ROOT, shell: true });
        let out = "";
        let err = "";
        const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e) => {
            clearTimeout(timer);
            resolve({ ok: false, text: `Cannot start claude: ${e.message}` });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            const jsonLine = out.trim().split(/\r?\n/).reverse().find((l) => l.startsWith("{"));
            try {
                const res = JSON.parse(jsonLine);
                resolve({ ok: !res.is_error, text: res.result || "", cost: res.total_cost_usd });
            } catch {
                resolve({ ok: false, text: `claude exited with code ${code}\n${err || out}`.trim() });
            }
        });
        child.stdin.end(prompt);
    });
}

// Poll every POLL_MS; never run two steps at the same time.
export function pollLoop(who, step) {
    let busy = false;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try {
            const stop = await step();
            if (stop) {
                log(who, "Stopping.");
                process.exit(0);
            }
        } catch (e) {
            log(who, `Error: ${e.message}`);
        } finally {
            busy = false;
        }
    };
    log(who, `Watching ${path.relative(ROOT, LOG_FILE)} every ${POLL_MS / 1000}s`);
    tick();
    setInterval(tick, POLL_MS);
}
