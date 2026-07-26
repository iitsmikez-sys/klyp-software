#!/bin/sh
# Downloads yt-dlp's standalone Linux binary during `npm ci` on the
# processing service. Runs as an npm postinstall hook — deliberately NOT a
# custom Railpack build step, since railpack.json step/deploy.inputs
# overrides broke Railway's default build graph (it stopped finding app/).
# Hooking into npm's own lifecycle instead needs zero knowledge of Railpack's
# internal step names and rides along on the already-working default pipeline.
#
# Skipped entirely on the Vercel frontend (DEPLOYMENT_TARGET unset there) —
# the `|| true` in package.json's postinstall also makes this non-fatal
# everywhere, so a transient network blip during build can't break the build;
# worst case is the existing clear runtime error ("yt-dlp is not installed").
set -e

if [ "$DEPLOYMENT_TARGET" != "processing" ]; then
  exit 0
fi

mkdir -p bin
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod +x bin/yt-dlp
