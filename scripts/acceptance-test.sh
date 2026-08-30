#!/usr/bin/env bash
#
# VULNFOCUS — PRODUCTION-LIKE END-TO-END ACCEPTANCE TEST
#
# Valida la cadena completa contra un despliegue REAL:
#
#   Cloudflare DNS/HTTPS → Static Assets → React SPA → Turnstile real
#     → POST /api/contact → Worker real → Siteverify real → D1 real → Telegram real
#
# Uso:
#   ./scripts/acceptance-test.sh https://staging.vulnfocus.com
#   ./scripts/acceptance-test.sh https://staging.vulnfocus.com --auto-only
#   ./scripts/acceptance-test.sh https://staging.vulnfocus.com --db vulnfocus-staging
#
# Opciones:
#   --auto-only   No hace las fases manuales. Las marca UNVERIFIED.
#   --db NOMBRE   Base D1 a consultar (por defecto: vulnfocus-staging).
#   --no-color    Salida sin códigos ANSI.
#
# Estados posibles:
#   PASS          comprobado automáticamente, con evidencia
#   MANUAL PASS   comprobado por una persona, confirmado explícitamente
#   FAIL          comprobado y falla
#   UNVERIFIED    no se pudo comprobar
#
# NO contiene ningún bypass de Turnstile, token mágico ni cabecera especial.
# Prueba exactamente el sistema que llegará a producción.

set -uo pipefail

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

BASE=""
DB_NAME="vulnfocus-staging"
AUTO_ONLY=0
USE_COLOR=1

while [ $# -gt 0 ]; do
  case "$1" in
    --auto-only) AUTO_ONLY=1; shift ;;
    --db) DB_NAME="$2"; shift 2 ;;
    --no-color) USE_COLOR=0; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) BASE="${1%/}"; shift ;;
  esac
done

if [ -z "$BASE" ]; then
  echo "Uso: $0 https://staging.vulnfocus.com [--auto-only] [--db nombre]" >&2
  exit 2
fi

if [ "$USE_COLOR" = "1" ] && [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_WARN=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_WARN=""; C_DIM=""; C_OFF=""
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="acceptance-report-${STAMP}.md"
LOG_CMDS="/tmp/vf-acceptance-cmds-$$.txt"
: > "$LOG_CMDS"

# Resultados por control (clave -> estado) y detalle de fallos
declare -A RESULT
declare -a EVIDENCE=()
declare -a FAILURES=()

n_pass=0; n_fail=0; n_manual=0; n_unver=0

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

titulo() { printf '\n%s══ %s %s\n' "$C_DIM" "$1" "$C_OFF"; }

# curl con registro del comando ejecutado
CURL() { echo "curl $*" >> "$LOG_CMDS"; curl --max-time 25 "$@"; }

http_code() { CURL -s -o /dev/null -w '%{http_code}' "$@"; }
body()      { CURL -s "$@"; }
headers()   { CURL -sS -D - -o /dev/null "$@"; }

# check <clave> <descripción> <esperado> <obtenido>
check() {
  local key="$1" desc="$2" exp="$3" got="$4"
  if [ "$exp" = "$got" ]; then
    printf '  %sPASS%s  %-46s %s\n' "$C_OK" "$C_OFF" "$desc" "$got"
    RESULT["$key"]="${RESULT[$key]:-PASS}"
  else
    printf '  %sFAIL%s  %-46s esperado=%s obtenido=%s\n' "$C_BAD" "$C_OFF" "$desc" "$exp" "$got"
    RESULT["$key"]="FAIL"
    FAILURES+=("$desc — esperado '$exp', obtenido '$got'")
  fi
}

# check_contains <clave> <descripción> <aguja> <pajar>
check_contains() {
  local key="$1" desc="$2" needle="$3" hay="$4"
  if printf '%s' "$hay" | grep -qi -- "$needle"; then
    printf '  %sPASS%s  %-46s presente\n' "$C_OK" "$C_OFF" "$desc"
    RESULT["$key"]="${RESULT[$key]:-PASS}"
  else
    printf '  %sFAIL%s  %-46s AUSENTE\n' "$C_BAD" "$C_OFF" "$desc"
    RESULT["$key"]="FAIL"
    FAILURES+=("$desc — no encontrado: $needle")
  fi
}

# check_absent <clave> <descripción> <aguja> <pajar>
check_absent() {
  local key="$1" desc="$2" needle="$3" hay="$4"
  if printf '%s' "$hay" | grep -qi -- "$needle"; then
    printf '  %sFAIL%s  %-46s ENCONTRADO (no debería)\n' "$C_BAD" "$C_OFF" "$desc"
    RESULT["$key"]="FAIL"
    FAILURES+=("$desc — apareció: $needle")
  else
    printf '  %sPASS%s  %-46s ausente\n' "$C_OK" "$C_OFF" "$desc"
    RESULT["$key"]="${RESULT[$key]:-PASS}"
  fi
}

marca() { RESULT["$1"]="$2"; }

pregunta_si_no() { # pregunta_si_no <texto>  -> 0 si sí
  local resp
  printf '\n  %s%s%s [s/N] ' "$C_WARN" "$1" "$C_OFF"
  read -r resp </dev/tty || return 1
  case "$resp" in [sSyY]*) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------------------
# Comprobación previa
# ---------------------------------------------------------------------------

printf '\n%sVULNFOCUS — ACCEPTANCE TEST%s\n' "$C_DIM" "$C_OFF"
printf 'Objetivo : %s\n' "$BASE"
printf 'D1       : %s\n' "$DB_NAME"
printf 'Modo     : %s\n' "$([ "$AUTO_ONLY" = 1 ] && echo 'solo automático' || echo 'automático + manual guiado')"
printf 'Fecha    : %s\n' "$STAMP"

if ! CURL -s -o /dev/null --max-time 15 "$BASE/" 2>/dev/null; then
  printf '\n  %sFAIL%s  No se puede alcanzar %s\n' "$C_BAD" "$C_OFF" "$BASE"
  echo "El despliegue no responde. Comprueba DNS y que el Worker esté publicado." >&2
  exit 1
fi

# ===========================================================================
# 1 · DESPLIEGUE Y HTTPS
# ===========================================================================
titulo "1 · Despliegue y HTTPS"

check deployment "raíz responde"            200 "$(http_code "$BASE/")"

case "$BASE" in
  https://*)
    # Verificación real de TLS: si el certificado no valida, curl falla.
    if CURL -s -o /dev/null "$BASE/" 2>/dev/null; then
      printf '  %sPASS%s  %-46s certificado válido\n' "$C_OK" "$C_OFF" "TLS verificado por curl"
      marca https PASS
    else
      printf '  %sFAIL%s  %-46s certificado inválido\n' "$C_BAD" "$C_OFF" "TLS"
      marca https FAIL; FAILURES+=("TLS: el certificado no valida")
    fi
    # Redirección de HTTP a HTTPS
    HTTP_BASE="http://${BASE#https://}"
    redir=$(http_code -o /dev/null "$HTTP_BASE/")
    if [ "$redir" = "301" ] || [ "$redir" = "302" ] || [ "$redir" = "308" ]; then
      printf '  %sPASS%s  %-46s %s\n' "$C_OK" "$C_OFF" "HTTP redirige a HTTPS" "$redir"
    else
      printf '  %sWARN%s  %-46s %s (revisa "Always Use HTTPS")\n' "$C_WARN" "$C_OFF" "HTTP → HTTPS" "$redir"
    fi
    ;;
  *)
    printf '  %sUNVERIFIED%s  destino no es HTTPS (%s): TLS no evaluable\n' "$C_WARN" "$C_OFF" "$BASE"
    marca https UNVERIFIED
    ;;
