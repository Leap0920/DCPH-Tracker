#!/usr/bin/env bash
# Re-encode a video for delivery, sized for the Vercel Hobby transfer budget.
#
# 720p-max, H.264 High, two-pass ABR (predictable size), +faststart so the
# player can start after the first bytes and `preload="metadata"` stays
# cheap. The target bitrate is the quality/size knob:
#
#   800k ≈ 31 MB per 5 minutes (comfortable default for phone/desktop)
#   600k ≈ 23 MB per 5 minutes (data-saver)
#  1100k ≈ 42 MB per 5 minutes (near the old masters)
#
# Usage: ./scripts/optimize-videos.sh <input> <output> [video_bitrate]
# Example: ./scripts/optimize-videos.sh public/videos/BS2026.mp4 /tmp/BS2026.mp4 750k
set -euo pipefail

IN="${1:?usage: optimize-videos.sh <input> <output> [video_bitrate]}"
OUT="${2:?usage: optimize-videos.sh <input> <output> [video_bitrate]}"
VBIT="${3:-800k}"

command -v ffmpeg >/dev/null || { echo "✗ ffmpeg not found" >&2; exit 2; }

LOGDIR="${TMPDIR:-/tmp}/ffmpeg-passlogs-$$"
mkdir -p "$LOGDIR"

echo "→ pass 1/2  $IN ($VBIT) …"
ffmpeg -y -hide_banner -loglevel error -i "$IN" \
  -vf "scale='min(1280,iw)':-2" \
  -c:v libx264 -preset slow -profile:v high -b:v "$VBIT" \
  -pass 1 -passlogfile "$LOGDIR/pass" -an -f null /dev/null

echo "→ pass 2/2  $IN ($VBIT) …"
ffmpeg -y -hide_banner -loglevel error -i "$IN" \
  -vf "scale='min(1280,iw)':-2" \
  -c:v libx264 -preset slow -profile:v high -b:v "$VBIT" \
  -pass 2 -passlogfile "$LOGDIR/pass" \
  -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 96k "$OUT"

rm -f "$LOGDIR"/pass*
echo "✓ $(du -h "$IN" | cut -f1) → $(du -h "$OUT" | cut -f1)  ($OUT)"
