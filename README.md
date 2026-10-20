# Wrangler Review

Wrangler Productions' video review portal: frame-exact notes (single frames, ranges, drawings, voice) that Claude reads and turns into DaVinci Resolve markers.

- Site: GitHub Pages at https://review.wranglerportal.com
- Backend: Convex (`convex/`)
- Video: Bunny Stream
- Build plan: `AiOS/Ai (Skills, Docs, Maps)/Wrangler Review Portal Program/Wrangler Review Portal — Build Plan.md` in Heston's vault

## Phase 0 lab
- `lab/frametest.html`: frame-accuracy test. `?bunny=<video id>` plays a Bunny stream; add `&mp4=720` for Bunny's MP4 copy.

## Secrets
Never commit keys. Backend keys live in Convex environment variables; the deploy key lives in the GitHub secret `CONVEX_DEPLOY_KEY`.
