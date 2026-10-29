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
