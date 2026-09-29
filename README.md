# Seedance 2.5 Studio

A Next.js frontend for generating video with the [BytePlus ModelArk](https://docs.byteplus.com/docs/ModelArk) Seedance 2.5 API: enter a prompt, submit a generation task, and watch it poll to completion in the browser.

## Setup

1. Install dependencies: `npm install`
2. Environment variables live in `.env.local` (already created, git-ignored):
   - `BYTEPLUS_API_KEY` — your Ark API key (server-side only, never sent to the browser)
   - `BYTEPLUS_RESOURCE_ID` — reference id for that key; kept for your records, not required by the API's bearer-token auth
   - `BYTEPLUS_API_BASE_URL` — the Ark v3 base URL (defaults to the Southeast Asia endpoint you provided)
   - `NEXT_PUBLIC_BYTEPLUS_DEFAULT_MODEL` — pre-fills the Model ID field; defaults to `dreamina-seedance-2-5-260628`
3. Run the dev server: `npm run dev`, then open [http://localhost:3000](http://localhost:3000)

## About the model id

Confirmed against BytePlus's own docs (`docs.byteplus.com/en/docs/modelark/seedance-2-5`, read 2026-09-29):

| Model | Model ID |
| --- | --- |
| Seedance 2.5 | `dreamina-seedance-2-5-260628` |
| Seedance 2.0 | `dreamina-seedance-2-0-260128` |
| Seedance 2.0 fast | `dreamina-seedance-2-0-fast-260128` |
| Seedance 2.0 mini | `dreamina-seedance-2-0-mini-260615` |

BytePlus can roll out newer dated ids over time — check your account's ModelArk **Models** page if a request comes back with a model-not-found error, and update the Model ID field (or `NEXT_PUBLIC_BYTEPLUS_DEFAULT_MODEL`) accordingly. You can also pass an **endpoint id** here instead of a model id.

## How it works

- `app/page.tsx` — the form + polling UI (client component): prompt, model id, resolution, aspect ratio, duration (or let the model choose), and an advanced section (reference image for image-to-video, output format, priority, seed, camera-fixed, watermark, generate-audio, return-last-frame)
- `app/api/generate/route.ts` — Route Handler that submits a generation task to BytePlus and returns its task id
- `app/api/status/[id]/route.ts` — Route Handler the browser polls every few seconds for task status
- `lib/byteplus.ts` — the only file that talks to the BytePlus REST API directly

The create → poll → done flow follows BytePlus's documented `contents/generations/tasks` pattern: `POST` returns a task id immediately, then `GET .../tasks/{id}` is polled until `status` reaches one of `succeeded`, `failed`, or `cancelled`, at which point `content.video_url` (valid 24h, downloadable up to 100 times) is read from the response and shown in a player with a download link. Parameters are sent as top-level JSON fields — BytePlus calls this the "conventional" method, which is strictly validated and preferred over the legacy `--flag` text-suffix style.

### Known parameter quirks (from the docs)

- `ratio` defaults to `adaptive` for Seedance 2.5/2.0; a fixed `ratio` isn't allowed for video-editing/extension or first-frame image-to-video tasks (the model matches the source video/image instead).
- `duration` defaults to `-1` (model picks a length) for Seedance 2.5/2.0, range `[4, 30]` for 2.5, `[4, 15]` for the 2.0 family.
- `seed` is only documented as supported by Seedance 1.5 pro / 1.0 pro / 1.0 pro fast — 2.5/2.0 may silently ignore it.
- `output_format: "mov"` and `priority` are Seedance 2.5 (and, for priority, 2.0-series) only.
- Not yet wired into this UI, but available in the API: multi-asset "omni reference" input (up to 30 images + 10 video/audio clips on 2.5), video/audio reference inputs, `omni_reference_task_type` for explicit editing/extension tasks, and draft mode. See the [Create a video generation task](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api) and [Seedance 2.5 tutorial](https://docs.byteplus.com/en/docs/modelark/seedance-2-5) docs if you want to extend the form to cover these.

---

Bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app). See the [Next.js documentation](https://nextjs.org/docs) to learn more about the framework itself.
