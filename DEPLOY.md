# Deploy merged main to Vercel

1. Import this GitHub repository into Vercel. Use the repository root (not `backend`) as Root Directory.
2. Select **Other** for Framework Preset. The committed `vercel.json` sets Build Command to `npm run build` and Output Directory to `public`.
3. Set **Production Branch** to `main` in the project's Git settings. Deploy the merged commit on `main` in the chal-48 fork.
4. Add environment variables from `backend/.env.example` to Vercel for Production and Preview. Keep the Supabase service role key on the server; never put it in HTML or browser JavaScript.
5. Use a hosted PostgreSQL database reachable from Vercel, containing the existing tables and data. A database on your laptop is not reachable as `localhost` from Vercel. Use the provider's connection string, preferably its pooler, and its TLS requirements. `DB_SSL=true` verifies the server certificate.
6. In the same Supabase project, create a **private** Storage bucket named `slips` (or set `SUPABASE_STORAGE_BUCKET`). Allow JPEG, PNG, PDF up to 4 MB. Old local upload files must be migrated separately; they are not copied into the deployed site.
   Run `backend/migrations/001-password-reset.sql` in the database SQL editor before using password reset. Set `APP_URL` to your deployed URL, `RESEND_API_KEY` to your Resend API key, and `RESET_EMAIL_FROM` to an address on a verified sending domain. Resend's setup reference: https://resend.com/docs/api-reference/emails/send-email
7. Deploy, then check `/api/health`, `/index.html`, login, admin navigation, booking, upload, and admin slip preview.

The build copies only browser assets into `public/`. `/api/*` goes to the Express function in `api/index.js`. Backend source and `.env` are not served as static files. Vercel's request size limit is 4.5 MB, so slip uploads are limited to 4 MB including room for multipart overhead.

The Admin still uses the existing Supabase browser client and database policies. Its project must match the PostgreSQL database configured for the Backend. RLS permissions must be configured for the existing admin operations. This deployment change does not replace that authorization design.

## Local run

```powershell
npm.cmd install
npm.cmd start
```

Set local secrets in `backend/.env` first. Open http://localhost:3000/index.html. Re-run the build (or restart `npm start`) after frontend edits.

## Existing features to verify separately

- The driver page still uses mock trip data.
- Password reset uses PostgreSQL and an email link through Resend. Links expire after 15 minutes and can be used once. Requests for the same account have a one-minute cooldown stored in PostgreSQL. Missing email configuration returns an explicit service-unavailable message.
- The merged main includes the existing history and driver pages.

References: https://vercel.com/docs/functions/runtimes/node-js and https://vercel.com/docs/project-configuration/vercel-json
