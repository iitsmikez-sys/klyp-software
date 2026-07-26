#!/bin/sh
# Downloads yt-dlp's standalone Linux binary during `npm ci`. Runs as an npm
# postinstall hook — deliberately NOT a custom Railpack build step, since
# railpack.json step/deploy.inputs overrides broke Railway's default build
# graph (it stopped finding app/). Hooking into npm's own lifecycle instead
# needs zero knowledge of Railpack's internal step names and rides along on
# the already-working default pipeline.
#
# Runs unconditionally (no DEPLOYMENT_TARGET gate): that's a runtime env var
# and isn't confirmed to be visible during the build phase, so gating on it
# here risked silently skipping the download on every build, Railway
# included. Downloading it on the Vercel frontend build too is harmless —
# a few unused MB, since DEPLOYMENT_TARGET still gates those routes at
# runtime. The `|| true` in package.json's postinstall keeps this non-fatal
# everywhere, so a network blip during build can't break the build; worst
# case is the existing clear runtime error ("yt-dlp is not installed").
set -e

echo "[install-yt-dlp] downloading yt-dlp standalone binary..."
mkdir -p bin
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod +x bin/yt-dlp
echo "[install-yt-dlp] done: $(ls -la bin/yt-dlp)"
