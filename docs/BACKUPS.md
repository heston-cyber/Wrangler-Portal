# Backups (Wrangler Portal D19)

## What runs
- **Every Sunday at 3:43 am (Oklahoma City),** `.github/workflows/backup.yml` exports the live database (every table, plus Convex file storage).
- The export is **encrypted with AES-256**, using a passphrase only Heston holds.
- It's uploaded to a **private Bunny storage zone** as `convex/prod/YYYY-MM-DD.zip.enc`, and the upload is checked by size.
- **Deploy also takes one** just before every live deploy, and one can be run by hand (below). Copies are named by day, so a second one on the same day replaces that day's.
- The newest **12 copies** are kept, counted as files, not weeks. With go-lives most days that reaches back only two to four weeks; in a quiet stretch (weekly copies only) about three months. Old copies are removed only when a new copy uploads, so if the backups stop running, nothing is removed either.
- **What's not in the export:** code (that's in Git), environment variables (keep them in the password manager) and scheduled jobs that haven't run yet.
- **Videos and stills are already on Bunny** and aren't part of this export.
- Convex's own dashboard backups still work as before: two at a time on the Starter plan, kept 7 days.

## Running one by hand
GitHub › Actions › **Weekly backup to Bunny** › Run workflow. Choose `dev` (practice) or `prod` (live).

## Restoring
1. Download the copy from the Bunny storage zone (Bunny dashboard › Storage › the zone › File manager).
2. Decrypt it:
   ```
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in 2026-11-01.zip.enc -out backup.zip
   ```
   It asks for the passphrase.
3. **Practise on dev first.** Import into the development deployment:
   ```
   npx convex import --deployment <dev-deployment> --replace-all backup.zip
   ```
   Check it there.
4. **Live: only on Heston's OK, and after a fresh Convex dashboard backup.** Run the same command with `--prod`.
   - `--replace-all` **replaces every table's data.** That's what a restore is.
   - Files in `_storage` are uploaded too.

## After restoring a live copy onto dev: clear the W-9s (required)
A live backup holds vendors' real W-9s (tax forms with names, addresses and tax ID numbers). Restored onto dev, they would show on the preview, which is less protected than live. So, every time a live copy goes onto dev, before anyone opens the preview:
1. **Once only:** in the Convex dashboard, open the **development** deployment › Settings › Environment variables and add `W9_STRIP_OK` with that deployment's own name as the value (the first part of its address, `<name>.convex.cloud`). **Never add it to live:** Deploy refuses to ship while live has it.
2. GitHub › Actions › **Convex dev (practice runs)** › Run workflow. Pick the branch that's on the preview (so dev keeps the preview's backend; picking `main` puts live's code on dev). Set `fn` = `migrations:stripW9s`; the workflow fills in the deployment's name.
3. The run first passes the tests and deploys that branch's backend to dev, then clears every vendor's W-9, plus W-9 files no vendor points at any more (for example ones a business deletion was holding). It prints both counts.
4. **If the run fails** (for example the restored data doesn't fit the branch's backend), the W-9s are still on dev: don't open the preview until a run succeeds.
5. The script refuses to run unless both the name it's given and `W9_STRIP_OK` match the deployment it's on, so it can't clear live's W-9s.
6. Delete the decrypted `backup.zip` from step 2 of Restoring once the import is done.

## How long a W-9 stays after it's deleted
**On live:**
- A vendor uploading a new W-9 removes the old one at once.
- A business that deletes its data: nothing goes for the 60-day wait (it can still cancel), then its vendors' W-9 files are kept **30 more days** with its safety-net export, then deleted.
- There's no button for a business to remove a vendor's W-9 on its own; archiving a vendor keeps it.

**In copies, after it's gone from live:**
- **Weekly and pre-deploy backups (Bunny, `convex/prod/`):** until the last copy taken before it went is pruned: as above, two to four weeks when go-lives are frequent, up to about three months in a quiet stretch, and longer if backups stop running.
- **Dev backups (Bunny, `convex/dev/`):** taken only by hand, so they're pruned only when another dev backup runs. A dev copy taken while dev held a live restore keeps its W-9s until then.
- **The dev deployment itself:** after a live restore, until `migrations:stripW9s` runs (above).
- **Convex's own dashboard backups:** up to 7 days.
- **`convex export` copies kept in Dropbox before data changes (CLAUDE.md rule 7):** not covered by any pruning here. Whether they include stored files and how long they're kept is Heston's to decide.

**If someone asks for their W-9 to be gone sooner:**
1. Make sure it's gone from live first (they upload a replacement, or the business's deletion has finished).
2. Run a fresh backup of live by hand and check it uploaded.
3. Only then delete the older copies that still hold it, from the Bunny storage zone (`convex/prod/` and `convex/dev/`). Never delete every copy: the fresh one from step 2 is your restore point.
