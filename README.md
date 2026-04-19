🚀 ProofOfExistence

Bitcoin Proof of Existence service
Timestamp file hashes on the Bitcoin blockchain using OP_RETURN + Lightning payments

🧠 Overview

ProofOfExistence allows anyone to prove that a file existed at a specific moment in time —
without uploading the file itself.

👉 Only a SHA-256 hash is stored on Bitcoin
👉 The proof is permanent, verifiable, and tamper-proof

⚙️ How It Works
📂 User selects a file
🔐 File is hashed (SHA-256)
⚡ Lightning invoice is generated
💰 After payment → hash is written to Bitcoin (OP_RETURN)
🧾 Transaction ID is returned as proof

👉 Later: recompute hash → compare → proof verified

✨ Features
🔐 SHA-256 file hashing
⛓️ Bitcoin OP_RETURN anchoring
⚡ Lightning payments (Breez SDK)
🔍 Payment status tracking
📡 Broadcast via mempool.space
🧾 No file storage (privacy-first)
🌐 Simple web interface
🧱 Tech Stack
Node.js + Express
bitcoinjs-lib
tiny-secp256k1
Breez SDK (Lightning)
Axios
HTML / CSS / JS
🛠️ Setup
1. Clone

git clone https://github.com/your-username/proofOfExistence.git

cd proofOfExistence

2. Install

npm install

3. Create .env

OPRETURN_WIF_MAINNET=your_mainnet_wif
BREEZ_API_KEY=your_breez_api_key
BREEZ_MNEMONIC=your_breez_mnemonic

▶️ Run

node server.js

🌐 Open:
http://localhost:8787

🔌 API
⚡ Create Lightning Invoice

POST /api/ln/invoice

🔍 Check Payment Status

GET /api/ln/status/:checkingId

⛓️ Anchor Hash (OP_RETURN)

POST /api/opreturn

💰 Get Balance

GET /api/balance

🔐 Security (IMPORTANT)

⚠️ This project uses:

Bitcoin private key (WIF)
Breez mnemonic (seed)
API keys

👉 Never commit .env to GitHub
👉 If exposed → rotate immediately
👉 Use only hot wallets with small amounts

💡 Use Cases
📄 Document timestamping
🧠 Intellectual property protection
⚖️ Legal proof of existence
💻 Source code verification
🧾 Digital evidence anchoring
⚠️ Limitations
❗ Only hash is stored, not the file
❗ Verification requires original file
❗ Bitcoin fees may vary
❗ Not a legal guarantee (depends on jurisdiction)
🚀 Roadmap
📦 Batch Anchoring (KEY FEATURE)
Combine multiple hashes in one transaction
Use Merkle Tree
Store only Merkle Root on-chain
Return Merkle Proof to users

👉 Result:

💸 Lower fees
⚡ Better scalability
🆓 Enables free usage
🆓 Free Tier
Free delayed anchoring (batched)
Paid instant anchoring
Queue system (10–30 min batching)
📚 Library / SDK

Turn into reusable package:

Easy integration in any app
Simple API
Developer-first design
🔍 Verification Tools
Proof verification endpoint
CLI tool
Browser verification
Merkle proof validation
⚙️ Advanced
Testnet support
Docker deployment
Webhooks
Rate limiting
Multi-user support
🧠 Vision

A lightweight, open-source Bitcoin notarization layer

Not just a website — but:

API
SDK
Infrastructure for proof systems
💭 Philosophy
🔗 Minimal on-chain data
🔍 Maximum verifiability
🔐 Privacy-first
🧩 Composable & open
📄 License

MIT

⚠️ Disclaimer

This software is provided for educational purposes.
Use at your own risk.

👉 Always protect your private keys and funds.
