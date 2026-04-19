<div align="center">
  <h1>🚀 BTCNotar</h1>
  <p><strong>Bitcoin Notarization Service</strong></p>
  <p>Timestamp file hashes on the Bitcoin blockchain using <strong>OP_RETURN</strong> + <strong>Lightning payments</strong></p>
</div>

<hr/>

<h2>🧠 Overview</h2>

<p>
  <strong>BTCNotar</strong> allows anyone to prove that a file existed at a specific moment in time —
  <strong>without uploading the file itself</strong>.
</p>

<p>👉 Only a <strong>SHA-256 hash</strong> is stored on Bitcoin</p>
<p>👉 The proof is <strong>permanent, verifiable, and tamper-proof</strong></p>

<hr/>

<h2>⚙️ How It Works</h2>

<ol>
  <li>📂 User selects a file</li>
  <li>🔐 File is hashed (<strong>SHA-256</strong>)</li>
  <li>⚡ Lightning invoice is generated</li>
  <li>💰 After payment → hash is written to Bitcoin (<code>OP_RETURN</code>)</li>
  <li>🧾 Transaction ID is returned as proof</li>
</ol>

<p>👉 Later: recompute hash → compare → <strong>proof verified</strong></p>

<hr/>

<h2>✨ Features</h2>

<ul>
  <li>🔐 <strong>SHA-256 file hashing</strong></li>
  <li>⛓️ <strong>Bitcoin OP_RETURN anchoring</strong></li>
  <li>⚡ <strong>Lightning payments (Breez SDK)</strong></li>
  <li>🔍 <strong>Payment status tracking</strong></li>
  <li>📡 <strong>Broadcast via mempool.space</strong></li>
  <li>🧾 <strong>No file storage (privacy-first)</strong></li>
  <li>🌐 <strong>Simple web interface</strong></li>
</ul>

<hr/>

<h2>🧱 Tech Stack</h2>

<ul>
  <li><strong>Node.js + Express</strong></li>
  <li><strong>bitcoinjs-lib</strong></li>
  <li><strong>tiny-secp256k1</strong></li>
  <li><strong>Breez SDK (Lightning)</strong></li>
  <li><strong>Axios</strong></li>
  <li><strong>HTML / CSS / JavaScript</strong></li>
</ul>

<hr/>

<h2>🛠️ Setup</h2>

<h3>1. Clone</h3>

<pre><code>git clone https://github.com/yordank/BTCNotar.git
cd BTCNotar</code></pre>

<h3>2. Install</h3>

<pre><code>npm install</code></pre>

<h3>3. Create <code>.env</code></h3>

<pre><code>OPRETURN_WIF_MAINNET=your_mainnet_wif
BREEZ_API_KEY=your_breez_api_key
BREEZ_MNEMONIC=your_breez_mnemonic</code></pre>

<hr/>

<h2>▶️ Run</h2>

<pre><code>node server.js</code></pre>

<p>🌐 Open:<br/>
<code>http://localhost:8787</code></p>

<hr/>

<h2>🔌 API</h2>

<h3>⚡ Create Lightning Invoice</h3>
<pre><code>POST /api/ln/invoice</code></pre>

<h3>🔍 Check Payment Status</h3>
<pre><code>GET /api/ln/status/:checkingId</code></pre>

<h3>⛓️ Anchor Hash (OP_RETURN)</h3>
<pre><code>POST /api/opreturn</code></pre>

<h3>💰 Get Balance</h3>
<pre><code>GET /api/balance</code></pre>

<hr/>

<h2>🔐 Security (IMPORTANT)</h2>

<p>⚠️ This project uses:</p>

<ul>
  <li><strong>Bitcoin private key (WIF)</strong></li>
  <li><strong>Breez mnemonic (seed)</strong></li>
  <li><strong>API keys</strong></li>
</ul>

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
  <li>❗ Only <strong>hash</strong> is stored, not the file</li>
  <li>❗ Verification requires the original file</li>
  <li>❗ Bitcoin fees may vary</li>
  <li>❗ Not a legal guarantee (depends on jurisdiction)</li>
</ul>

<hr/>

<h2>🚀 Roadmap</h2>

<h3>📦 Batch Anchoring (KEY FEATURE)</h3>

<ul>
  <li>Combine multiple hashes in one transaction</li>
  <li>Use <strong>Merkle Tree</strong></li>
  <li>Store only <strong>Merkle Root</strong> on-chain</li>
  <li>Return <strong>Merkle Proof</strong> to users</li>
</ul>

<p>👉 Result:</p>

<ul>
  <li>💸 <strong>Lower fees</strong></li>
  <li>⚡ <strong>Better scalability</strong></li>
  <li>🆓 <strong>Enables free usage</strong></li>
</ul>

<h3>🆓 Free Tier</h3>

<ul>
  <li>Free delayed anchoring (batched)</li>
  <li>Paid instant anchoring</li>
  <li>Queue system (10–30 min batching)</li>
</ul>

<h3>📚 Library / SDK</h3>

<p>Turn the project into a reusable package:</p>

<ul>
  <li>Easy integration in any app</li>
  <li>Simple API</li>
  <li>Developer-first design</li>
</ul>

<h3>🔍 Verification Tools</h3>

<ul>
  <li>Proof verification endpoint</li>
  <li>CLI tool</li>
  <li>Browser verification</li>
  <li>Merkle proof validation</li>
</ul>

<h3>⚙️ Advanced</h3>

<ul>
  <li>Testnet support</li>
  <li>Docker deployment</li>
  <li>Webhooks</li>
  <li>Rate limiting</li>
  <li>Multi-user support</li>
</ul>

<hr/>

<h2>🧠 Vision</h2>

<blockquote>
  <p><strong>A lightweight, open-source Bitcoin notarization layer</strong></p>
</blockquote>

<p>Not just a website — but:</p>

<ul>
  <li><strong>API</strong></li>
  <li><strong>SDK</strong></li>
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
