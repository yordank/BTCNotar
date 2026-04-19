ProofOfExistence or TrustedHash

A simple Bitcoin Proof of Existence service that allows users to timestamp file hashes on the Bitcoin blockchain using OP_RETURN, with Lightning payments powered by Breez SDK.

Overview

ProofOfExistence enables anyone to prove that a file existed at a specific point in time without uploading the actual file.

The system works by anchoring a SHA-256 hash of the file into the Bitcoin blockchain. This creates a permanent, verifiable, and tamper-proof record.

How It Works
User selects a file
File is hashed (SHA-256)
A Lightning invoice is generated
After payment, the hash is embedded in a Bitcoin transaction (OP_RETURN)
The transaction ID is returned as proof

Later, anyone can verify the file by recomputing its hash and comparing it with the on-chain data.

Features
SHA-256 file hashing
Bitcoin OP_RETURN anchoring
Lightning payments (Breez SDK)
Payment status tracking
Transaction broadcasting via mempool.space
Simple web interface
No file storage (privacy-first)
Tech Stack
Node.js
Express
bitcoinjs-lib
tiny-secp256k1
ecpair
Breez SDK (Spark)
Axios
HTML / CSS / JavaScript
Setup
Clone the repository
git clone https://github.com/yordank/TrustedHash.git

cd proofOfExistence
Install dependencies
npm install
Create a .env file in the root directory with the following variables:

OPRETURN_WIF_MAINNET=your_mainnet_wif
BREEZ_API_KEY=your_breez_api_key
BREEZ_MNEMONIC=your_breez_mnemonic

Run

node server.js

App runs at:
http://localhost:8787

API Endpoints

Create Lightning invoice
POST /api/ln/invoice

Check payment status
GET /api/ln/status/:checkingId

Broadcast hash
POST /api/opreturn

Get balance
GET /api/balance

Security Notes

This project uses sensitive credentials such as Bitcoin private keys, Breez mnemonic, and API keys.

Never commit your .env file to GitHub.
Always rotate keys if they are exposed.
Do not use wallets with real funds in development.

Use Cases
Document timestamping
Intellectual property protection
Proof of existence
Legal evidence anchoring
Source code verification
Limitations
Only the hash is stored, not the file
Verification requires the original file
Bitcoin fees may vary
Not a legal guarantee
Roadmap

Batch Anchoring

Group multiple hashes into one transaction
Use Merkle Tree
Store only the Merkle Root on-chain
Return Merkle Proof to users

Free Tier

Free delayed anchoring
Paid instant anchoring

Library / SDK

Make the project embeddable
Provide simple API for developers

Verification Tools

Proof validation endpoint
CLI tool
Browser verification

Advanced

Testnet support
Docker deployment
Webhooks
Rate limiting
Vision

A lightweight, open-source Bitcoin notarization layer that developers can integrate into any application.

License

MIT

Disclaimer

This software is provided for educational purposes.
Use at your own risk. Always secure your private keys.
