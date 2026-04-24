#!/usr/bin/env python3
import json, os, sys

BC_IN = "exports/bc_ready_json.json"    # decrypted export (one-array)
ORIG_IN = "original_doc.json"           # original mongo doc (single or list)
OUT = "exports/bc_ready_json_full.json"

def load_any(path):
    txt = open(path, 'r', encoding='utf-8').read().strip()
    if not txt:
        return []
    j = json.loads(txt)
    return j if isinstance(j, list) else [j]

def oid_of(m):
    # m may be {'$oid':'...'} or just a string
    if not m:
        return None
    if isinstance(m, dict) and '$oid' in m:
        return str(m['$oid'])
    return str(m)

def date_of(d):
    # d may be {'$date':'...'} or {'$date': {'$numberLong':'...'}} or string
    if d is None:
        return None
    if isinstance(d, dict) and '$date' in d:
        inner = d['$date']
        if isinstance(inner, dict) and '$numberLong' in inner:
            try:
                ms = int(inner['$numberLong'])
                import datetime
                return datetime.datetime.utcfromtimestamp(ms/1000.0).isoformat() + "Z"
            except Exception:
                return str(inner)
        return str(inner)
    return str(d)

# load inputs
if not os.path.exists(BC_IN):
    print("ERROR: missing", BC_IN); sys.exit(2)
if not os.path.exists(ORIG_IN):
    print("ERROR: missing", ORIG_IN); sys.exit(2)

bc_list = load_any(BC_IN)
orig_list = load_any(ORIG_IN)

# build lookup by id and by accountNumber (if present)
by_id = {}
by_account = {}
for o in orig_list:
    oid = oid_of(o.get('_id'))
    if oid:
        by_id[oid] = o
    # also map by accountNumber if present in orig (rare)
    an = o.get('accountNumber') or (o.get('bankAccountNumber') or None)
    if an:
        by_account[str(an).strip()] = o

out = []
for bc in bc_list:
    # attempt to find matching original doc
    matched = None
    # try _id in bc first
    bc_id = bc.get('_id') or bc.get('id') or None
    if bc_id:
        bid = oid_of(bc_id)
        matched = by_id.get(bid)
    # fallback: try numeric account number match
    if not matched:
        acct = bc.get('accountNumber') or bc.get('bankAccountNumber') or ''
        acct = str(acct).strip()
        if acct and acct in by_account:
            matched = by_account[acct]
    # fallback: if only one original doc (single) and no match found, use it
    if not matched and len(orig_list) == 1:
        matched = orig_list[0]

    # form merged record: start with bc (decrypted visible fields) then fill missing meta keys from matched orig
    merged = dict(bc)  # decrypted fields take precedence

    if matched:
        # normalized meta fields
        if '_id' in matched:
            merged['_id'] = oid_of(matched.get('_id'))
        if 'userId' in matched:
            merged['userId'] = oid_of(matched.get('userId'))
        if '__v' in matched:
            merged['__v'] = matched.get('__v')
        if 'createdAt' in matched:
            merged['createdAt'] = date_of(matched.get('createdAt'))
        if 'updatedAt' in matched:
            merged['updatedAt'] = date_of(matched.get('updatedAt'))
        # copy any other fields that are present in matched but missing in bc
        for k, v in matched.items():
            if k in ('_id','userId','__v','createdAt','updatedAt'):
                continue
            if k not in merged:
                merged[k] = v
    out.append(merged)

# write output
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, indent=2)

print("WROTE", OUT, "rows=", len(out))
