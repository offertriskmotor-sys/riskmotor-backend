#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${ENDPOINT:-https://riskmotor-backend.vercel.app/api/preview}"
HDR="${HDR:-Content-Type: application/json}"

tests=(
'{"jobbtyp":"Service","ortzon":"Mellanstor","rot":"JA","antal_anstallda":1,"prismodell":"LÖPANDE","timmar":4,"timpris":750,"ue_kostnad":0,"materialkostnad":1200,"justering":0}'
'{"jobbtyp":"Service","ortzon":"Mellanstor","rot":"JA","antal_anstallda":1,"prismodell":"LÖPANDE","timmar":0,"timpris":850,"ue_kostnad":0,"materialkostnad":1500,"justering":0}'
'{"jobbtyp":"Service","ortzon":"Storstad","rot":"NEJ","antal_anstallda":2,"prismodell":"LÖPANDE","timmar":8,"timpris":300,"ue_kostnad":0,"materialkostnad":2000,"justering":0}'
'{"jobbtyp":"Service","ortzon":"Storstad","rot":"NEJ","antal_anstallda":2,"prismodell":"LÖPANDE","timmar":6,"timpris":1600,"ue_kostnad":0,"materialkostnad":3000,"justering":0}'
'{"jobbtyp":"Renovering","ortzon":"Mellanstor","rot":"JA","antal_anstallda":4,"prismodell":"LÖPANDE","timmar":180,"timpris":680,"ue_kostnad":0,"materialkostnad":85000,"justering":0}'
'{"jobbtyp":"Renovering","ortzon":"Mellanstor","rot":"JA","antal_anstallda":4,"prismodell":"LÖPANDE","timmar":200,"timpris":580,"ue_kostnad":0,"materialkostnad":90000,"justering":0}'
'{"jobbtyp":"Renovering","ortzon":"Mellanstor","rot":"JA","antal_anstallda":5,"prismodell":"LÖPANDE","timmar":160,"timpris":690,"ue_kostnad":800000,"materialkostnad":90000,"justering":0}'
'{"jobbtyp":"Renovering","ortzon":"Mellanstor","rot":"JA","antal_anstallda":5,"prismodell":"LÖPANDE","timmar":160,"timpris":690,"ue_kostnad":150000,"materialkostnad":90000,"justering":0}'
'{"jobbtyp":"Renovering","ortzon":"Storstad","rot":"JA","antal_anstallda":8,"prismodell":"LÖPANDE","timmar":300,"timpris":750,"ue_kostnad":0,"materialkostnad":450000,"justering":0}'
'{"jobbtyp":"Nybyggnation","ortzon":"Mellanstor","rot":"NEJ","antal_anstallda":10,"prismodell":"LÖPANDE","timmar":2000,"timpris":420,"ue_kostnad":500000,"materialkostnad":1200000,"justering":0}'
'{"jobbtyp":"Nybyggnation","ortzon":"Mellanstor","rot":"NEJ","antal_anstallda":10,"prismodell":"LÖPANDE","timmar":2000,"timpris":750,"ue_kostnad":500000,"materialkostnad":1200000,"justering":0}'
'{"jobbtyp":"Nybyggnation","ortzon":"Turistort","rot":"NEJ","antal_anstallda":12,"prismodell":"FAST","fastpris":4200000,"timmar":0,"timpris":0,"ue_kostnad":900000,"materialkostnad":1600000,"justering":0}'
'{"jobbtyp":"Nybyggnation","ortzon":"Turistort","rot":"NEJ","antal_anstallda":12,"prismodell":"FAST","fastpris":2800000,"timmar":0,"timpris":0,"ue_kostnad":900000,"materialkostnad":1600000,"justering":0}'
'{"jobbtyp":"Tillbyggnad","ortzon":"Mellanstor","rot":"JA","antal_anstallda":3,"prismodell":"FAST","fastpris":260000,"timmar":0,"timpris":0,"ue_kostnad":20000,"materialkostnad":120000,"justering":0}'
'{"jobbtyp":"Tillbyggnad","ortzon":"Mellanstor","rot":"JA","antal_anstallda":4,"prismodell":"FAST","fastpris":600000,"timmar":0,"timpris":0,"ue_kostnad":520000,"materialkostnad":40000,"justering":0}'
'{"jobbtyp":"Service","ortzon":"Mellanstor","rot":"NEJ","antal_anstallda":1,"prismodell":"LÖPANDE","timmar":1,"timpris":300,"ue_kostnad":0,"materialkostnad":0,"justering":0}'
'{"jobbtyp":"Service","ortzon":"Mellanstor","rot":"NEJ","antal_anstallda":1,"prismodell":"LÖPANDE","timmar":1,"timpris":1800,"ue_kostnad":0,"materialkostnad":0,"justering":0}'
'{"jobbtyp":"Renovering","ortzon":"Storstad","rot":"NEJ","antal_anstallda":50,"prismodell":"LÖPANDE","timmar":240,"timpris":720,"ue_kostnad":80000,"materialkostnad":180000,"justering":0}'
'{"jobbtyp":"Renovering","ortzon":"Storstad","rot":"NEJ","antal_anstallda":50,"prismodell":"LÖPANDE","timmar":240,"timpris":820,"ue_kostnad":80000,"materialkostnad":180000,"justering":0}'
'{"jobbtyp":"Service","ortzon":"Turistort","rot":"JA","antal_anstallda":2,"prismodell":"LÖPANDE","timmar":10,"timpris":900,"ue_kostnad":0,"materialkostnad":45000,"justering":0}'
)

i=1
for body in "${tests[@]}"; do
  echo "=== TEST #$i ==="
  echo "[req] $body"

  resp="$(curl -sS "$ENDPOINT" -H "$HDR" -d "$body" -w "\n__HTTP__:%{http_code} __TIME__:%{time_total}\n")"
  http="$(printf "%s" "$resp" | sed -n 's/.*__HTTP__:\([0-9][0-9][0-9]\).*/\1/p')"
  time="$(printf "%s" "$resp" | sed -n 's/.*__TIME__:\([0-9.]*\).*/\1/p')"
  json="$(printf "%s" "$resp" | sed '/__HTTP__:/d')"

  echo "[meta] http=$http time_total=${time}s"

  # 1) RAW (första raden av JSON)
  echo "[raw_head]"
  printf "%s" "$json" | head -c 220; echo

  # 2) Summary
  echo "[summary]"
  printf "%s" "$json" | python - <<'PY'
import json,sys
raw=sys.stdin.read()
d=json.loads(raw)
keys=["risk_driver","lock_reason","risk_class","decision","locked","ue_risk_level","price_driver","price_risk_score","ue_risk_score"]
print({k:d.get(k) for k in keys})
PY

  echo
  i=$((i+1))
done
