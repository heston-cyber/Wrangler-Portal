# Backups (Wrangler Portal D19)

## What runs
- **Every Sunday at 3:43 am (Oklahoma City),** `.github/workflows/backup.yml` exports the live database (every table, plus Convex file storage).
- The export is **encrypted with AES-256**, using a passphrase only Heston holds.
- It's uploaded to a **private Bunny storage zone** as `convex/prod/YYYY-MM-DD.zip.enc`, and the upload is checked by size.
- The newest **12** copies are kept (about three months).
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
1. **Once only:** in the Convex dashboard, open the **development** deployment › Settings › Environment variables and add `W9_STRIP_OK` with that deployment's own name as the value (the first part of its address, `<name>.convex.cloud`). Never add it to live.
2. GitHub › Actions › **Convex dev (practice runs)** › Run workflow, `fn` = `migrations:stripW9s` (the workflow fills in the deployment's name). It prints how many W-9s it cleared.
3. The script refuses to run unless both the name it's given and `W9_STRIP_OK` match the deployment it's on, so it can't clear live's W-9s.

## How long a deleted W-9 stays in a backup
Deleting a W-9 (a vendor replaces it, a business removes a vendor's form, or a business deletes its data) removes it from live at once. Copies already taken stay in the encrypted backups until they're pruned: **up to 12 weeks** (the 12 newest weekly copies are kept), and up to **7 days** in Convex's own dashboard backups. Only Heston's passphrase opens the weekly copies. If someone asks for their W-9 to be gone sooner, delete the weekly copies that hold it from the Bunny storage zone by hand.