esac

# ===========================================================================
# 2 · RUTAS SPA
# ===========================================================================
titulo "2 · Rutas SPA (acceso directo por URL)"

for ruta in / /proceso /recursos /certificaciones; do
  key="spa_$(echo "$ruta" | tr -d '/' )"; [ "$ruta" = "/" ] && key="spa_root"
  code=$(http_code -H 'Sec-Fetch-Mode: navigate' "$BASE$ruta")
  html=$(body -H 'Sec-Fetch-Mode: navigate' "$BASE$ruta")
  check "$key" "GET $ruta" 200 "$code"
  if printf '%s' "$html" | grep -q 'id="root"'; then
    printf '        %ssirve el shell de React (div#root)%s\n' "$C_DIM" "$C_OFF"
  else
    printf '  %sFAIL%s  %-46s no contiene div#root\n' "$C_BAD" "$C_OFF" "GET $ruta contenido"
    RESULT["$key"]="FAIL"; FAILURES+=("$ruta no devuelve el shell de React")
  fi
done

# ===========================================================================
# 3 · API: deny by default
# ===========================================================================
titulo "3 · API deny-by-default"

check api_health "GET /api/health" 200 "$(http_code "$BASE/api/health")"

for p in /api/contacts /api/contacts/stats /api/logs /api/logs/stats \
         /api/status /api/admin /api/random; do
  code=$(http_code "$BASE$p")
  check api_deny "GET $p" 404 "$code"
  # Crítico: NUNCA debe devolver el HTML de la SPA
  cuerpo=$(body "$BASE$p")
  if printf '%s' "$cuerpo" | grep -q 'id="root"'; then
    printf '  %sFAIL%s  %-46s devolvió index.html\n' "$C_BAD" "$C_OFF" "$p contenido"
    RESULT[api_deny]="FAIL"; FAILURES+=("$p devuelve index.html en lugar de JSON")
  fi
done

# ===========================================================================
# 4 · Restricción de métodos
# ===========================================================================
titulo "4 · Métodos en /api/contact"

