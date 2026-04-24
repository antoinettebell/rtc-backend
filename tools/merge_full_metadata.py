#!/usr/bin/env python3
"""
Merge original Mongo doc(s) (original_doc.json) with decrypted JSON (exports/bc_ready_json.json)
Output: exports/bc_ready_json_full.json (list)
Merging rules:
 - Use _id from original_doc as source of truth.
 - If decrypted items include _id that matches original, use that mapping.
 - If only one decrypted item exists and one original exists, merge them.
 - Otherwise, if counts match, pair by index as fallback.
 - Do NOT overwrite metadata keys: _id, userId, createdAt, updatedAt, __v (these are preserved from original)
 - Decrypted fields overwrite or add other keys.
"""
import json, os, sys, copy

merged_out = "exports/bc_ready_json_full.json"
dec_path = "exports/bc_ready_json.json"
orig_path = "original_doc.json"

def load_json_auto(p):
    if not os.path.exists(p):
        return None
    txt = open(p, 'r', encoding='utf-8').read().strip()
    if not txt:
        return None
    j = json.loads(txt)
    return j

def as_list(x):
    if x is None:
        return []
    return x if isinstance(x, list) else [x]

def extract_oid_field(v):
    # handle: {"$oid":"..."} or plain string or ObjectId-like map
    if v is None:
        return None
    if isinstance(v, dict):
        if "$oid" in v:
            return str(v["$oid"])
        # sometimes _id itself is full object; try common keys
        for k in ("id","_id"):
            if k in v and isinstance(v[k], str):
                return v[k]
    if isinstance(v, str):
        return v
    return str(v)

def normalize_id_from_doc(doc):
    # Accept doc where _id may be dict/object
    if not isinstance(doc, dict):
        return None
    if "_id" in doc:
        val = doc["_id"]
        oid = extract_oid_field(val)
        if oid:
            return oid
    # fallback check for id key
    for k in ("id","_id","_id_str"):
        if k in doc:
            oid = extract_oid_field(doc.get(k))
            if oid:
                return oid
    return None

# load
dec = load_json_auto(dec_path)
orig = load_json_auto(orig_path)

if dec is None:
    print("ERROR: missing or empty decrypted file:", dec_path)
    sys.exit(2)
if orig is None:
    print("ERROR: missing or empty original file:", orig_path)
    sys.exit(2)

dec_list = as_list(dec)
orig_list = as_list(orig)

# build index of decrypted items by id if present
dec_by_id = {}
for d in dec_list:
    if isinstance(d, dict):
        candidate = normalize_id_from_doc(d) or (d.get("_id") if isinstance(d.get("_id"), str) else None)
        if candidate:
            dec_by_id[candidate] = d

merged = []
warnings = []

for i, o in enumerate(orig_list):
    oid = normalize_id_from_doc(o) or None
    # find decrypted match
    match = None
    if oid and oid in dec_by_id:
        match = dec_by_id[oid]
    else:
        # try matching by index if counts match
        if len(dec_list) == len(orig_list):
            match = dec_list[i]
        # if only one decrypted available, use it as fallback
        elif len(dec_list) == 1:
            match = dec_list[0]
        else:
            # try matching by a common field like accountHolderName
            found = None
            for d in dec_list:
                # compare accountHolderName or routingNumber heuristics
                if isinstance(d, dict):
                    if "accountHolderName" in d and "accountHolderName" in o and d["accountHolderName"] == o.get("accountHolderName"):
                        found = d
                        break
            if found:
                match = found

    merged_doc = copy.deepcopy(o) if isinstance(o, dict) else {"original": o}
    if match and isinstance(match, dict):
        # preserve metadata keys from original
        preserved = {}
        for k in ("_id","userId","createdAt","updatedAt","__v"):
            if k in merged_doc:
                preserved[k] = merged_doc[k]
        # merge decrypted fields, but do NOT overwrite preserved keys
        for k, v in match.items():
            if k in ("_id","userId","createdAt","updatedAt","__v"):
                continue
            merged_doc[k] = v
        # restore preserved metadata keys to ensure original's values win
        for k, v in preserved.items():
            merged_doc[k] = v
    else:
        warnings.append(f"No decrypted match for original index {i} (oid={oid}). Added original as-is.")
    merged.append(merged_doc)

# write output
os.makedirs(os.path.dirname(merged_out) or ".", exist_ok=True)
with open(merged_out, 'w', encoding='utf-8') as fh:
    json.dump(merged, fh, ensure_ascii=False, indent=2)

print("WROTE", merged_out, os.path.getsize(merged_out), "bytes")
print("orig_count=", len(orig_list), "dec_count=", len(dec_list), "merged_count=", len(merged))
if warnings:
    print("WARNINGS:")
    for w in warnings:
        print(" -", w)
else:
    print("No warnings.")
