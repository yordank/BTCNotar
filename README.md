<p align="center">
  <img src="https://img.shields.io/badge/Bitcoin-OP_RETURN-orange" />
  <img src="https://img.shields.io/badge/Lightning-Breez-yellow" />
  <img src="https://img.shields.io/badge/License-MIT-blue" />
</p>

<p align="center">
  <img src="./examples/webapp/public/logo.png" width="100%" />
</p>

<div align="center">
  <h1>🚀 BTCNotar</h1>
  <p><strong>Bitcoin Notarization Library</strong></p>
  <p>Batch document hashes into a <strong>Merkle tree</strong>, anchor the root on Bitcoin via <strong>OP_RETURN</strong> — automatically, once a day — and get back <strong>proofs verifiable against the live chain</strong></p>
</div>

<hr/>

<h2>📦 Repository layout</h2>

<p>This repo is an npm workspace with two packages:</p>

<ul>
  <li><code>packages/btcnotar</code> — the <strong>npm library</strong>. Install it with <code>npm install btcnotar</code>. See its <a href="./packages/btcnotar/README.md">README</a> for the full API.</li>
  <li><code>examples/webapp</code> — a demo <strong>Express app</strong> using the library: a paid single-hash instant anchor (via Lightning), plus the library's automatic daily batch notarization wired up as a set of <code>/api/notary/*</code> endpoints.</li>
</ul>

<hr/>

<h2>🧠 Overview</h2>

<p>
  <strong>BTCNotar</strong> allows anyone to prove that a document existed at a specific moment in time —
  <strong>without uploading the document itself</strong>.
</p>

<p>👉 Only a <strong>hash</strong> (e.g. SHA-256) is ever sent to the library</p>
<p>👉 Hashes are batched into a <strong>Merkle tree</strong>; only the root touches the blockchain</p>
<p>👉 Every hash gets a small proof that is <strong>independently, unambiguously verifiable</strong> against the live chain — down to the transaction id, block and date</p>

<hr/>

<h2>⚙️ How batch notarization works</h2>

<ol>
  <li>📥 App calls <code>notary.addHash(hash)</code> for each document as it comes in</li>
  <li>⏰ Once a day (configurable), the library builds a <strong>Merkle tree</strong> over everything queued</li>
  <li>⛓️ Only the <strong>Merkle root</strong> is written on-chain, in one <code>OP_RETURN</code> transaction</li>
  <li>🧾 Each hash gets an <strong>inclusion proof</strong> + the transaction id</li>
  <li>🔍 <code>notary.verify(hash)</code> recomputes the root from the proof <em>and</em> checks it against the actual on-chain transaction — reporting the block, date and confirmation status</li>
</ol>

<p>👉 This is fully reversible: with only a document's hash and its proof, anyone can prove whether — and exactly when, in which transaction and block — it was anchored, with no need to trust the notary's own records.</p>

<hr/>

<h2>✨ Features</h2>

<ul>
  <li>📚 <strong>Installable library</strong> (<code>npm install btcnotar</code>), usable from any Node.js app</li>
  <li>🌳 <strong>Merkle-tree batching</strong> — unlimited hashes per on-chain transaction</li>
  <li>⏰ <strong>Automatic scheduled settlement</strong> (once a day by default, configurable)</li>
  <li>🔁 <strong>Reversible proofs</strong> — cryptographic + live on-chain verification</li>
  <li>🔌 <strong>Pluggable storage</strong> (in-memory, JSON file, or bring your own DB) and chain provider</li>
  <li>🖥️ <strong>CLI</strong> (<code>btcnotar add/settle/proof/verify</code>)</li>
  <li>⚡ <strong>Demo app</strong>: single-hash instant anchoring paid via Lightning (Breez SDK)</li>
  <li>📡 <strong>Broadcast via mempool.space</strong></li>
  <li>🧾 <strong>No document storage (privacy-first)</strong> — only hashes ever leave your app</li>
</ul>

<hr/>

<h2>🧱 Tech Stack</h2>

<ul>
  <li><strong>Node.js</strong> (library: zero framework dependency)</li>
  <li><strong>bitcoinjs-lib</strong> + <strong>tiny-secp256k1</strong></li>
  <li><strong>mempool.space REST API</strong> (default chain provider)</li>
  <li>Demo app: <strong>Express</strong>, <strong>Breez SDK (Lightning)</strong></li>
</ul>

<hr/>

<h2>🛠️ Setup</h2>

<h3>1. Clone &amp; install (installs both workspaces)</h3>

