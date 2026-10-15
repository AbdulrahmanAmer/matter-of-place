#!/bin/bash
# 4_mux.sh - put the new soundtrack on the film without touching the picture:  bash 4_mux.sh film.mp4 out/film-vo.mp4
set -e
ffmpeg -hide_banner -loglevel error -y -i "$1" -i work/mix.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k -ar 48000 -movflags +faststart "$2"
echo "picture is untouched if these two lines are identical:"; for f in "$1" "$2"; do ffmpeg -hide_banner -loglevel error -i "$f" -map 0:v:0 -c copy -f md5 -; done
ls -la "$2"
