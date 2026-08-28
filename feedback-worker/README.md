# helm-feedback worker

Receives in-app feedback and files it as a GitHub issue so reporters never leave Helm.

## One-time setup
1. Fine-grained PAT (Settings → Developer settings → Fine-grained tokens): repository access **chase-codes/helm** only, permission **Issues: Read and write**. Expiry ≤ 1 year — put the renewal date in your calendar.
2. `cd feedback-worker && npm install`
3. `npx wrangler login`
4. `npx wrangler kv namespace create RATE` → paste the id into `wrangler.toml`.
5. `npx wrangler secret put GITHUB_TOKEN` (the PAT)
6. `npx wrangler secret put CLIENT_KEY` (any long random string, e.g. `openssl rand -hex 24`)
7. `npm run deploy` → note the worker URL.
8. Repo secrets for the release workflow: `HELM_FEEDBACK_ENDPOINT` = `https://<worker>/v1/feedback`, `HELM_FEEDBACK_CLIENT` = the same CLIENT_KEY.
9. Create the `feedback` label on the repo: `gh label create feedback --color 0e8a16 --description "Filed from the in-app feedback dialog"`.

Builds without those secrets fall back to opening a prefilled GitHub issue form.

## What it does not do
- Store anything about the reporter. No identity, no email (see #63 follow-ups).
- Authenticate. `CLIENT_KEY` is in the app binary; it only deters casual abuse. Rate limit is 5/IP/hour.
