#!/usr/bin/env bash
#
# Checks that a freshly deployed version of the dashboard is actually working,
# then reports the result to the app (which notifies the owner's devices, and
# messages ZB Automations if anything failed).
#
# Run by .github/workflows/deploy-check.yml after every successful Production
# deployment. Everything it touches is public or protected by the scheduler
# secret: it never logs in and never changes any data.
#
#   BASE            the site to check (default: the live dashboard)
#   SHA             the commit that was deployed
#   DIGEST_SECRET   the scheduler secret (needed to report)
#   SETTLE_SECONDS  how long to wait for the new version to be served (default 20)
#   DRY_RUN=1       print the result as JSON instead of reporting it (for testing)
set -u

BASE="${BASE:-https://dashboard.nolanautomotive.ie}"
SHA="${SHA:-0000000}"
SETTLE_SECONDS="${SETTLE_SECONDS:-20}"
failures=()

sleep "$SETTLE_SECONDS"

# HTTP status of a request, retried a few times so one blip does not count as a failure.
code() {
  curl -s -o /dev/null -m 30 --retry 3 --retry-delay 10 --retry-all-errors -w '%{http_code}' "$@"
}

fail() { failures+=("$1"); }

# 1. The login page loads.
c=$(code "$BASE/login")
[ "$c" = "200" ] || fail "login page returned $c"

# 2. The login gate still works: a page without a session is sent to the login page.
gate=$(curl -s -o /dev/null -m 30 --retry 3 --retry-delay 10 --retry-all-errors -w '%{http_code} %{redirect_url}' "$BASE/jobs")
case "$gate" in
  30[1278]\ */login*) ;;
  *) fail "login gate not working (got: $gate)" ;;
esac

# 3. The standard security headers are still sent.
headers=$(curl -sI -m 30 --retry 3 --retry-delay 10 --retry-all-errors "$BASE/login" | tr -d '\r')
echo "$headers" | grep -qi '^x-frame-options: *deny' || fail "X-Frame-Options header missing"
echo "$headers" | grep -qi '^x-content-type-options: *nosniff' || fail "X-Content-Type-Options header missing"

# 4. The app can be installed: the manifest and the offline page's service worker are served.
c=$(code "$BASE/manifest.webmanifest")
[ "$c" = "200" ] || fail "manifest returned $c"
sw=$(curl -s -m 30 --retry 3 --retry-delay 10 --retry-all-errors "$BASE/sw.js")
echo "$sw" | grep -q 'notificationclick' || fail "service worker missing or out of date"

# 5. The notification routes exist and are behind the login (not open to the world).
c=$(code "$BASE/api/push/key")
case "$c" in 401|307|308|302) ;; *) fail "notification key route returned $c (expected it to refuse without a login)" ;; esac

# 6. The server, and its database, are answering: ask the scheduler endpoint for a
#    dry run of the morning summary, which reads the jobs table and sends nothing.
if [ -n "${DIGEST_SECRET:-}" ]; then
  dry=$(curl -s -m 60 --retry 3 --retry-delay 10 --retry-all-errors -X POST \
    -H "Authorization: Bearer $DIGEST_SECRET" "$BASE/api/push/scheduled?job=morning&dryRun=1")
  echo "$dry" | grep -q '"dryRun":true' || fail "app or database not answering (morning summary dry run failed)"
else
  fail "no scheduler secret available to check the app and database"
fi

# Build the report by hand, with no tools beyond bash and sed:
#   {"sha": "...", "failures": ["...", ...]}
json_string() {
  # Flatten line breaks and tabs, then escape backslashes and double quotes.
  printf '"%s"' "$(printf '%s' "$1" | tr '\r\n\t' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}
list=''
for f in "${failures[@]+"${failures[@]}"}"; do
  [ -n "$f" ] || continue
  [ -n "$list" ] && list="$list,"
  list="$list$(json_string "$f")"
done
report="{\"sha\":$(json_string "$SHA"),\"failures\":[$list]}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "$report"
else
  curl --fail-with-body -sS -m 60 --retry 3 --retry-delay 10 --retry-all-errors \
    -X POST \
    -H "Authorization: Bearer ${DIGEST_SECRET:-}" \
    -H 'content-type: application/json' \
    -d "$report" \
    "$BASE/api/push/scheduled?job=deploy" || echo "could not report the result"
  echo
fi

if [ "${#failures[@]}" -gt 0 ]; then
  echo "Checks failed for $SHA:" >&2
  printf ' - %s\n' "${failures[@]}" >&2
  exit 1
fi
echo "All checks passed for $SHA" >&2
