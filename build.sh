#!/bin/sh

set -e

npm --prefix ./injection run build
npm --prefix ./popup run build
mkdir -p build
rm -rf build/*
cp -r popup/build/* build
cp injection/dist/main.js build/injection.js
