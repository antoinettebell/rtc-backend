// lib/decrypt_bank.js
import crypto from "crypto";

/**
 * Try to decrypt a single value using common patterns.
 * Supports:
 *  - base64 iv:cipher:tag (GCM)
 *  - base64 iv:cipher (CBC)
 * Returns plaintext string or throws on failure.
 */
function tryDecryptValue(ciphertext, secret) {
  if (!ciphertext || typeof ciphertext !== "string") throw new Error("empty ciphertext");

  // helper: try GCM where ciphertext looks like base64(iv):base64(ct):base64(tag)
  const parts = ciphertext.split(/[:|;]/).map(p => p.trim());
  const secretBuf = Buffer.from(secret || "", "utf8");
  // derive key: using SHA-256 of secret (simple KDF) — replace if you use a different KDF
  const key = crypto.createHash("sha256").update(secretBuf).digest();

  // GCM: 3 parts
  if (parts.length === 3) {
    try {
      const iv = Buffer.from(parts[0], "base64");
      const ct = Buffer.from(parts[1], "base64");
      const tag = Buffer.from(parts[2], "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
      return decrypted.toString("utf8");
    } catch (e) {
      // fall through to try other formats
    }
  }

  // CBC: 2 parts (iv:cipher)
  if (parts.length === 2) {
    try {
      const iv = Buffer.from(parts[0], "base64");
      const ct = Buffer.from(parts[1], "base64");
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
      return decrypted.toString("utf8");
    } catch (e) {
      // fall through
    }
  }

  // As a last attempt, try raw base64 ciphertext where IV is prefixed (16 bytes IV + rest)
  try {
    const raw = Buffer.from(ciphertext, "base64");
    if (raw.length > 16) {
      const iv = raw.slice(0, 16);
      const ct = raw.slice(16);
      // attempt GCM
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        // no tag available in this format -> may fail
        const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
        return dec.toString("utf8");
      } catch {}
      // attempt CBC
      try {
        const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
        return dec.toString("utf8");
      } catch {}
    }
  } catch (e) {
    // ignore
  }

  throw new Error("unsupported ciphertext format or wrong key");
}

function maskAcct(acct) {
  if (!acct || acct.length < 4) return acct || "";
  const last4 = acct.slice(-4);
  return "************" + last4;
}

/**
 * decryptBankDoc(encryptedDoc, secret, opts)
 * - encryptedDoc: object from DB (ciphertexts)
 * - secret: string secret/key
 * - opts.forCommit: boolean - when true, return plaintext for posting to BC
 *
 * Returns object with decrypted (or masked) fields.
 */
export async function decryptBankDoc(encryptedDoc = {}, secret = "", opts = {}) {
  const forCommit = Boolean(opts.forCommit);
  try {
    const out = Object.assign({}, encryptedDoc);

    // Try decrypting some known fields if present; otherwise keep original
    const fieldsToTry = ["accountNumber", "routingNumber", "accountHolderName", "bankName", "iban", "swiftCode", "currency"];
    for (const f of fieldsToTry) {
      if (typeof out[f] === "string" && out[f].length > 0) {
        try {
          const plain = tryDecryptValue(out[f], secret);
          out[f] = plain;
        } catch (e) {
          // can't decrypt — keep original ciphertext (but downstream will get masked if not forCommit)
          // console.debug(`decryptBankDoc: couldn't decrypt ${f}: ${e.message}`);
        }
      }
    }

    // sanitize known metadata
    out._id = out._id ?? "";
    out.userId = out.userId ?? "";
    out.__v = out.__v ?? 0;
    out.createdAt = out.createdAt ?? null;
    out.updatedAt = out.updatedAt ?? null;

    // If caller *isn't* committing, mask sensitive fields
    if (!forCommit) {
      out.accountNumber = maskAcct(typeof out.accountNumber === "string" ? out.accountNumber : "");
      // optionally mask other fields
    }

    return out;
  } catch (err) {
    throw new Error("decryptBankDoc failed: " + (err && err.message ? err.message : String(err)));
  }
}