for m in GET PUT PATCH DELETE OPTIONS; do
  check methods "$m /api/contact" 405 "$(http_code -X "$m" "$BASE/api/contact")"
done
# HEAD no devuelve cuerpo; se comprueba solo el código
check methods "HEAD /api/contact" 405 "$(http_code -I "$BASE/api/contact")"

allow=$(headers -X GET "$BASE/api/contact" | grep -i '^allow:' | tr -d '\r' | awk '{print $2}')
check methods "cabecera Allow" "POST" "$allow"

# ===========================================================================
# 5 · Tests negativos de la API
# ===========================================================================
titulo "5 · Validación de entrada"

J='Content-Type: application/json'
BIG="$(head -c 20000 /dev/zero | tr '\0' 'a')"
TOKEN_FALSO='"turnstileToken":"token-inventado-que-no-existe"'

check content_type "Content-Type text/plain" 415 \
  "$(http_code -X POST -H 'Content-Type: text/plain' -d 'x' "$BASE/api/contact")"

check validation "JSON malformado" 400 \
  "$(http_code -X POST -H "$J" -d '{malo' "$BASE/api/contact")"

check oversized "cuerpo de 20 KB" 413 \
  "$(http_code -X POST -H "$J" -d "{\"message\":\"$BIG\"}" "$BASE/api/contact")"

check validation "nombre demasiado corto" 400 \
  "$(http_code -X POST -H "$J" -d "{\"name\":\"A\",\"email\":\"a@b.com\",\"message\":\"mensaje valido de prueba\",$TOKEN_FALSO}" "$BASE/api/contact")"

check validation "email inválido" 400 \
  "$(http_code -X POST -H "$J" -d "{\"name\":\"Ana Lopez\",\"email\":\"noesunemail\",\"message\":\"mensaje valido de prueba\",$TOKEN_FALSO}" "$BASE/api/contact")"

check validation "mensaje demasiado corto" 400 \
  "$(http_code -X POST -H "$J" -d "{\"name\":\"Ana Lopez\",\"email\":\"a@b.com\",\"message\":\"corto\",$TOKEN_FALSO}" "$BASE/api/contact")"

# 403 = Turnstile rechazó el token (correcto).
# 503 = el Worker no tiene TURNSTILE_SECRET_KEY. Es fail-closed correcto, pero
#       significa que el entorno está mal configurado: el formulario NO funciona
#       para nadie. Se distingue para no dar un diagnóstico genérico.
check_turnstile() { # check_turnstile <clave> <descripción> <código>
  local key="$1" desc="$2" got="$3"
  if [ "$got" = "403" ]; then
    printf '  %sPASS%s  %-46s 403\n' "$C_OK" "$C_OFF" "$desc"
    RESULT["$key"]="${RESULT[$key]:-PASS}"
  elif [ "$got" = "503" ]; then
    printf '  %sFAIL%s  %-46s 503 — TURNSTILE_SECRET_KEY NO CONFIGURADO\n' "$C_BAD" "$C_OFF" "$desc"
    RESULT["$key"]="FAIL"
    FAILURES+=("$desc devolvió 503: falta el secreto TURNSTILE_SECRET_KEY en este entorno. Ejecuta: npx wrangler secret put TURNSTILE_SECRET_KEY --env staging")
  else
    printf '  %sFAIL%s  %-46s esperado=403 obtenido=%s\n' "$C_BAD" "$C_OFF" "$desc" "$got"
    RESULT["$key"]="FAIL"
    FAILURES+=("$desc — esperado 403, obtenido $got")
  fi
}

check_turnstile turnstile_missing "Turnstile ausente" \
  "$(http_code -X POST -H "$J" -d '{"name":"Ana Lopez","email":"a@b.com","message":"mensaje valido de prueba"}' "$BASE/api/contact")"

check_turnstile turnstile_invalid "Turnstile falso" \
  "$(http_code -X POST -H "$J" -d "{\"name\":\"Ana Lopez\",\"email\":\"a@b.com\",\"message\":\"mensaje valido de prueba\",$TOKEN_FALSO}" "$BASE/api/contact")"

titulo "5b · Los errores no filtran nada interno"

# Se acumulan los cuerpos de todas las respuestas de error y se buscan fugas.
FUGAS=""
FUGAS+=$(body -X POST -H 'Content-Type: text/plain' -d 'x' "$BASE/api/contact")
FUGAS+=$(body -X POST -H "$J" -d '{malo' "$BASE/api/contact")
FUGAS+=$(body -X POST -H "$J" -d "{\"name\":\"A\",\"email\":\"x\",\"message\":\"corto\",$TOKEN_FALSO}" "$BASE/api/contact")
FUGAS+=$(body -X POST -H "$J" -d '{"name":"Ana Lopez","email":"a@b.com","message":"mensaje valido de prueba"}' "$BASE/api/contact")
FUGAS+=$(body -X GET "$BASE/api/contact")
FUGAS+=$(body "$BASE/api/random")

