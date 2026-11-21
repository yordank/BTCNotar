# Commits notarized on Bitcoin

Every commit of this repository is anchored on the Bitcoin blockchain with [btcnotar](https://btcnotar.com).

**0** commits · **0** in a Bitcoin block · **0** Bitcoin transactions · updated 2026-11-21 15:54 UTC

## How to check a commit yourself

```bash
git cat-file commit <sha> > commit.bin          # the raw commit object
npx btcnotar verify-file <sha>.btcnotar.json --doc commit.bin
```

The proof is checked against the Bitcoin blockchain only — not against btcnotar.com.
The commit object contains the tree, the parents, the author and the message, so the proof covers the whole history up to that commit.

| commit | date | message | status | Bitcoin tx | proof |
|---|---|---|---|---|---|
