# Wrangler Portal

Wrangler Productions' client portal (repo renamed from Wrangler-Review on Oct 28, 2026). It holds **Wrangler Review** (video review) and **Wrangler Sign** (e-signature), with more modules to come; the plan lives in Heston's vault at `AiOS/Wrangler Portal/Wrangler Portal — Master Plan.md`.

- Portal: https://app.wranglerportal.com (review.wranglerportal.com forwards here) · Signing: https://sign.wranglerportal.com

## Wrangler Review

Wrangler Productions' video review portal: frame-exact notes (single frames, ranges, drawings, voice) that Claude reads and turns into DaVinci Resolve markers.

- Site: GitHub Pages at https://app.wranglerportal.com (was review.wranglerportal.com until Oct 28)
- Backend: Convex (`convex/`)
- Video: Bunny Stream
- Build plan: `AiOS/Ai (Skills, Docs, Maps)/Wrangler Review Portal Program/Wrangler Review Portal — Build Plan.md` in Heston's vault

## Phase 0 lab
- `lab/frametest.html`: frame-accuracy test. `?bunny=<video id>` plays a Bunny stream; add `&mp4=720` for Bunny's MP4 copy.

## Secrets
Never commit keys. Backend keys live in Convex environment variables; the deploy key lives in the GitHub secret `CONVEX_DEPLOY_KEY`.
