// Starts both agents in one terminal. Stop with Ctrl+C.
import { spawn } from "node:child_process";
import path from "node:path";
import { AGENTS_DIR } from "./lib.js";

const kids = ["developer.js", "reviewer.js"].map((f) =>
    spawn(process.execPath, [path.join(AGENTS_DIR, f)], { stdio: "inherit" }),
);
const stopAll = () => kids.forEach((k) => k.kill());
process.on("SIGINT", stopAll);
let left = kids.length;
kids.forEach((k) => k.on("exit", () => --left === 0 && process.exit(0)));
