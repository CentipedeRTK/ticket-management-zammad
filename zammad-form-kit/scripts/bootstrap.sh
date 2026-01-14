#!/bin/sh
set -e

# Outils requis
apk add --no-cache curl jq >/dev/null

AUTH="Authorization: Token token=${ZAMMAD_TOKEN}"
BASE="${ZAMMAD_URL}"

echo "[bootstrap] Vérification du token…"
curl -sf -H "$AUTH" "$BASE/api/v1/users/me" >/dev/null || {
  echo "[bootstrap] ⚠️ Token invalide"
  exit 1
}

# ----- Groupe cible -----
GROUP_NAME="${ZAMMAD_GROUP:-Declarations GNSS}"
echo "[bootstrap] Groupe: $GROUP_NAME"

# encode proprement la query
Q=$(printf '%s' "name:\"$GROUP_NAME\"" | jq -sRr @uri)
EXIST=$(
  curl -s -H "$AUTH" "$BASE/api/v1/groups/search?query=$Q&limit=1" \
  | jq -r '.[0].name // empty'
)

if [ -z "$EXIST" ]; then
  # JSON via jq → zéro souci de quotes
  PAYLOAD=$(jq -n --arg name "$GROUP_NAME" '{name:$name, active:true}')
  curl -sS -H "$AUTH" -H "Content-Type: application/json" \
       -d "$PAYLOAD" "$BASE/api/v1/groups" >/dev/null
  echo "[bootstrap] Groupe créé."
else
  echo "[bootstrap] Groupe déjà présent."
fi

# --- Notification sender via ID (state_current.value) ---
if [ -n "${NOTIFY_SENDER_EMAIL:-}" ] && [ -n "${NOTIFY_SENDER_NAME:-}" ]; then
  echo "[bootstrap] Configuration de l'expéditeur des notifications…"

  # 1) récupérer l'ID de 'notification_sender'
  SID=$(curl -sS -H "$AUTH" "$BASE/api/v1/settings?per_page=1000" \
        | tr -d '\n' \
        | sed 's/},{/}\n{/g' \
        | awk '/"name":"notification_sender"/{print}' \
        | sed -n 's/.*"id":\([0-9]\+\).*/\1/p')

  if [ -n "$SID" ]; then
    SENDER_FMT=$(printf '%s <%s>' "$NOTIFY_SENDER_NAME" "$NOTIFY_SENDER_EMAIL")
    SENDER_ESC=$(printf '%s' "$SENDER_FMT" | sed 's/"/\\"/g')

    # 2) écrire dans state_current.value
    curl -sS -H "$AUTH" -H "Content-Type: application/json" \
         -X PUT "$BASE/api/v1/settings/${SID}" \
         --data-binary "{\"state_current\":{\"value\":\"$SENDER_ESC\"}}" >/dev/null

    # 3) contrôle
    CUR=$(curl -sS -H "$AUTH" "$BASE/api/v1/settings/${SID}" \
           | sed -n 's/.*"state_current":{[^}]*"value":"\([^"]*\)".*/\1/p')
    echo "[bootstrap] -> notification_sender = ${CUR:-null}"
  else
    echo "[bootstrap] ⚠️ Impossible de trouver l'ID de notification_sender"
  fi
else
  echo "[bootstrap] (skip) NOTIFY_SENDER_EMAIL/NAME non définis"
fi

# Create common attributes used by the form
echo "[bootstrap] Attributs personnalisés…"
ATTRS='
mount_point|Point de montage|200
country_alpha3|Pays ISO-3166 alpha-3|3
latitude|Latitude (dd)|64
longitude|Longitude (dd)|64
elevation_m|Élévation (m)|64
epoch|Époque|64
e_n|Erreur N (mm)|64
e_e|Erreur E (mm)|64
e_h|Erreur H (mm)|64
receiver|Récepteur|255
antenna|Antenne|255
profession|Profession|255
notes|Notes|5000
'

# Fetch existing
EXISTING=$(curl -sS -H "$AUTH" "$BASE/api/v1/object_manager_attributes" | jq -r '.[] | select(.object=="Ticket") | .name')

need_create() { echo "$EXISTING" | grep -qx "$1" && return 1 || return 0; }

POS=1200
echo "$ATTRS" | while IFS='|' read -r NAME DISPLAY MAXL; do
  [ -z "$NAME" ] && continue
  if need_create "$NAME"; then
    echo " - $NAME"
    PAYLOAD=$(jq -n --arg name "$NAME" --arg display "$DISPLAY" --argjson position "$POS" --argjson maxlength "$MAXL" '{
      name:$name, object:"Ticket", display:$display, active:true, position:$position,
      data_type:"input", data_option:{ type:"text", maxlength:$maxlength, translate:false },
      screens:{
        create_middle:{ "ticket.customer":{ shown:true, required:false, item_class:"column" }, "ticket.agent":{ shown:true, required:false, item_class:"column" } },
        edit:{ "ticket.agent":{ shown:true, required:false } }
      }
    }')
    curl -sS -H "$AUTH" -H "Content-Type: application/json" -d "$PAYLOAD" "$BASE/api/v1/object_manager_attributes" >/dev/null
    POS=$((POS+10))
  else
    echo " - $NAME (existe)"
  fi
done

echo "[bootstrap] Migrations…"
curl -sS -X POST -H "$AUTH" "$BASE/api/v1/object_manager_attributes_execute_migrations" >/dev/null || true
echo "[bootstrap] ✅ Terminé."
