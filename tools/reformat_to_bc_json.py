#!/usr/bin/env python3
import sys, json
from datetime import datetime, timezone

def iso_z(v):
    if not v: return None
    if isinstance(v, dict) and "$date" in v:
        inner = v["$date"]
        try:
            if isinstance(inner, dict) and "$numberLong" in inner:
                ms = int(inner["$numberLong"])
                return datetime.fromtimestamp(ms/1000, tz=timezone.utc).isoformat().replace("+00:00","Z")
            return iso_z(inner)
        except:
            return None
    if isinstance(v, (int,float)):
        sec = v/1000.0 if v>10_000_000_000 else v
        try:
            return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat().replace("+00:00","Z")
        except:
            return None
    if isinstance(v, str):
        s=v.strip()
        if not s: return None
        try:
            if s.endswith("Z"): s=s.replace("Z","+00:00")
            dt = datetime.fromisoformat(s)
            return dt.astimezone(timezone.utc).isoformat().replace("+00:00","Z")
        except:
            return s
    return str(v)

def extract_oid(v):
    if v is None: return None
    if isinstance(v, dict):
        if "$oid" in v: return str(v["$oid"])
        if "$id" in v: return str(v["$id"])
    return str(v)

def choose(src, *keys):
    for k in keys:
        if k in src and src[k] not in (None, ""):
            return src[k]
    return None

def normalize_bank(bank, vendor=None):
    src = bank or {}
    out = {}
    out["_id"] = extract_oid(src.get("_id"))
    if "__v" in src: out["__v"] = src.get("__v")
    out["accountHolderName"] = choose(src, "accountHolderName") or (vendor.get("name") if vendor else None)
    out["accountNumber"] = choose(src, "accountNumber")
    out["accountType"] = choose(src, "accountType")
    out["bankName"] = choose(src, "bankName")
    ca = choose(src, "createdAt")
    if ca: out["createdAt"] = iso_z(ca)
    curr = choose(src, "currency", "currencyCode") or "USD"
    out["currency"] = curr
    out["iban"] = choose(src, "iban")
    out["paymentMethod"] = choose(src, "paymentMethod") or "ACH"
    out["remittanceEmail"] = choose(src, "remittanceEmail") or (vendor.get("email") if vendor else None)
    out["routingNumber"] = choose(src, "routingNumber", "transitNumber", "transitNo")
    out["swiftCode"] = choose(src, "swiftCode", "swift")
    ua = choose(src, "updatedAt")
    if ua: out["updatedAt"] = iso_z(ua)
    out["userId"] = extract_oid(src.get("userId") or src.get("user_id") or (vendor.get("_id") if vendor else None))
    return {k:v for k,v in out.items() if v not in (None,"")}

def main(inp, outp):
    txt = open(inp,'r',encoding='utf-8').read().strip()
    if not txt:
        print("empty input"); sys.exit(1)
    data = json.loads(txt)
    docs = data if isinstance(data, list) else [data]
    results=[]
    for d in docs:
        bank = d.get("decrypted") if isinstance(d, dict) and "decrypted" in d else d
        vendor = d.get("vendor") or {}
        results.append(normalize_bank(bank, vendor))
    with open(outp,'w',encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("WROTE", outp, "rows=", len(results))

if __name__ == "__main__":
    if len(sys.argv)<3:
        print("Usage: reformat_to_bc_json.py input.json output.json"); sys.exit(2)
    main(sys.argv[1], sys.argv[2])
