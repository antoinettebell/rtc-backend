#!/usr/bin/env python3
import json, os, sys
def load(path):
    if not os.path.exists(path):
        print("MISSING", path); sys.exit(2)
    txt=open(path,'r',encoding='utf-8').read().strip()
    if not txt:
        return []
    j=json.loads(txt)
    return j if isinstance(j,list) else [j]

def unwrap(v):
    if v is None: return None
    if isinstance(v, dict):
        if "$oid" in v: return str(v["$oid"])
        if "$id" in v: return str(v["$id"])
        if "$date" in v:
            inner=v["$date"]
            if isinstance(inner, dict) and "$numberLong" in inner:
                try:
                    ms=int(inner["$numberLong"])
                    import datetime
                    return datetime.datetime.fromtimestamp(ms/1000, tz=datetime.timezone.utc).isoformat().replace("+00:00","Z")
                except:
                    return str(inner)
            return str(inner)
        return json.dumps(v, separators=(",",":"))
    return v

# files
bc_file="exports/bc_ready_json.json"
orig_file="original_doc.json"
out_file="exports/bc_ready_json_full.json"

bc = load(bc_file)
orig = load(orig_file)
if not bc:
    print("No BC records found in", bc_file); sys.exit(3)
# use first orig doc (single-record case)
orig_doc = orig[0] if orig else {}

meta_keys = ["_id","userId","__v","createdAt","updatedAt"]

out=[]
for rec in bc:
    r = dict(rec)
    for k in meta_keys:
        if (k not in r or r.get(k) in (None,"")):
            val = orig_doc.get(k)
            if val is not None:
                r[k] = unwrap(val)
    out.append(r)

with open(out_file,'w',encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print("WROTE", out_file, "rows=", len(out))
# print merged object for quick inspection
try:
    print(json.dumps(out[0], indent=2))
except Exception:
    pass