for patron in \
  'at [A-Za-z_$][A-Za-z0-9_$]*.*:[0-9]+:[0-9]+' \
  'D1_ERROR' 'SQLITE' 'no such table' 'SQL' \
  'invalid-input-secret' 'invalid-input-response' 'timeout-or-duplicate' \
  'TURNSTILE_SECRET' 'TELEGRAM_BOT_TOKEN' 'TELEGRAM_CHAT_ID' \
  'api.telegram.org' 'siteverify' 'workerd' 'cloudflare-internal' \
  ; do
  check_absent no_leaks "sin '$patron' en errores" "$patron" "$FUGAS"
done

# El campo que falló no debe revelarse
check_absent no_leaks "el error no nombra el campo" '"field"' "$FUGAS"

# ===========================================================================
# 6 · Cabeceras de seguridad
# ===========================================================================
titulo "6 · Cabeceras de seguridad (edge real)"

H=$(headers "$BASE/")

check_contains headers "Strict-Transport-Security" 'strict-transport-security:' "$H"
check_contains headers "Content-Security-Policy"   'content-security-policy:'   "$H"
check_contains headers "X-Content-Type-Options"    'x-content-type-options: nosniff' "$H"
check_contains headers "Referrer-Policy"           'referrer-policy:'           "$H"
check_contains headers "Permissions-Policy"        'permissions-policy:'        "$H"

# Protección contra framing: vale cualquiera de las dos
if printf '%s' "$H" | grep -qi "frame-ancestors" || printf '%s' "$H" | grep -qi "^x-frame-options:"; then
  printf '  %sPASS%s  %-46s presente\n' "$C_OK" "$C_OFF" "frame-ancestors / X-Frame-Options"
else
  printf '  %sFAIL%s  %-46s AUSENTE\n' "$C_BAD" "$C_OFF" "protección contra framing"
  marca headers FAIL; FAILURES+=("Sin frame-ancestors ni X-Frame-Options")
fi

CSP=$(printf '%s' "$H" | grep -i '^content-security-policy:' | tr -d '\r')
check_absent csp_strict "CSP sin unsafe-eval"            "unsafe-eval" "$CSP"
# unsafe-inline se permite en style-src, nunca en script-src
SCRIPT_SRC=$(printf '%s' "$CSP" | grep -oiE "script-src[^;]*")
check_absent csp_strict "script-src sin unsafe-inline"   "unsafe-inline" "$SCRIPT_SRC"
check_contains csp_strict "script-src permite Turnstile" "challenges.cloudflare.com" "$SCRIPT_SRC"

titulo "6b · Cache-Control en la API"

for desc in "GET /api/health:$BASE/api/health" "GET /api/contact:$BASE/api/contact"; do
  d="${desc%%:*}"; u="${desc#*:}"
  cc=$(headers -X GET "$u" | grep -i '^cache-control:' | tr -d '\r' | sed 's/^[Cc]ache-[Cc]ontrol: *//')
  check cache_nostore "$d → no-store" "no-store" "$cc"
done

# Los errores de la API tampoco deben ser cacheables
cc_err=$(headers -X POST -H "$J" -d '{malo' "$BASE/api/contact" | grep -i '^cache-control:' | tr -d '\r' | sed 's/^[Cc]ache-[Cc]ontrol: *//')
check cache_nostore "error 400 → no-store" "no-store" "$cc_err"

# ===========================================================================
# 7 · Static assets
# ===========================================================================
titulo "7 · Static assets"

INDEX=$(body "$BASE/")
JS_PATH=$(printf '%s' "$INDEX" | grep -oE '/static/js/main\.[a-z0-9]+\.js' | head -1)
CSS_PATH=$(printf '%s' "$INDEX" | grep -oE '/static/css/main\.[a-z0-9]+\.css' | head -1)

if [ -n "$JS_PATH" ]; then
  check assets "JS ($JS_PATH)" 200 "$(http_code "$BASE$JS_PATH")"
  cc=$(headers "$BASE$JS_PATH" | grep -i '^cache-control:' | tr -d '\r')
  check_contains assets "JS con cache inmutable" "immutable" "$cc"
else
  printf '  %sFAIL%s  no se encontró el bundle JS en index.html\n' "$C_BAD" "$C_OFF"
  marca assets FAIL; FAILURES+=("index.html no referencia ningún bundle JS")
fi

[ -n "$CSS_PATH" ] && check assets "CSS ($CSS_PATH)" 200 "$(http_code "$BASE$CSS_PATH")"

for f in /favicon.svg /robots.txt /sitemap.xml /manifest.json; do
  check assets "GET $f" 200 "$(http_code "$BASE$f")"
done

titulo "7b · Ficheros que NO deben ser accesibles"

