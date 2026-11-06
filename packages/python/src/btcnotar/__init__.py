"""btcnotar — prove that a text or a file existed at a certain time, using Bitcoin.

    from btcnotar import BTCNotarClient, sha256_hex
    client = BTCNotarClient()
    client.submit(sha256_hex("Hello, Bitcoin!"))
"""

from .client import DEFAULT_SERVER_URL, BTCNotarClient
from .core import (
    MAGIC,
    OP_RETURN_MAX_BYTES,
    MerkleTree,
    build_op_return_script,
    check_hash,
    decode_op_return_payload,
    encode_op_return_payload,
    extract_op_return_data,
    script_pushes,
    sha256_file,
    sha256_hex,
    verify_proof,
)
from .net import HTTPError, MempoolProvider
from .prooffile import (
    PROOF_FORMAT,
    PROOF_VERSION,
    check_proof_file,
    read_proof_file,
    to_proof_file,
    verify_proof_file,
    write_proof_file,
)

__version__ = "0.1.0"

__all__ = [
    "BTCNotarClient",
    "DEFAULT_SERVER_URL",
    "HTTPError",
    "MAGIC",
    "MempoolProvider",
    "MerkleTree",
    "OP_RETURN_MAX_BYTES",
    "PROOF_FORMAT",
    "PROOF_VERSION",
    "build_op_return_script",
    "check_hash",
    "check_proof_file",
    "decode_op_return_payload",
    "encode_op_return_payload",
    "extract_op_return_data",
    "read_proof_file",
    "script_pushes",
    "sha256_file",
    "sha256_hex",
    "to_proof_file",
    "verify_proof",
    "verify_proof_file",
    "write_proof_file",
]
