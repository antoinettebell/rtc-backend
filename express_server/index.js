/* index.js - tiny Express server for dry-run decrypt endpoint */
import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";

import { decryptBankDoc } from "./lib/decrypt_bank.js";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

const PORT = process.env.PORT || 3000;

// health
app.get("/health", (req, res) =>
  res.json({ status: "ok", when: new Date().toISOString() })
);

// dry-run decrypt endpoint — reads merged JSON, decrypts one doc, returns a safe preview
app.post("/decrypt-bank-accounts", async (req, res) => {
  console.log("[DEBUG] POST /decrypt-bank-accounts invoked - headers:", Object.keys(req.headers));
  const commit = String(req.query.commit || "false").toLowerCase() === "true";

  try {
    const filePath = path.resolve(
      process.env.SECURE_EXPORTS_PATH || "/home/rtc_backend_prod/secure_exports/bc_ready_json_full.json"
    );

    // read the merged JSON that we produced earlier
    let txt;
    try {
      txt = await fs.readFile(filePath, "utf8");
    } catch (readErr) {
      // fallback: file not found -> return a safe sample response so you can wire flows
      console.warn(`[WARN] could not read ${filePath}: ${readErr.message}`);
      const sample = {
        read: 0,
        decrypted: 0,
        mapped_preview: null,
        commit,
      };
      return res.json(sample);
    }

    const docs = JSON.parse(txt || "[]");
    if (!docs || (Array.isArray(docs) && docs.length === 0)) {
      return res.json({ read: 0, decrypted: 0, mapped_preview: null, commit });
    }

    // pick the first doc for this dry-run (later accept id in req.body)
    const rawDoc = Array.isArray(docs) ? docs[0] : docs;

    // decrypt (stub or real module) — secret pulled from env (or Key Vault in prod)
    const secret = process.env.ENCRYPTION_SECRET_KEY || "";
    const decrypted = await decryptBankDoc(rawDoc, secret, { forCommit: commit });

    // mask account number (keep last 4)
    const acct = decrypted.accountNumber || "";
    const maskedAcct = acct.replace(/\d(?=\d{4})/g, "*");

    const mapped_preview = {
      _id: decrypted._id || "",
      userId: decrypted.userId || "",
      accountHolderName: decrypted.accountHolderName || "",
      accountNumber: maskedAcct,
      routingNumber: decrypted.routingNumber || "",
      currency: decrypted.currency || "",
    };

    return res.json({
      read: Array.isArray(docs) ? docs.length : 1,
      decrypted: 1,
      mapped_preview,
      commit,
    });
  } catch (err) {
    console.error("POST /decrypt-bank-accounts error:", err && (err.stack || err.message || err));
    return res.status(500).json({ success: false, code: 500, data: null });
  }
});

app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || "dev"})`);
});

