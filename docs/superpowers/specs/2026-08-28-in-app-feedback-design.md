# In-app feedback — design

Closes #63. An operator-visible control that collects a problem report or a feature
request in plain language and files it as a GitHub issue without the reporter
leaving the app.

Audience is non-technical volunteers. The dialog asks two things — *which kind* and
*what* — and shows exactly what else it will attach. Nothing the user authored in
Helm (lyrics, scripture, message text, file paths) is ever included.

## Entry points

- A third icon button in the operator header, right of the light/dark and settings
  buttons (`src/renderer/operator/Header.tsx`, reusing `themeBtnStyle`). Speech-bubble
  icon added to `src/renderer/shared/icons.tsx`. `title="Send feedback"`.
- Help → "Report a Problem…" is renamed "Send Feedback…" and opens the same dialog
  (main sends `feedback:open` to the renderer) instead of launching the browser.
- `App.tsx` owns `feedbackOpen` state exactly like `settingsOpen`; hotkeys are
  suppressed while it is open.

## Dialog (`FeedbackModal.tsx`)

`ModalShell`, `width="520px"`, `variant="card"`.

1. **Heading:** "What would make Helm better?" Sub-line: "Tell us about a problem or
   something you'd like. It goes straight to the team."
2. **Type** — two pills, default *Something I'd like*:
   - *Something's wrong* → template `bug`
   - *Something I'd like* → template `feature`
3. **Text** — one textarea, 4000-char cap with a counter that appears past 3500.
   Placeholder by type:
   - bug: "What happened, and what did you expect instead?"
   - feature: "What would you like Helm to do? When would you use it?"
4. **Included with your report** — a collapsed row listing the diagnostic context
   (below). Expands to a read-only list. Copy: "We attach a few details so we can
   reproduce what you saw. Nothing you've typed into Helm is included."
5. **Buttons:** Cancel · **Send**. Send disabled until text is non-blank.

States:
- `sending` — Send shows a spinner label, inputs disabled.
- `sent` — body swaps to "Sent — thank you." with the issue link (opens externally
  via `<a target="_blank">`, the existing pattern); modal closes on Done or after 4 s.
- `failed` — inline line: "Couldn't send right now." with **Open on GitHub instead**
  (prefilled URL fallback, see below) and Try again. Text is preserved.

Grammar: undo-not-confirm doesn't apply (nothing destructive); fixed footprint —
the card does not resize between states; theme tokens only (`inputBg`, `border`,
`faint`, `accent`).

## Diagnostic context

`FeedbackContext` (shared type):

```ts
{ version: string; os: string; arch: string; displays: number;
  hasBibles: boolean; hasSongs: boolean }
```

`os` uses `osLabel(platform, release)` from `src/main/feedback.ts`. Collected in main
via IPC `feedback:context`; never assembled in the renderer.

## Main process (`src/main/feedback.ts`, `ipc.ts`)

- `feedback:context` → `FeedbackContext`.
- `feedback:send({ type, text, context })` → `{ ok: true, number, url } | { ok: false, reason: 'offline' | 'rejected' | 'unconfigured' }`.
  Main performs the `fetch` to the proxy so the renderer never sees the endpoint.
  15 s timeout. Never throws to the UI.
- Proxy URL comes from `FEEDBACK_ENDPOINT` baked at build time; when unset the result
  is `unconfigured` and the dialog shows the GitHub fallback directly (Send button
  reads **Continue on GitHub**). This keeps the PR shippable before Cloudflare exists.
- `feedbackUrl(type, text, context)` extends `reportProblemUrl`: maps onto the
  template ids (`bug_report.yml`: `version`, `os`, `what-happened`;
  `feature_request.yml`: `idea`). Truncates text at 1500 chars with
  "… (trimmed — paste the rest below)" to stay under URL limits.
- `buildIssue(type, text, context)` → `{ title, body, labels }` — shared with the
  worker via `src/shared/feedbackIssue.ts` so the in-app fallback and the proxy render
  identical issues. Title = first line of text, ≤ 72 chars, prefixed "Feedback:".

## Proxy (`feedback-worker/`)

Cloudflare Worker, TypeScript, wrangler. Free tier.

- `POST /v1/feedback` JSON `{ type, text, context }`.
- Validate: `type ∈ {bug, feature}`, `text` 1–4000 chars, `context` keys whitelisted
  and length-capped; anything else → 400.
- Rate limit: 5 per IP per hour via KV (`RATE`). Over → 429.
- Requires header `X-Helm-Client: <build-time constant>`. This is obfuscation against
  drive-by posting, not authentication — documented as such.
- Files the issue with `GITHUB_TOKEN` (fine-grained PAT, `issues: write` on
  `chase-codes/helm` only) using `buildIssue`. Labels: `feedback` + `bug` |
  `enhancement`. Returns `{ number, url }`.
- No reporter identity is stored or sent (see follow-ups).
- `feedback-worker/README.md`: create PAT, `wrangler kv namespace create RATE`,
  `wrangler secret put GITHUB_TOKEN`, `wrangler deploy`, then set
  `FEEDBACK_ENDPOINT` in the release workflow.

## Follow-ups (filed as issues, not built here)

1. **Cloudflare setup** — account, worker deploy, PAT, `FEEDBACK_ENDPOINT` in CI.
   Until done, released builds use the GitHub fallback.
2. **Reporter identity** — onboarding collects an email or assigns an app id so we
   can reply. Must stay out of the public issue body (private store keyed by issue
   number, or a private mirror repo). Needs a security review first.
3. **Public-repo privacy review** — what a feedback issue may contain, redaction
   rules, and who can see the worker's KV.

## Testing

- Renderer (`FeedbackModal.test.tsx`): type toggle changes placeholder; Send disabled
  on blank; success path shows link; failure shows fallback link; `unconfigured`
  shows Continue on GitHub; context row lists the six fields.
- Main (`feedback.test.ts`): `feedbackUrl` for both templates incl. truncation marker;
  `buildIssue` title/body/labels.
- Worker (`feedback-worker/test`): validation rejects bad shapes; rate limiter with a
  fake KV; happy path calls GitHub with the expected body (fetch mocked).
- Manual: packaged build on macOS and Windows sends (once the worker exists) and
  falls back cleanly with the network off.