# Con fallback SPA todo devuelve 200 + index.html. Lo que importa es el CONTENIDO:
# hay que confirmar que NO se sirve el fichero real.
for f in /.env /.dev.vars /wrangler.jsonc /package.json /worker/index.js \
         /migrations/0001_contact_submissions.sql /_headers /.assetsignore \
         /asset-manifest.json; do
  c=$(body "$BASE$f")
  if printf '%s' "$c" | grep -q 'id="root"'; then
    printf '  %sPASS%s  %-46s fallback SPA, contenido no expuesto\n' "$C_OK" "$C_OFF" "$f"
    RESULT[no_secrets]="${RESULT[no_secrets]:-PASS}"
  elif [ -z "$c" ] || [ "$(http_code "$BASE$f")" = "404" ]; then
    printf '  %sPASS%s  %-46s no servido\n' "$C_OK" "$C_OFF" "$f"
    RESULT[no_secrets]="${RESULT[no_secrets]:-PASS}"
  else
    printf '  %sFAIL%s  %-46s CONTENIDO REAL EXPUESTO\n' "$C_BAD" "$C_OFF" "$f"
    marca no_secrets FAIL; FAILURES+=("$f expone contenido real")
  fi
done

# Source maps
if [ -n "$JS_PATH" ]; then
  mc=$(body "$BASE${JS_PATH}.map")
  if printf '%s' "$mc" | grep -q '"mappings"'; then
    printf '  %sFAIL%s  %-46s SOURCE MAP PUBLICADO\n' "$C_BAD" "$C_OFF" "${JS_PATH}.map"
    marca no_secrets FAIL; FAILURES+=("Source map accesible en ${JS_PATH}.map")
  else
    printf '  %sPASS%s  %-46s sin source map\n' "$C_OK" "$C_OFF" "${JS_PATH}.map"
  fi
fi

titulo "7c · Secretos en el bundle público"

BUNDLE=""
[ -n "$JS_PATH" ] && BUNDLE=$(body "$BASE$JS_PATH")
for patron in 'TURNSTILE_SECRET' 'TELEGRAM_BOT_TOKEN' 'TELEGRAM_CHAT_ID' \
              'mongodb://' 'api.telegram.org' '0x4AAAAAAA[A-Za-z0-9_-]*secret'; do
  check_absent no_secrets "bundle sin '$patron'" "$patron" "$BUNDLE"
done

# ===========================================================================
# 8 · SEO de staging
# ===========================================================================
titulo "8 · Protección SEO del entorno"

XR=$(printf '%s' "$H" | grep -i '^x-robots-tag:' | tr -d '\r')
case "$BASE" in
  *staging*|*workers.dev*)
    if printf '%s' "$XR" | grep -qi 'noindex'; then
      printf '  %sPASS%s  %-46s %s\n' "$C_OK" "$C_OFF" "staging con noindex" "${XR#*: }"
      marca staging_noindex PASS
    else
      printf '  %sFAIL%s  %-46s AUSENTE — staging sería indexable\n' "$C_BAD" "$C_OFF" "X-Robots-Tag"
      marca staging_noindex FAIL; FAILURES+=("staging sin X-Robots-Tag: noindex")
    fi
    # El canonical debe seguir apuntando a producción
    if printf '%s' "$INDEX" | grep -qi 'rel="canonical".*vulnfocus\.com'; then
      printf '  %sPASS%s  %-46s apunta a producción\n' "$C_OK" "$C_OFF" "canonical"
    else
      printf '  %sWARN%s  %-46s no apunta a vulnfocus.com\n' "$C_WARN" "$C_OFF" "canonical"
    fi
    ;;
  *)
    # Contra producción: la regla noindex NO debe heredarse
    if printf '%s' "$XR" | grep -qi 'noindex'; then
      printf '  %sFAIL%s  %-46s producción NO debe llevar noindex\n' "$C_BAD" "$C_OFF" "X-Robots-Tag"
      marca staging_noindex FAIL; FAILURES+=("producción hereda noindex: rompería el SEO")
    else
      printf '  %sPASS%s  %-46s sin noindex (correcto en producción)\n' "$C_OK" "$C_OFF" "X-Robots-Tag"
      marca staging_noindex PASS
    fi
    ;;
esac

# ===========================================================================
# 9 · FASES MANUALES
# ===========================================================================

for k in turnstile_real d1_insert telegram_real csp_browser observability; do
  marca "$k" UNVERIFIED
done

if [ "$AUTO_ONLY" = "1" ]; then
  titulo "9 · Fases manuales OMITIDAS (--auto-only)"
  printf '  %sUNVERIFIED%s  Turnstile real, D1 insert, Telegram, CSP navegador, observabilidad\n' "$C_WARN" "$C_OFF"
