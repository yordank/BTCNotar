import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as full from "../index.js";
import * as light from "../client.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function declared(file, seen = new Set()) {
    const src = fs.readFileSync(path.join(root, "types", file), "utf8");
    const names = new Set([...src.matchAll(/export declare (?:class|function|const) (\w+)/g)].map((m) => m[1]));
    for (const m of src.matchAll(/export \* from "\.\/(\w+)\.js"/g)) {
        if (!seen.has(m[1])) for (const n of declared(`${m[1]}.d.ts`, seen.add(m[1]))) names.add(n);
    }
    return names;
}

test("every runtime export has a type (index.d.ts)", () => {
    const types = declared("index.d.ts");
    const missing = Object.keys(full).filter((k) => !types.has(k));
    assert.deepEqual(missing, []);
});

test("every runtime export has a type (client.d.ts)", () => {
    const types = declared("client.d.ts");
    const missing = Object.keys(light).filter((k) => !types.has(k));
    assert.deepEqual(missing, []);
    const extra = [...types].filter((k) => !(k in light));
    assert.deepEqual(extra, [], "types for things btcnotar/client does not export");
});
