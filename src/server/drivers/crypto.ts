import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "@/server/config";

// AES-256-GCM for API keys at rest. Key: APP_SECRET env, else a random
// secret generated once into DATA_DIR/secret.key.
//
//   stored = base64(iv[12] | tag[16] | ciphertext)

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SECRET_BYTES = 32;
const SECRET_FILE = "secret.key";
const OWNER_ONLY = 0o600;

let key: Buffer | undefined;

function secretKey(): Buffer {
  if (key) {
    return key;
  }

  const secret = process.env.APP_SECRET ?? fileSecret();
  key = crypto.createHash("sha256").update(secret).digest();
  return key;
}

function fileSecret(): string {
  const file = path.join(config.dataDir, SECRET_FILE);
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8");
  }

  fs.mkdirSync(config.dataDir, { recursive: true });
  const secret = crypto.randomBytes(SECRET_BYTES).toString("hex");
  fs.writeFileSync(file, secret, { mode: OWNER_ONLY });
  return secret;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decrypt(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