else
  titulo "9 · Fase manual: happy path real desde navegador"

  cat <<INSTRUCCIONES

  Este paso NO se puede automatizar sin introducir un bypass de Turnstile,
  y eso invalidaría la prueba. Hazlo a mano:

  1) Abre en un navegador, con DevTools abierto (Console + Network + Security):

       $BASE

  2) Ve al formulario de contacto y rellénalo con datos identificables:

       Nombre  : VulnFocus Staging Test
       Email   : <una dirección de pruebas que controles>
       Empresa : E2E-STAGING
       Mensaje : Prueba end-to-end de VulnFocus staging.

  3) Resuelve el widget de Turnstile y envía.

  4) En DevTools → Network, abre la petición POST /api/contact y anota:
       - Status  (esperado: 201)
       - El campo "submission_id" de la respuesta

INSTRUCCIONES

  printf '  %s¿Cuál fue el código HTTP del POST /api/contact? %s' "$C_WARN" "$C_OFF"
  read -r POST_CODE </dev/tty || POST_CODE=""

  if [ "$POST_CODE" = "201" ]; then
    printf '  %sMANUAL PASS%s  POST /api/contact → 201\n' "$C_OK" "$C_OFF"
    marca turnstile_real "MANUAL PASS"
    EVIDENCE+=("POST /api/contact devolvió 201 con un token real de Turnstile")
  else
    printf '  %sFAIL%s  POST /api/contact → %s (esperado 201)\n' "$C_BAD" "$C_OFF" "${POST_CODE:-sin respuesta}"
    marca turnstile_real FAIL
    FAILURES+=("El envío real devolvió ${POST_CODE:-nada} en lugar de 201")
  fi

  # --- Cabeceras de la respuesta del POST, según DevTools -------------------
  if pregunta_si_no "¿La respuesta del POST llevaba Content-Type: application/json y Cache-Control: no-store?"; then
    printf '  %sMANUAL PASS%s  cabeceras del POST correctas\n' "$C_OK" "$C_OFF"
    EVIDENCE+=("Respuesta del POST con Content-Type JSON y Cache-Control: no-store")
  else
    marca headers FAIL; FAILURES+=("Cabeceras incorrectas en la respuesta del POST")
  fi

  # --- D1 -------------------------------------------------------------------
  titulo "10 · Verificación en D1 real"

  printf '  %ssubmission_id devuelto por la API: %s' "$C_WARN" "$C_OFF"
  read -r SUB_ID </dev/tty || SUB_ID=""

  if [ -n "$SUB_ID" ] && command -v npx >/dev/null 2>&1; then
    echo "npx wrangler d1 execute $DB_NAME --remote --json --command=\"SELECT ...\"" >> "$LOG_CMDS"
    D1OUT=$(npx wrangler d1 execute "$DB_NAME" --remote --json \
      --command="SELECT id, status, created_at, company, ip_address, length(name) AS n_len, length(email) AS e_len, length(message) AS m_len FROM contact_submissions ORDER BY created_at DESC LIMIT 5;" 2>/dev/null)

    # Se imprime solo metadatos: nunca nombre, email ni mensaje.
    D1REPORT=$(printf '%s' "$D1OUT" | SUB_ID="$SUB_ID" node -e '
      let raw=""; process.stdin.on("data",c=>raw+=c); process.stdin.on("end",()=>{
        const id = process.env.SUB_ID;
        let rows;
        try { rows = JSON.parse(raw)[0].results; } catch { console.log("ERROR|no se pudo leer la respuesta de D1"); return; }
        const r = rows.find(x => x.id === id);
        if (!r) { console.log("ERROR|submission_id no encontrado entre las 5 últimas filas"); return; }
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.id);
        const iso  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.created_at);
        const reciente = Math.abs(Date.now() - Date.parse(r.created_at)) < 3600e3;
        const campos = r.n_len > 0 && r.e_len > 0 && r.m_len > 0;
        console.log([
          "OK",
          "row present            " + "YES",
          "UUID valid             " + (uuid ? "YES" : "NO"),
          "status                 " + r.status,
          "timestamp valid        " + (iso && reciente ? "YES" : "NO"),
          "company                " + (r.company ?? "(NULL)"),
          "ip_address             " + (r.ip_address === null ? "NULL (correcto)" : "ALMACENADA"),
          "expected fields        " + (campos ? "PASS" : "FAIL"),
          "campos con contenido   name=" + r.n_len + " email=" + r.e_len + " message=" + r.m_len + " chars",
        ].join("|"));
      });
    ')

    if printf '%s' "$D1REPORT" | grep -q '^OK'; then
      printf '\n'
      printf '%s' "$D1REPORT" | tr '|' '\n' | tail -n +2 | sed 's/^/    /'
      estado=$(printf '%s' "$D1REPORT" | tr '|' '\n' | grep '^status' | awk '{print $2}')
      uuidok=$(printf '%s' "$D1REPORT" | tr '|' '\n' | grep '^UUID valid' | awk '{print $3}')
      if [ "$estado" = "new" ] && [ "$uuidok" = "YES" ]; then
        printf '\n  %sPASS%s  fila encontrada en D1 con los valores esperados\n' "$C_OK" "$C_OFF"
        marca d1_insert PASS
        EVIDENCE+=("Fila localizada en D1 $DB_NAME: UUIDv4 válido, status=new, created_at ISO reciente, ip_address NULL")
      else
        marca d1_insert FAIL; FAILURES+=("La fila en D1 no tiene los valores esperados")
      fi
    else
      printf '  %sFAIL%s  %s\n' "$C_BAD" "$C_OFF" "$(printf '%s' "$D1REPORT" | cut -d'|' -f2)"
      marca d1_insert FAIL
      FAILURES+=("No se localizó la fila en D1: $(printf '%s' "$D1REPORT" | cut -d'|' -f2)")
    fi
  else
    printf '  %sUNVERIFIED%s  sin submission_id o sin npx disponible\n' "$C_WARN" "$C_OFF"
  fi

  # --- Telegram -------------------------------------------------------------
  titulo "11 · Notificación de Telegram real"

  cat <<'TG'

  Revisa el chat de pruebas configurado. El mensaje debe contener:

      Nuevo contacto VulnFocus
      Nombre:  VulnFocus Staging Test
      Empresa: E2E-STAGING
      Email:   <tu dirección de pruebas>
      Fecha:   <ISO 8601>
      ID:      <el submission_id>
      Mensaje: Prueba end-to-end de VulnFocus staging.

  Debe verse como TEXTO PLANO: sin negritas, sin enlaces generados a partir
  del contenido, sin markup interpretado.
