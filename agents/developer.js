// Developer agent: takes the next task from PLAN.md, implements it, writes a report to WORKLOG.md, then waits for review.
import {
    S, MAX_ROUNDS, MAX_FAILURES, log, logOnce, readStatus, writeStatus, appendEntry, lastEntry, readTasks, runClaude, pollLoop, pullIfDue,
} from "./lib.js";

const WHO = "DEV";
let failures = 0;

function buildPrompt(task, round) {
    const review = round > 1 ? lastEntry("REVIEWER") : "";
    return `You are the DEVELOPER agent for this repository (BTCNotar, Node.js, ES modules).

Task ${task.num} from agents/PLAN.md:
${task.text}

${review ? `This is round ${round}. The reviewer asked for changes. Fix every point:\n\n${review}\n` : ""}
Rules:
- Implement only this task. Keep changes small and clean.
- Run the tests with \`npm test\` and make sure they pass. Add tests when it makes sense.
- Do NOT edit files in the agents/ folder. Do NOT read .env files. Do NOT commit or push.

When you finish, reply with a short report in simple Bulgarian:
- what you changed (files),
- how you tested it (commands and result),
- anything the reviewer should check.`;
}

async function work(task, round) {
    writeStatus(S.DEV_WORKING, task.num, round);
    log(WHO, `Task ${task.num}, round ${round}: ${task.text}`);

    const res = await runClaude({ prompt: buildPrompt(task, round), settings: "dev-settings.json", permissionMode: "acceptEdits" });
    if (!res.ok) {
        failures++;
        log(WHO, `Run failed (${failures}/${MAX_FAILURES}): ${res.text.slice(0, 300)}`);
        if (failures >= MAX_FAILURES) {
            appendEntry(`Task ${task.num} · Round ${round} · DEVELOPER · ERROR`, res.text);
            writeStatus(S.BLOCKED, task.num, round);
        }
        return; // status stays DEV_WORKING -> retried on the next poll
    }
    failures = 0;
    appendEntry(`Task ${task.num} · Round ${round} · DEVELOPER · ${task.text}`, res.text);
    writeStatus(S.DEV_DONE, task.num, round);
    log(WHO, `Done${res.cost ? ` ($${res.cost.toFixed(2)})` : ""}. Waiting for review.`);
}

pollLoop(WHO, async () => {
    let st = readStatus();

    if (st?.state === S.BLOCKED) {
        logOnce(WHO, "BLOCKED. Fix the problem, then delete the BLOCKED line in WORKLOG.md.");
        return;
    }

    // Idle (nothing started, last task approved, or all done): look for the next task.
    if (!st || st.state === S.REVIEW_APPROVED || st.state === S.ALL_DONE) {
        pullIfDue(WHO);
        st = readStatus(); // a pull can change WORKLOG.md too
        if (st && ![S.REVIEW_APPROVED, S.ALL_DONE].includes(st.state)) return;
        const next = readTasks().find((t) => !t.done);
        if (!next) {
            if (st?.state !== S.ALL_DONE) writeStatus(S.ALL_DONE);
            logOnce(WHO, "All tasks done. Waiting for new tasks in PLAN.md...");
            return;
        }
        logOnce(WHO, "");
        return work(next, 1);
    }

    const task = readTasks().find((t) => t.num === st.task);
    if (!task) {
        log(WHO, `Task ${st.task} is not in PLAN.md anymore.`);
        writeStatus(S.BLOCKED, st.task, st.round);
        return;
    }

    // Reviewer asked for changes: same task, next round.
    if (st.state === S.REVIEW_CHANGES) {
        if (st.round >= MAX_ROUNDS) {
            log(WHO, `Task ${task.num}: ${MAX_ROUNDS} rounds without approval.`);
            writeStatus(S.BLOCKED, task.num, st.round);
            return;
        }
        return work(task, st.round + 1);
    }

    // DEV_WORKING here means the last run failed or was stopped: try again.
    if (st.state === S.DEV_WORKING) return work(task, st.round);

    // DEV_DONE / REVIEW_WORKING: reviewer's turn, keep waiting.
});
