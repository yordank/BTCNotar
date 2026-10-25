// Reviewer agent: waits for the developer's report, tests and reviews the changes, writes the verdict to WORKLOG.md.
import {
    S, MAX_FAILURES, AUTO_COMMIT, log, logOnce, readStatus, writeStatus, appendEntry, lastEntry, readTasks, markTaskDone, git, runClaude, pollLoop, pushIfEnabled,
} from "./lib.js";

const WHO = "REVIEW";
let failures = 0;

function buildPrompt(task, round) {
    return `You are the REVIEWER agent for this repository (BTCNotar, Node.js, ES modules).
You do NOT change code. You only test and review.

Task ${task.num} from agents/PLAN.md (round ${round}):
${task.text}

The developer's report:
${lastEntry("DEVELOPER")}

Steps:
1. See the changes: \`git status\` and \`git diff\` (also read new, untracked files).
2. Run \`npm test\`.
3. Check: is the task fully done? Bugs? Missing tests? Security problems (keys, secrets)? Code style?

Do NOT read .env files. Do NOT edit files. Do NOT commit.

Reply in simple Bulgarian: what you checked, test results, and a numbered list of problems (if any).
Only real problems count. Small style notes are not a reason to reject.
The LAST line of your reply must be exactly one of:
VERDICT: APPROVED
VERDICT: CHANGES_REQUESTED`;
}

function commit(task) {
    if (!AUTO_COMMIT) return;
    try {
        git("add -A");
        git(`commit -m "Task ${task.num}: ${task.text.replace(/["`$\\]/g, "'").slice(0, 70)}"`);
        log(WHO, "Committed.");
        pushIfEnabled(WHO);
    } catch (e) {
        log(WHO, `Commit skipped: ${String(e.stderr || e.message).trim().split("\n").pop()}`);
    }
}

async function review(task, round) {
    writeStatus(S.REVIEW_WORKING, task.num, round);
    log(WHO, `Reviewing task ${task.num}, round ${round}`);

    const res = await runClaude({ prompt: buildPrompt(task, round), settings: "review-settings.json" });
    if (!res.ok) {
        failures++;
        log(WHO, `Run failed (${failures}/${MAX_FAILURES}): ${res.text.slice(0, 300)}`);
        if (failures >= MAX_FAILURES) {
            appendEntry(`Task ${task.num} · Round ${round} · REVIEWER · ERROR`, res.text);
            writeStatus(S.BLOCKED, task.num, round);
        }
        return;
    }
    failures = 0;

    const verdict = res.text.match(/VERDICT:\s*(APPROVED|CHANGES_REQUESTED)\s*$/);
    const approved = verdict?.[1] === "APPROVED";
    const body = verdict ? res.text : `${res.text}\n\n(No VERDICT line found, treated as CHANGES_REQUESTED.)`;
    appendEntry(`Task ${task.num} · Round ${round} · REVIEWER · ${approved ? "APPROVED" : "CHANGES REQUESTED"}`, body);

    if (approved) {
        markTaskDone(task.num);
        commit(task); // commit + push before the status change, so DEV never runs git at the same time
        writeStatus(S.REVIEW_APPROVED, task.num, round);
        log(WHO, `Task ${task.num} approved. Next task.`);
    } else {
        writeStatus(S.REVIEW_CHANGES, task.num, round);
        log(WHO, `Task ${task.num}: changes requested.`);
    }
}

pollLoop(WHO, async () => {
    const st = readStatus();
    if (st?.state === S.BLOCKED) {
        logOnce(WHO, "BLOCKED. Waiting until the BLOCKED line is removed from WORKLOG.md.");
        return;
    }
    // DEV_DONE: our turn. REVIEW_WORKING here means a stopped/failed run: try again.
    if (st?.state !== S.DEV_DONE && st?.state !== S.REVIEW_WORKING) return;
    logOnce(WHO, "");

    const task = readTasks().find((t) => t.num === st.task);
    if (!task) {
        log(WHO, `Task ${st.task} is not in PLAN.md anymore.`);
        return;
    }
    return review(task, st.round);
});
