#!/usr/bin/env python3
import json,sys,os
orig_path="original_doc.json"
bc_path="exports/bc_ready_json.json"
out_path="exports/bc_ready_json_full.json"
if not os.path.exists(bc_path):
    print("Missing", bc_path); sys.exit(2)
orig = {}
if os.path.exists(orig_path):
    try:
        o=json.load(open(orig_path,'r',encoding='utf-8'))
        orig = o if isinstance(o, dict) else (o[0] if isinstance(o,list) and o else {})
    except Exception as e:
        print("Failed reading",orig_path, e); sys.exit(3)
bc = json.load(open(bc_path,'r',encoding='utf-8'))
meta_keys = ["_id","userId","__v","createdAt","updatedAt"]
out=[]
for rec in (bc if isinstance(bc,list) else [bc]):
    r = dict(rec)
    for k in meta_keys:
        v = orig.get(k)
        if v not in (None, ""):
            r[k] = v
    out.append(r)
json.dump(out, open(out_path,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print("WROTE", out_path, "rows=", len(out))
