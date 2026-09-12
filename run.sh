#!/usr/bin/env bash
#
# run.sh — полный запуск проекта «Маяк» одной командой: поднимает бэкенд
# (FastAPI/uvicorn) и фронтенд (Vite dev server) против него, без моков.
#
# Использование:
#   ./run.sh          — обычный запуск (бэкенд + фронт против него)
#   ./run.sh --mock   — только фронт в мок-режиме (бэкенд не поднимается)
#
# Остановка: Ctrl+C — скрипт сам гасит оба процесса.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT=8000
FRONTEND_PORT=5173

MOCK_ONLY=false
if [[ "${1:-}" == "--mock" ]]; then
  MOCK_ONLY=true
fi

log() { echo -e "\033[1;36m[run.sh]\033[0m $1"; }

kill_port() {
  local port="$1"
  local pid
  pid=$(lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    log "Порт $port занят (pid $pid) — освобождаю"
    kill $pid 2>/dev/null || true
    sleep 1
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  for _ in $(seq 1 60); do
    if curl -sf --noproxy '*' "$url" >/dev/null 2>&1; then
      log "$name отвечает"
      return 0
    fi
    sleep 1
  done
  log "$name не поднялся за 60с — смотри логи выше"
  return 1
}

BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  log "Останавливаю..."
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [[ "$MOCK_ONLY" == false ]]; then
  log "Готовлю бэкенд (backend/venv)..."
  if [[ ! -x "$BACKEND_DIR/venv/bin/uvicorn" ]]; then
    log "Виртуальное окружение не найдено — создаю и ставлю зависимости (один раз, может занять минуту)"
    rm -rf "$BACKEND_DIR/venv"
    python3 -m venv "$BACKEND_DIR/venv"
    "$BACKEND_DIR/venv/bin/pip" install -q -r "$ROOT_DIR/requirements.txt"
  fi

  kill_port "$BACKEND_PORT"
  log "Запускаю бэкенд на http://127.0.0.1:$BACKEND_PORT ..."
  (cd "$BACKEND_DIR" && exec venv/bin/uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT") &
  BACKEND_PID=$!
  wait_for_http "http://127.0.0.1:$BACKEND_PORT/docs" "Бэкенд"
fi

log "Готовлю фронтенд (frontend/node_modules)..."
if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  log "node_modules не найдены — ставлю зависимости (один раз, может занять минуту)"
  (cd "$FRONTEND_DIR" && npm install)
fi

kill_port "$FRONTEND_PORT"
log "Запускаю фронтенд на http://127.0.0.1:$FRONTEND_PORT ..."
if [[ "$MOCK_ONLY" == true ]]; then
  (cd "$FRONTEND_DIR" && exec env VITE_USE_MOCK=true npm run dev -- --port "$FRONTEND_PORT" --strictPort) &
else
  (cd "$FRONTEND_DIR" && exec env VITE_USE_MOCK=false VITE_API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" npm run dev -- --port "$FRONTEND_PORT" --strictPort) &
fi
FRONTEND_PID=$!
wait_for_http "http://127.0.0.1:$FRONTEND_PORT" "Фронтенд"

echo
log "Готово! Открой в браузере: http://localhost:$FRONTEND_PORT"
[[ "$MOCK_ONLY" == false ]] && log "Бэкенд (Swagger): http://localhost:$BACKEND_PORT/docs"
log "Нажми Ctrl+C, чтобы остановить оба процесса."

wait
