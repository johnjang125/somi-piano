#!/bin/sh
# Basic Pitch 묶음 파일과 모델을 pages/bp/에 만든다. 인자: npm 설치 폴더(@spotify/basic-pitch, @tensorflow/tfjs, esbuild)
set -e
NM="$1/node_modules"; OUT="$(dirname "$0")/../pages/bp"; mkdir -p "$OUT"
NODE_PATH="$NM" "$NM/.bin/esbuild" "$(dirname "$0")/bp-entry.js" --bundle --minify --format=iife --platform=browser --target=es2019 --outfile="$OUT/basic-pitch.js" --log-level=warning
cp "$NM/@spotify/basic-pitch/model/model.json" "$NM/@spotify/basic-pitch/model/group1-shard1of1.bin" "$OUT/"
cp "$NM/@spotify/basic-pitch/LICENSE" "$OUT/LICENSE-basic-pitch.txt"
ls -la "$OUT"
