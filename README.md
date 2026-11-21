# Commits notarized on Bitcoin

Every commit of this repository is anchored on the Bitcoin blockchain with [btcnotar](https://btcnotar.com).

**60** commits · **0** in a Bitcoin block · **0** Bitcoin transactions · updated 2026-11-21 15:58 UTC

## How to check a commit yourself

```bash
git cat-file commit <sha> > commit.bin          # the raw commit object
npx btcnotar verify-file <sha>.btcnotar.json --doc commit.bin
```

The proof is checked against the Bitcoin blockchain only — not against btcnotar.com.
The commit object contains the tree, the parents, the author and the message, so the proof covers the whole history up to that commit.

| commit | date | message | status | Bitcoin tx | proof |
|---|---|---|---|---|---|
| [`c6c69eb`](https://github.com/yordank/BTCNotar/commit/c6c69ebcca8c95c8250eada7c74bc29c186e605a) | 2026-11-21 | notarize-commits: use the Railway server (btcnotar.com returns 405 for | 🕐 in queue |  |  |
| [`aa7e78a`](https://github.com/yordank/BTCNotar/commit/aa7e78aa7c5025d8647e3359a67eb6fb5a50ff43) | 2026-11-21 | Use case: notarize every git commit on Bitcoin | 🕐 in queue |  |  |
| [`517163d`](https://github.com/yordank/BTCNotar/commit/517163d1a4533a62eb12771e36b34340f3462aef) | 2026-11-21 | Make home.html the main page; add content from the old page | 🕐 in queue |  |  |
| [`2a58643`](https://github.com/yordank/BTCNotar/commit/2a5864334f2af9ab20dbebe9ef8cd54979fe01d6) | 2026-11-21 | Add landing page with live stats (home.html, /api/stats) | 🕐 in queue |  |  |
| [`0ac49fd`](https://github.com/yordank/BTCNotar/commit/0ac49fd43573ec27d63ebe67f20e36cba45d9b17) | 2026-11-06 | CI: fix workflow YAML | 🕐 in queue |  |  |
| [`3a58910`](https://github.com/yordank/BTCNotar/commit/3a58910fe78d4940d8ed6b03203fa7303399e0d9) | 2026-11-06 | Remote MCP endpoint /mcp on the web app (Streamable HTTP) + AI agents  | 🕐 in queue |  |  |
| [`b36b2ce`](https://github.com/yordank/BTCNotar/commit/b36b2ce363f3f661285fbfa42f128703c0e9936e) | 2026-11-06 | Add btcnotar-mcp: MCP server for AI agents (notarize, check, save_proo | 🕐 in queue |  |  |
| [`77ae8be`](https://github.com/yordank/BTCNotar/commit/77ae8bed3810d32dfd844833c27f2d86c6ba802f) | 2026-11-06 | PLAN: reminders to publish npm 0.4.0 and PyPI 0.1.0 | 🕐 in queue |  |  |
| [`b51fb4b`](https://github.com/yordank/BTCNotar/commit/b51fb4be02347a9a8d768cead7f52df702bd83a2) | 2026-11-06 | WORKLOG: fix task count | 🕐 in queue |  |  |
| [`d2c38cd`](https://github.com/yordank/BTCNotar/commit/d2c38cd0b48dbdae85343b6efa1ae87dc25144fa) | 2026-11-06 | btcnotar 0.4.0: README, CHANGELOG; update PLAN and WORKLOG | 🕐 in queue |  |  |
| [`0c0d2c1`](https://github.com/yordank/BTCNotar/commit/0c0d2c14eeca571b8d8f413bcc540f93dd034ca7) | 2026-11-06 | Python client package (pip btcnotar, no dependencies) + CI | 🕐 in queue |  |  |
| [`42bb160`](https://github.com/yordank/BTCNotar/commit/42bb160a32478c48d3506de53bb7b4d224ccebb7) | 2026-11-06 | Web app: download proof file, verify proof file in the browser (en/bg/ | 🕐 in queue |  |  |
| [`dc6dd5d`](https://github.com/yordank/BTCNotar/commit/dc6dd5d87be2598df01f830218700d9fa32cd665) | 2026-11-06 | Tests: use node:crypto rng for random keys (Node 18 has no global cryp | 🕐 in queue |  |  |
| [`9d7d55b`](https://github.com/yordank/BTCNotar/commit/9d7d55b5ad8abc508005d85ed25fdbb5383a10fd) | 2026-11-06 | Add spec/SPEC.md and spec/test-vectors.json (+ JS test) | 🕐 in queue |  |  |
| [`85004d5`](https://github.com/yordank/BTCNotar/commit/85004d5dbf7355a868553e75c2d24d34e4fc83e6) | 2026-11-06 | Tests for verify.js, bitcoin.js and CLI; BTCNOTAR_MEMPOOL_API; GitHub  | 🕐 in queue |  |  |
| [`8288e85`](https://github.com/yordank/BTCNotar/commit/8288e853c938a2985abaa18df9623867fa3bf1bb) | 2026-11-06 | Add TypeScript types for btcnotar and btcnotar/client | 🕐 in queue |  |  |
| [`25d143f`](https://github.com/yordank/BTCNotar/commit/25d143f33caf86cf501bc2f3356ffd96c414cf2d) | 2026-11-06 | Add sha256File (stream) and client.submitMany + /api/notary/hashes rou | 🕐 in queue |  |  |
| [`7211f26`](https://github.com/yordank/BTCNotar/commit/7211f26083dfe095147ee2e673d366d4878a4cee) | 2026-11-06 | Light entry btcnotar/client without bitcoinjs-lib (own OP_RETURN scrip | 🕐 in queue |  |  |
| [`e0ae9ed`](https://github.com/yordank/BTCNotar/commit/e0ae9ed8988a4bb0b3eea8934fed30a7dc35c674) | 2026-11-06 | Use built-in fetch instead of axios; drop dotenv from the library | 🕐 in queue |  |  |
| [`4be9ce4`](https://github.com/yordank/BTCNotar/commit/4be9ce4b14bf973ace887ea2af889d7b41b172f1) | 2026-11-06 | Safer settle: save signed batch before broadcast, retry/undo, pick a U | 🕐 in queue |  |  |
| [`0807709`](https://github.com/yordank/BTCNotar/commit/08077096c34a067b62fc1f51a598b62cbc4a8098) | 2026-11-06 | Fix hash case in store, check 64-hex hashes, don't re-queue anchored h | 🕐 in queue |  |  |
| [`ea882e9`](https://github.com/yordank/BTCNotar/commit/ea882e9998a4cd697d714cd6090adceb3aa6355f) | 2026-11-06 | Add next tasks to agents/PLAN.md | 🕐 in queue |  |  |
| [`9f2a184`](https://github.com/yordank/BTCNotar/commit/9f2a18427b916e1f8dc508dff60779e1a6407ec9) | 2026-11-05 | Portable proof files: waitForProof, saveProof, verifyProofFile | 🕐 in queue |  |  |
| [`0f02a8a`](https://github.com/yordank/BTCNotar/commit/0f02a8afa23fb98e73d20a7356e58c6379faf3db) | 2026-10-28 | Merge pull request #12 from yordank/claude/library-home | 🕐 in queue |  |  |
| [`840aff2`](https://github.com/yordank/BTCNotar/commit/840aff2654619dec42587a0b686c77117e7155e9) | 2026-10-28 | Site: library tab first (free), paid single transaction in its own tab | 🕐 in queue |  |  |
| [`d092d7b`](https://github.com/yordank/BTCNotar/commit/d092d7b95cf65df51f2a9f6046cabc236e0f78f0) | 2026-10-25 | Merge pull request #11 from yordank/claude/donate | 🕐 in queue |  |  |
| [`347bb6e`](https://github.com/yordank/BTCNotar/commit/347bb6ec46af237015d4568c542de91c129615b2) | 2026-10-25 | Add Lightning donation address to the site and READMEs; 0.2.2 | 🕐 in queue |  |  |
| [`4881411`](https://github.com/yordank/BTCNotar/commit/4881411f6abad09ff2a106dd970849ae78e8f4b1) | 2026-10-25 | Merge pull request #10 from yordank/claude/npm-readme | 🕐 in queue |  |  |
| [`a5dde03`](https://github.com/yordank/BTCNotar/commit/a5dde03f2ab044dc758ac39df1df640beddc3c7e) | 2026-10-25 | npm README: easy copy-paste examples first; 0.2.1 | 🕐 in queue |  |  |
| [`ff491f9`](https://github.com/yordank/BTCNotar/commit/ff491f9acf53299c1a7e03fa0ae5a9efa2d9781f) | 2026-10-25 | Merge pull request #8 from yordank/claude/railway-config | 🕐 in queue |  |  |
| [`07764db`](https://github.com/yordank/BTCNotar/commit/07764db53ee9b7d95538f468d8b208343f6418ed) | 2026-10-25 | Add railway.json: start the web app with npm start from the repo root | 🕐 in queue |  |  |
| [`aad077e`](https://github.com/yordank/BTCNotar/commit/aad077e544c9d61dd7a4f504bed272c8d08d9c4d) | 2026-10-25 | Merge pull request #7 from yordank/claude/public-client | 🕐 in queue |  |  |
| [`88eba8a`](https://github.com/yordank/BTCNotar/commit/88eba8a46b31487cb6f3d2b67efcaacfa95c2021) | 2026-10-25 | Client and CLI use the public Railway server by default | 🕐 in queue |  |  |
| [`bedefa0`](https://github.com/yordank/BTCNotar/commit/bedefa0a04f3e74ee64a12085965a14cd0127f20) | 2026-10-25 | Free public queue: BTCNotarClient (no key needed), pending status, rat | 🕐 in queue |  |  |
| [`d8f5a3c`](https://github.com/yordank/BTCNotar/commit/d8f5a3c93094ba4b3c92ee84a421941618e96d55) | 2026-10-25 | Merge pull request #6 from yordank/claude/railway-library | 🕐 in queue |  |  |
| [`65de087`](https://github.com/yordank/BTCNotar/commit/65de08758e3dc9a597e25f212ca1a85e6c85c0e3) | 2026-10-25 | Webapp: instant anchor through the btcnotar library; Railway support | — |  |  |
| [`d85e58d`](https://github.com/yordank/BTCNotar/commit/d85e58d460084182a8bf430ced1c4b59a528e3a1) | 2026-10-25 | Merge pull request #5 from yordank/claude/hourly-settle | — |  |  |
| [`8b35594`](https://github.com/yordank/BTCNotar/commit/8b35594a850685a120b85e81dabbdefb709392e2) | 2026-10-25 | Settle when the oldest pending hash is intervalMs old; webapp every 60 | — |  |  |
| [`ff38a9b`](https://github.com/yordank/BTCNotar/commit/ff38a9bff30767ea5a45ef960f3b477c19b53993) | 2026-10-25 | deploy | — |  |  |
| [`437b475`](https://github.com/yordank/BTCNotar/commit/437b475cca68edba5bc75f62c8d738289f3d20d5) | 2026-10-25 | Merge pull request #4 from yordank/claude/admin-key | — |  |  |
| [`feddd3c`](https://github.com/yordank/BTCNotar/commit/feddd3ce78e09a0838c305b49afd447929e845ee) | 2026-10-25 | Webapp: admin key for manual transactions, require paid invoice for /a | — |  |  |
| [`b9d7b04`](https://github.com/yordank/BTCNotar/commit/b9d7b0484960f300c37a17e8d240122a41b03357) | 2026-10-25 | Add tests for MerkleTree and stores | — |  |  |
| [`a4e9623`](https://github.com/yordank/BTCNotar/commit/a4e962373ed60d8271c59cadd95d0a97160eaae8) | 2026-10-25 | deploy | — |  |  |
| [`0cb973e`](https://github.com/yordank/BTCNotar/commit/0cb973e47b5cab906cc1aa32dfe0896005f34ba0) | 2026-10-25 | Merge pull request #2 from yordank/claude/dev-review-agents | — |  |  |
| [`f3499a3`](https://github.com/yordank/BTCNotar/commit/f3499a352e93d1fc2258f3397a11b9dc7aa36308) | 2026-10-25 | Add developer + reviewer agents with shared plan and work log | — |  |  |
| [`7a1dd64`](https://github.com/yordank/BTCNotar/commit/7a1dd648ac57e6e93af4cb3095ff8009bbf6384e) | 2026-09-11 | Merge pull request #1 from yordank/claude/clever-pascal-t118xq | — |  |  |
| [`b9bdde7`](https://github.com/yordank/BTCNotar/commit/b9bdde7ad1ef1e940c3f6ef76cf4fe362717b5f9) | 2026-09-11 | Restructure into an installable npm library with Merkle-batch anchorin | — |  |  |
| [`a2b6b93`](https://github.com/yordank/BTCNotar/commit/a2b6b93b9b756098585cacf5074a35c6de80ced0) | 2026-04-19 | Merge branch 'main' of https://github.com/yordank/TrustedHash | — |  |  |
| [`f8998ba`](https://github.com/yordank/BTCNotar/commit/f8998ba47fb56e51dfef7e075a5d91f1cc10728c) | 2026-04-19 | new logo added | — |  |  |
| [`2289290`](https://github.com/yordank/BTCNotar/commit/22892900a3dadd90d8c06681f51be6a65dc58564) | 2026-04-19 | Add files via upload | — |  |  |
| [`fc22f62`](https://github.com/yordank/BTCNotar/commit/fc22f6200b376d9ec724bd3b5527c8ebbd4bebb8) | 2026-04-19 | Update README.md | — |  |  |
| [`e12077a`](https://github.com/yordank/BTCNotar/commit/e12077a45d03eb9c449d77f9abfe1130b935eeaf) | 2026-04-19 | Update README.md | — |  |  |
| [`37cf63c`](https://github.com/yordank/BTCNotar/commit/37cf63c16fb31744e983245c327b30cb48c96a20) | 2026-04-19 | Update README.md | — |  |  |
| [`65ec10b`](https://github.com/yordank/BTCNotar/commit/65ec10badc7fb58b5582cc11557e96a2652897fc) | 2026-04-19 | Update README.md | — |  |  |
| [`32dadaa`](https://github.com/yordank/BTCNotar/commit/32dadaad65e400fe524260d01374c925cdc5ae3a) | 2026-04-19 | Update README.md | — |  |  |
| [`58144dd`](https://github.com/yordank/BTCNotar/commit/58144dd1f2e06ef0e54145aefadcbef60b0797c4) | 2026-04-19 | Update README.md | — |  |  |
| [`e03d4c2`](https://github.com/yordank/BTCNotar/commit/e03d4c2e8fe6bab4c1200f70538ca5d208dcbc0a) | 2026-04-19 | Update README.md | — |  |  |
| [`938ecf7`](https://github.com/yordank/BTCNotar/commit/938ecf7cda876c7d3ba35027e6d5ebb4d382920e) | 2026-04-19 | Create README.md | — |  |  |
| [`76daf06`](https://github.com/yordank/BTCNotar/commit/76daf061793d8a38ab299971bc8be16169f8ed99) | 2026-04-19 | Initial commit | — |  |  |
| [`0503157`](https://github.com/yordank/BTCNotar/commit/050315717e20232c2c27be4d07c2a039642c87d4) | 2026-04-19 | Initial commit | — |  |  |
