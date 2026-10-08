#!/usr/bin/env bash
# Streams BotWorld to Twitch from a Linux machine without a screen.
# It opens the stream view in Chromium on a virtual display (Xvfb) and sends
# that display to Twitch with ffmpeg. Both are restarted if they ever stop.
#
# Needs: xvfb, chromium (or google-chrome), ffmpeg, and BotWorld running
# (npm start) on the same machine.
#
#   TWITCH_STREAM_KEY=live_xxx ./stream/stream.sh        go live
#   OUTPUT=test.mp4 DURATION=20 ./stream/stream.sh       record a test clip instead
#
# Optional: SIZE=1920x1080 FPS=30 BITRATE=4500k QUALITY=high (the defaults are
# 1280x720, 30 fps, 3000k and QUALITY=low, which a machine without a graphics
# card can manage). BOTWORLD_URL overrides the page that is streamed.
set -euo pipefail

SIZE="${SIZE:-1280x720}"
FPS="${FPS:-30}"
BITRATE="${BITRATE:-3000k}"
QUALITY="${QUALITY:-low}"
URL="${BOTWORLD_URL:-http://localhost:3000/?stream=1&sound=1&quality=$QUALITY}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
INGEST="${INGEST:-rtmp://live.twitch.tv/app}"
CHROME="${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}"
W="${SIZE%x*}"
H="${SIZE#*x}"

if [ -z "$CHROME" ]; then echo "No Chromium found. Install chromium or set CHROME=/path/to/chrome." >&2; exit 1; fi
if [ -n "${OUTPUT:-}" ]; then
  DEST="$OUTPUT"
  FORMAT=$([[ "$OUTPUT" == *.mp4 ]] && echo mp4 || echo flv)
elif [ -n "${TWITCH_STREAM_KEY:-}" ]; then
  DEST="$INGEST/$TWITCH_STREAM_KEY"
  FORMAT=flv
else
  echo "Set TWITCH_STREAM_KEY (from twitch.tv dashboard > Settings > Stream), or OUTPUT=file.mp4 to test." >&2
  exit 1
fi

export DISPLAY=":$DISPLAY_NUM"
Xvfb "$DISPLAY" -screen 0 "${W}x${H}x24" -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
PIDS=("$XVFB_PID")
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; pkill -P $$ 2>/dev/null || true; }
trap cleanup EXIT INT TERM
sleep 1

SANDBOX=()
if [ "$(id -u)" = "0" ]; then SANDBOX=(--no-sandbox); fi
keep_chrome() {
  while true; do
    "$CHROME" "${SANDBOX[@]}" --kiosk --no-first-run --no-default-browser-check --disable-infobars \
      --disable-session-crashed-bubble --disable-features=Translate --noerrdialogs \
      --autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist --enable-unsafe-swiftshader \
      --window-position=0,0 --window-size="$W,$H" --user-data-dir=/tmp/botworld-chrome "$URL" \
      >>/tmp/botworld-chrome.log 2>&1 || true
    echo "[stream] browser stopped, starting it again" >&2
    sleep 3
  done
}
keep_chrome &
PIDS+=("$!")
echo "[stream] waiting for the page to load"
sleep "${WARMUP:-10}"

# Twitch wants a keyframe every 2 seconds and a steady bitrate.
send() {
  ffmpeg -hide_banner -loglevel warning \
    -f x11grab -framerate "$FPS" -video_size "${W}x${H}" -draw_mouse 0 -i "$DISPLAY" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
    -c:v libx264 -preset veryfast -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize "$BITRATE" \
    -pix_fmt yuv420p -g "$((FPS * 2))" -keyint_min "$((FPS * 2))" -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 44100 ${DURATION:+-t "$DURATION"} -f "$FORMAT" "$DEST"
}
if [ -n "${OUTPUT:-}" ]; then
  send
  echo "[stream] wrote $OUTPUT"
else
  while true; do
    echo "[stream] live at $SIZE, $FPS fps"
    send || true
    echo "[stream] connection to Twitch dropped, reconnecting in 5 s" >&2
    sleep 5
  done
fi