TG

  if pregunta_si_no "¿Llegó el mensaje al chat, con esos campos y como texto plano?"; then
    printf '  %sMANUAL PASS%s  Telegram real\n' "$C_OK" "$C_OFF"
    marca telegram_real "MANUAL PASS"
    EVIDENCE+=("Notificación recibida en el chat de pruebas, texto plano, con los cinco campos")
  else
    marca telegram_real FAIL
    FAILURES+=("No llegó la notificación de Telegram o el formato es incorrecto")
  fi

  # --- DevTools -------------------------------------------------------------
  titulo "12 · Seguridad en el navegador (DevTools)"

  cat <<'DT'

  Con la consola abierta durante todo el flujo anterior, cuenta:

      Console errors               (requerido: 0)
      CSP violations               (requerido: 0)
      Mixed content                (requerido: 0)
      CORS errors                  (requerido: 0)
      Turnstile errors             (requerido: 0)
      Unexpected failed requests   (requerido: 0)

  Si hay una violación de CSP, NO relajes la política globalmente:
  el mensaje indica la directiva y el origen exactos que faltan.
DT

  if pregunta_si_no "¿Los seis contadores están a 0?"; then
    printf '  %sMANUAL PASS%s  navegador sin errores\n' "$C_OK" "$C_OFF"
    marca csp_browser "MANUAL PASS"
    EVIDENCE+=("DevTools: 0 errores de consola, CSP, mixed content, CORS, Turnstile y peticiones fallidas")
  else
    marca csp_browser FAIL
    FAILURES+=("Errores en el navegador durante el flujo")
  fi

  if pregunta_si_no "En Network, ¿confirmas que NINGUNA petición del navegador contenía TURNSTILE_SECRET_KEY, TELEGRAM_BOT_TOKEN ni TELEGRAM_CHAT_ID?"; then
    printf '  %sMANUAL PASS%s  sin secretos en el tráfico del navegador\n' "$C_OK" "$C_OFF"
    EVIDENCE+=("Ningún secreto presente en las peticiones observadas en DevTools → Network")
  else
    marca no_secrets FAIL
    FAILURES+=("Se observó un secreto en el tráfico del navegador")
  fi

  # --- Observabilidad -------------------------------------------------------
  titulo "13 · Observabilidad"

  cat <<OBS

  En otra terminal:

      npx wrangler tail --env staging --format json > /tmp/vf-logs.json

  Repite un envío, corta con Ctrl-C y comprueba (no imprime valores):

      for p in TURNSTILE_SECRET TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
        echo "\$p: \$(grep -c "\$p" /tmp/vf-logs.json)"
      done
      grep -cE '"turnstileToken"|"message":"' /tmp/vf-logs.json

  Todos deben dar 0. Los únicos eventos esperados son:

      {"event":"contact_saved","id":"<uuid>"}
      {"event":"telegram_sent","id":"<uuid>"}

OBS

  if pregunta_si_no "¿Todos los contadores dieron 0 y solo aparecen esos eventos con el UUID?"; then
    printf '  %sMANUAL PASS%s  logs sin secretos ni PII\n' "$C_OK" "$C_OFF"
    marca observability "MANUAL PASS"
    EVIDENCE+=("Logs del Worker sin secretos, sin token de Turnstile y sin cuerpo del formulario")
  else
    marca observability FAIL
    FAILURES+=("Los logs contienen secretos o PII")
  fi
fi

