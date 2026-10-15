#!/bin/bash
# add-voice.sh - put the final soundtrack (the music with the voice-over mixed in) on the rendered film, without touching the picture
#   bash add-voice.sh [film without voice] [film with voice]
set -e
IN=${1:-out/matter-of-place-product-launch.mp4}; OUT=${2:-out/matter-of-place-product-launch-vo.mp4}
ffmpeg -hide_banner -loglevel error -y -i "$IN" -i sound/matter-of-place-soundtrack.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k -ar 48000 -movflags +faststart "$OUT"
ls -la "$OUT"
