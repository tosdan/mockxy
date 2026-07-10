#!/usr/bin/env bash
# Supervisore dell'indagine ng serve: esegue N run completi della suite (config ngprobe,
# architettura A strumentata), con bonifica delle porte e2e tra un run e l'altro.
# Uso: supervisor.sh <base-log-dir> [num-run] [spec-only-per-smoke]
set -u
BASE="${1:?serve la cartella base dei log}"
RUNS="${2:-9}"
ONLY_SPEC="${3:-}"
mkdir -p "$BASE"
SUMMARY="$BASE/summary.log"

note() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$SUMMARY"; }

cleanup_ports() {
  for port in 3101 4301; do
    for pid in $(netstat -ano | grep "LISTENING" | grep ":$port " | awk '{print $5}' | sort -u); do
      taskkill //F //T //PID "$pid" > /dev/null 2>&1 && note "cleanup: ucciso pid $pid su :$port"
    done
  done
  sleep 2
  if netstat -ano | grep "LISTENING" | grep -qE ":(3101|4301) "; then
    note "ATTENZIONE: porte ancora occupate dopo la bonifica"
  fi
}

note "SUPERVISOR START runs=$RUNS spec='${ONLY_SPEC:-tutti}'"
for i in $(seq 1 "$RUNS"); do
  RUN_DIR="$BASE/run-$i"
  mkdir -p "$RUN_DIR"
  cleanup_ports
  note "RUN $i START"
  # Redirezione diretta su file, NIENTE pipe: gli handle di una pipe vengono ereditati da tutti i
  # discendenti Windows; se un kill parziale (ATC) lascia orfano un ramo della catena npm, l'orfano
  # terrebbe aperta la pipe e il supervisore resterebbe appeso per sempre (successo a run 20 del
  # loop A/B). I timestamp fini stanno comunque in events.log/probe.jsonl del wrapper.
  PROBE_LOG_DIR="$RUN_DIR" npx playwright test --config=playwright.ngprobe.config.js $ONLY_SPEC \
    > "$RUN_DIR/playwright.log" 2>&1
  rc=$?
  refused=$(grep -c "ERR_CONNECTION_REFUSED" "$RUN_DIR/playwright.log")
  result=$(grep -E "[0-9]+ (passed|failed)" "$RUN_DIR/playwright.log" | tail -2 | sed 's/^[0-9TZ:-]* *//' | tr '\n' ' ')
  note "RUN $i END rc=$rc refused=$refused result=$result"
done
cleanup_ports
note "SUPERVISOR DONE"