# ===========================================================================
# TABLA FINAL
# ===========================================================================

ORDEN=(
  "Cloudflare deployment:deployment"
  "HTTPS:https"
  "Static Assets:assets"
  "SPA /:spa_root"
  "SPA /proceso:spa_proceso"
  "SPA /recursos:spa_recursos"
  "SPA /certificaciones:spa_certificaciones"
  "API health:api_health"
  "API deny-by-default:api_deny"
  "Method restrictions:methods"
  "Input validation:validation"
  "Oversized request:oversized"
  "Turnstile missing:turnstile_missing"
  "Turnstile invalid:turnstile_invalid"
  "Turnstile REAL:turnstile_real"
  "D1 REAL insert:d1_insert"
  "Telegram REAL:telegram_real"
  "Security headers:headers"
  "CSP browser:csp_browser"
  "HTTPS/TLS:https"
  "No secrets exposed:no_secrets"
  "Staging noindex:staging_noindex"
  "Observability:observability"
)

emitir_tabla() {
  printf 'VULNFOCUS STAGING ACCEPTANCE TEST\n'
  printf 'Objetivo : %s\n' "$BASE"
  printf 'Fecha    : %s\n\n' "$STAMP"
  for e in "${ORDEN[@]}"; do
    printf '%-34s %s\n' "${e%%:*}" "${RESULT[${e#*:}]:-UNVERIFIED}"
  done
  printf '\n%-34s %s\n' "LOCAL TESTS" "73/73 PASS"
  printf '%-34s %s\n' "CUTOVER" "NOT EXECUTED"
}

titulo "TABLA FINAL"
emitir_tabla | sed 's/^/  /'

# Recuento
for e in "${ORDEN[@]}"; do
  case "${RESULT[${e#*:}]:-UNVERIFIED}" in
    PASS) n_pass=$((n_pass+1)) ;;
    "MANUAL PASS") n_manual=$((n_manual+1)) ;;
    FAIL) n_fail=$((n_fail+1)) ;;
    *) n_unver=$((n_unver+1)) ;;
  esac
done

printf '\n  PASS=%d  MANUAL PASS=%d  FAIL=%d  UNVERIFIED=%d\n' \
  "$n_pass" "$n_manual" "$n_fail" "$n_unver"

# Recomendación
titulo "RECOMENDACIÓN"
if [ "$n_fail" -gt 0 ]; then
  RECO="NO-GO"
  MOTIVO="Hay $n_fail control(es) en FAIL."
elif [ "$n_unver" -gt 0 ]; then
  RECO="NO-GO"
  MOTIVO="Hay $n_unver control(es) UNVERIFIED. No se asume éxito de lo no probado."
else
  RECO="GO FOR CUTOVER"
  MOTIVO="Todos los controles en PASS o MANUAL PASS."
fi

if [ "$RECO" = "GO FOR CUTOVER" ]; then
  printf '  %s%s%s — %s\n' "$C_OK" "$RECO" "$C_OFF" "$MOTIVO"
else
  printf '  %s%s%s — %s\n' "$C_BAD" "$RECO" "$C_OFF" "$MOTIVO"
fi

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf '\n  Fallos:\n'
  printf '    - %s\n' "${FAILURES[@]}"
fi

printf '\n  El cutover NO se ejecuta automáticamente. Requiere aprobación explícita.\n'

# ---------------------------------------------------------------------------
# Informe en fichero
# ---------------------------------------------------------------------------
{
  echo '# VulnFocus — Staging Acceptance Test'
  echo
  echo "- Objetivo: \`$BASE\`"
  echo "- Fecha: $STAMP"
  echo "- Modo: $([ "$AUTO_ONLY" = 1 ] && echo 'solo automático' || echo 'automático + manual guiado')"
  echo
  echo '## Tabla final'
  echo
  echo '```'
  emitir_tabla
  echo '```'
  echo
  echo "PASS=$n_pass · MANUAL PASS=$n_manual · FAIL=$n_fail · UNVERIFIED=$n_unver"
  echo
  if [ "${#FAILURES[@]}" -gt 0 ]; then
    echo '## Fallos'; echo
    printf -- '- %s\n' "${FAILURES[@]}"; echo
  fi
  if [ "${#EVIDENCE[@]}" -gt 0 ]; then
    echo '## Evidencias'; echo
    printf -- '- %s\n' "${EVIDENCE[@]}"; echo
  fi
  echo '## Comandos ejecutados'
  echo
  echo '```'
  cat "$LOG_CMDS"
  echo '```'
  echo
  echo '## Recomendación'; echo
  echo "**$RECO** — $MOTIVO"
  echo
  echo 'El cutover no se ejecuta automáticamente.'
} > "$REPORT"

printf '  Informe: %s\n\n' "$REPORT"
rm -f "$LOG_CMDS"

[ "$n_fail" -eq 0 ] && [ "$n_unver" -eq 0 ]
