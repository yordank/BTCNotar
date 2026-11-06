import crypto from "node:crypto";
import fs from "node:fs";

/** SHA-256 of a string (UTF-8) or Buffer, as hex. */
export function sha256Hex(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}

/** SHA-256 of a file, read as a stream (works for big files). Returns hex. */
export function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash("sha256");
        fs.createReadStream(filePath)
            .on("error", reject)
            .on("data", (chunk) => h.update(chunk))
            .on("end", () => resolve(h.digest("hex")));
    });
}
