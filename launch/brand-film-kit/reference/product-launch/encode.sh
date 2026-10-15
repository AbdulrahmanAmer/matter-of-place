#!/bin/bash
# encode.sh - frames + score -> MP4, then check it:   ./encode.sh <name> [fps=60] [video kbit/s=6000]
# Two-pass so the file size is known in advance: size in MB is about (kbit/s + 256) * seconds / 8000.
set -e
NAME=${1:?name}; FPS=${2:-60}; BR=${3:-6000}; OUT=out/$NAME.mp4
# canvas JPEGs are full-range BT.601; the MP4 is tagged and converted to limited-range BT.709, or players show washed or shifted colour
VF="scale=in_range=full:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p"
X="-c:v libx264 -preset slow -b:v ${BR}k -maxrate $((BR*2))k -bufsize $((BR*4))k -x264-params aq-mode=3 -profile:v high -level 4.2 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"
ffmpeg -hide_banner -loglevel error -y -framerate $FPS -i frames/%05d.jpg -vf "$VF" $X -pass 1 -passlogfile out/x264pass -an -f null /dev/null
ffmpeg -hide_banner -loglevel error -y -framerate $FPS -i frames/%05d.jpg -i out/score.wav -vf "$VF" $X -pass 2 -passlogfile out/x264pass -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest "$OUT"
echo "== file";     ls -la "$OUT"
echo "== streams";  ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_space,nb_frames,duration,sample_rate,channels -of compact "$OUT"
echo "== frames on disk: $(ls frames/*.jpg | wc -l)"
echo "== loudness"; ffmpeg -hide_banner -nostats -i "$OUT" -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | grep -E "^ +(I|Peak):"
echo "== fidelity to the frames"; ffmpeg -hide_banner -nostats -i "$OUT" -framerate $FPS -i frames/%05d.jpg -lavfi "[1:v]$VF[ref];[0:v][ref]psnr" -f null - 2>&1 | grep -o "average:[0-9.]*"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
ffmpeg -hide_banner -loglevel error -y -i "$OUT" -vf "fps=24/$DUR,scale=480:-1,tile=6x4" -frames:v 1 out/${NAME}_sheet.jpg && echo "== contact sheet (24 frames spread over the film): out/${NAME}_sheet.jpg"
