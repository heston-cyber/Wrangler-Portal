# Wrangler Portal — rules for every build session

Wrangler Portal is Wrangler Productions' client portal: one app for Review, Sign (Docs), the Inbox, projects, payments, CRM, proposals, vendors and more. Live at app.wranglerportal.com. Preview at preview.wranglerportal.com.

## Who does what
- **Heston** is the owner and approves everything: scope, designs, decisions (D-numbers) and every live change.
- **This build chat** writes all code, tests and deploys. It never edits the Figma file or the design chat's notes.
- **The design chat** works only in Figma. Build only screens Heston approved in the Design Log, and match the frames.

## Where the plan lives
The plan isn't in this repo. Read it from Heston's vault (`AiOS/Wrangler Portal/`) when his Mac is linked, or from the claude.ai Builds project copies (`claude/wrangler-portal-<name>.md`):
- **Master Plan**: phases, tests, decisions. The source of truth.
- **Design Log** and **Screen Map and Content**: read at the start of every phase and before building any screen.
- **Design Direction**: update it at the start and end of every phase.

## Rules every phase follows
1. **Read back, then build.** Each phase or step starts with a short plan: what you understand, the steps, the tests and the decisions. Build nothing until Heston says "approved".
2. **Test before moving on.** Numbered tests with a pass line; results go in the Master Plan. A failure gets a real fix, not a patch.
3. **Nothing reaches a client without Heston's OK** in this chat: emails, Inbox notes, invoices, contracts, anything published.
4. **Keys and secrets never go in chat or in the repo.** Heston pastes them into the dashboards.
5. **The privacy test grows every phase.** `tests/access.test.ts` calls every public function as nobody, a stranger with an account, and an invited client, and fails the build if a function isn't classified; `tests/pageQueries.test.ts` checks every query the pages fire. Vendor and other-business checks live in each module's own tests for now (extending access.test.ts to vendor and other-business passes is an open item in the Master Plan).
6. **Independent review** of access and money code at the end of each phase that touches them (use `independent-reviewer`).
7. **Back up before any data change** (`convex export`, kept in Dropbox).
8. **Stripe test mode first** for anything that touches money.
9. **Signing steps stay exactly as built and tested.** Any change to how someone signs re-runs Sign's full signing tests.
10. **Report anything ambiguous.** Don't assume.
11. **One chat at a time** changes this repo.

## How work reaches the live site
- Work on a phase branch. Pushing it updates the preview.
- **Going live = merging into `main`.** Only on Heston's "go". The permission settings ask before any push to `main`, any pull-request call (`gh pr merge`, `gh api …pulls…`) and any workflow run.
- Commit after every step. Git is the safety net.

## Commands (from package.json and .github/workflows/tests.yml)
- **Install:** `npm ci`
- **Unit tests (all of them, including the privacy test):** `npx vitest run` (same as `npm test`)
- **Privacy test on its own:** `npx vitest run tests/access.test.ts tests/pageQueries.test.ts`
- **Type check, backend:** `npx tsc --noEmit -p convex`
- **Type check, site:** `npm run typecheck` (`tsc -p tsconfig.json`)
- **Site build (type check + build):** `npm run build`
- CI runs the unit tests, the backend type check and `npm run build` on every push and pull request (`tests.yml`); Deploy runs them again before anything goes live.

## Which model for what
Claude can't switch the main session's model, so **say at the start of each step which model and effort the plan calls for**, and Heston switches it.

| Work | Model, effort |
|---|---|
| Read-back plans | Opus, high |
| Screens from approved frames, emails, copy | Sonnet, medium |
| Access, roles and tenant isolation; upload links; connector keys | Opus, high |
| Money (Stripe, payments, invoices, 1099 totals) | Opus, high, Stripe test mode first |
| W-9s and other tax or personal data | Opus, xhigh, then `security-reviewer` |
| Bug fixes | Sonnet, high → same failure twice: Opus, high → twice again: `security-reviewer` (Fable) |
| Go-live merges and live checks | Sonnet, high, on Heston's "go" |
| Reports, Design Direction updates | Sonnet, medium |

## Subagents
- `test-runner` (Sonnet): runs the tests and reports. Use it after every step.
- `independent-reviewer` (Opus, xhigh): reviews access and money code it didn't write. Required at the end of each phase that touches them.
- `security-reviewer` (Fable): W-9s and vendor payments in Phase 3c, the Phase 6 sweep, and bugs Opus couldn't fix twice.
