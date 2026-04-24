#!/usr/bin/env python3
import sys, json, csv, io
if len(sys.argv) < 3:
    print("Usage: json_to_bc_csv_fixed.py input.json output.csv"); sys.exit(2)
infile, outfile = sys.argv[1], sys.argv[2]
mapping = {
  "accountHolderName":"AccountHolderName",
  "accountNumber":"BankAccountNumber",
  "accountType":"AccountType",
  "bankName":"BankName",
  "iban":"IBAN",
  "routingNumber":"RoutingNumber",
  "swiftCode":"SWIFTCode",
  "currency":"Currency",
  "paymentMethod":"PaymentMethod",
  "remittanceEmail":"RemittanceEmail"
}
headers = ["VendorNo","VendorExternalId","AccountHolderName","BankAccountNumber","AccountType",
           "BankName","IBAN","RoutingNumber","SWIFTCode","Currency","PaymentMethod","RemittanceEmail","Notes"]
with open(infile,'r',encoding='utf-8') as f:
    txt=f.read().strip()
    if not txt:
        arr=[]
    else:
        data=json.loads(txt) if not txt.startswith('[') else json.loads(txt)
        arr=data if isinstance(data,list) else [data]
rows=[]
for obj in arr:
    src = obj.get("decrypted", obj if isinstance(obj,dict) else {})
    row={h:"" for h in headers}
    for j,k in mapping.items():
        v = src.get(j)
        if v is None:
            # case-insensitive fallback
            for kk in src:
                if kk.lower()==j.lower() and src[kk] is not None:
                    v=src[kk]; break
        if v is not None:
            row[k]=str(v)
    rows.append(row)
with open(outfile,'wb') as f:
    f.write(b'\\xEF\\xBB\\xBF')
    t=io.TextIOWrapper(f,encoding='utf-8',newline='')
    w=csv.DictWriter(t,fieldnames=headers)
    w.writeheader()
    for r in rows: w.writerow(r)
    t.flush()
print("WROTE", outfile, "rows=", len(rows))