<pre><code>git clone https://github.com/yordank/BTCNotar.git
cd BTCNotar
npm install</code></pre>

<h3>2. Use the library directly</h3>

<pre><code>npm install btcnotar   # in your own project</code></pre>

<p>See <a href="./packages/btcnotar/README.md">packages/btcnotar/README.md</a> for the full API and examples.</p>

<h3>3. Or run the demo web app</h3>

<pre><code>cp examples/webapp/.env.example examples/webapp/.env
# fill in OPRETURN_WIF_MAINNET, BREEZ_API_KEY, BREEZ_MNEMONIC
npm start</code></pre>

<p>🌐 Open: <code>http://localhost:8787</code></p>

<hr/>

<h2>🔌 Demo app API</h2>

<h3>⚡ Lightning</h3>
<pre><code>POST /api/ln/invoice
GET  /api/ln/status/:checkingId
GET  /api/balance</code></pre>

<h3>⛓️ Instant single-hash anchor (paid)</h3>
<pre><code>POST /api/opreturn          { hashHex }</code></pre>

<h3>🌳 Batch notarization (library-backed, settles automatically once a day)</h3>
<pre><code>POST /api/notary/hash        { hashHex }   — queue a hash
POST /api/notary/settle                    — settle the current batch now
GET  /api/notary/proof/:hash               — fetch the stored proof
GET  /api/notary/verify/:hash              — verify against the live chain</code></pre>

<hr/>

<h2>🔐 Security (IMPORTANT)</h2>

<p>⚠️ Anchoring uses a real Bitcoin private key (WIF), and the demo app additionally uses a Breez (Lightning) mnemonic and API keys.</p>

<p>👉 <strong>Never commit <code>.env</code> to GitHub</strong></p>
<p>👉 If exposed → <strong>rotate immediately</strong></p>
<p>👉 Use only <strong>hot wallets with small amounts</strong></p>

<hr/>

<h2>💡 Use Cases</h2>

<ul>
  <li>📄 Document timestamping</li>
  <li>🧠 Intellectual property protection</li>
  <li>⚖️ Legal proof of existence</li>
  <li>💻 Source code verification</li>
  <li>🧾 Digital evidence anchoring</li>
</ul>

<hr/>

<h2>⚠️ Limitations</h2>

<ul>
  <li>❗ Only a <strong>hash</strong> is stored, never the document</li>
  <li>❗ Verification requires recomputing the hash of the original document</li>
  <li>❗ Bitcoin fees vary; one settlement pays one fee for the whole batch</li>
  <li>❗ Not a legal guarantee by itself (depends on jurisdiction)</li>
</ul>

<hr/>

<h2>🚀 Roadmap</h2>

<h3>✅ Done</h3>
<ul>
  <li>Batch anchoring via Merkle tree — only the root goes on-chain</li>
  <li>Reversible, independently verifiable Merkle proofs</li>
  <li>Automatic scheduled settlement (daily by default)</li>
  <li>Installable library / SDK (<code>btcnotar</code> on npm)</li>
  <li>CLI for add / settle / proof / verify</li>
</ul>

<h3>🔍 Next</h3>
<ul>
  <li>Browser-side proof verification widget</li>
  <li>Pluggable database-backed store (Postgres/SQLite) reference implementation</li>
  <li>Webhooks on settlement</li>
  <li>Docker deployment for the demo app</li>
  <li>Rate limiting / multi-tenant support for the demo app</li>
</ul>

<hr/>

<h2>🧠 Vision</h2>

<blockquote>
  <p><strong>A lightweight, open-source Bitcoin notarization layer</strong></p>
</blockquote>

<p>Not just a website — but:</p>

<ul>
  <li><strong>A library / SDK</strong></li>
  <li><strong>A reference API</strong></li>
  <li><strong>Infrastructure for proof systems</strong></li>
</ul>

<hr/>

<h2>💭 Philosophy</h2>

<ul>
  <li>🔗 <strong>Minimal on-chain data</strong></li>
  <li>🔍 <strong>Maximum verifiability</strong></li>
  <li>🔐 <strong>Privacy-first</strong></li>
  <li>🧩 <strong>Composable &amp; open</strong></li>
</ul>

<hr/>

<h2>📄 License</h2>

<p><strong>MIT</strong></p>

<hr/>

<h2>⚠️ Disclaimer</h2>

<p>This software is provided for <strong>educational purposes</strong>.<br/>
Use at your own risk.</p>

<p>👉 <strong>Always protect your private keys and funds.</strong></p>
