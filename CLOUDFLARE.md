# Cloudflare deployment

The Cloudflare Worker serves the Vite-built website, API, and R2 media files.
Lecture metadata uses D1. Audio translation uses the OpenAI Whisper translation
endpoint and returns timestamped English captions. No MongoDB is used.

## First deployment

1. Run `npm run cloudflare:login` and complete Cloudflare's browser sign-in.
2. Run `npm run cloudflare:d1:create` and replace the placeholder
   `database_id` in `wrangler.jsonc` with the ID printed by Wrangler.
3. Create the `signbridge-lecture-media` R2 bucket in Cloudflare, or choose an
   unused bucket name and update `wrangler.jsonc`.
4. In Cloudflare Worker settings, add `OPENAI_API_KEY` as a secret. Do not put
   the key in `wrangler.jsonc` or commit it to source.
5. Run `npm run cloudflare:d1:migrate`.
6. Run `npm run cloudflare:deploy`.

The translation API is limited to five requests per IP per minute and accepts
media files up to 25 MB, matching the OpenAI audio translation limit. SignBridge
shows translated captions and ISL hand signs in sync with media playback.

## Local Cloudflare preview

Run `npm run cloudflare:dev`. The Worker serves the built site and uses local
Wrangler D1/R2 emulation. Add an untracked `.dev.vars` file at the project root
with `OPENAI_API_KEY=...` only if testing OpenAI translation locally. Never
commit `.dev.vars`.
