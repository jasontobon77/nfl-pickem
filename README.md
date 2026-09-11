# Family NFL Pick'Em

A free, production-ready NFL Pick'Em web app: Next.js 14 (App Router) + Tailwind CSS + Supabase.

## What's included

```
nfl-pickem/
├── app/
│   ├── layout.js                        # fonts + root layout
│   ├── page.js                          # the whole app: auth, picks, leaderboard, AI recap
│   ├── globals.css                      # Tailwind + scoreboard theme tokens
│   └── api/
│       ├── cron/fetch-scores/route.js   # pulls live scores from ESPN, upserts games, grades picks
│       └── generate-recap/route.js      # optional: calls Claude for the AI recap
├── lib/
│   └── supabaseClient.js                # browser Supabase client (anon key)
├── sql/
│   └── schema.sql                       # tables + RLS policies
├── vercel.json                          # cron schedule (every 5 min)
├── tailwind.config.js
├── postcss.config.js
├── next.config.js
├── package.json
└── .env.local.example
```

## 1. Set up Supabase

1. Create a project at supabase.com.
2. Open the SQL editor and run `sql/schema.sql`.
3. Under **Authentication > Providers**, make sure Email is enabled. For the simplest setup, disable
   "Confirm email" in dev, or just click the magic link that gets emailed to you — no password needed.
4. Under **Project Settings > API**, copy the Project URL, `anon` public key, and `service_role` key.

## 2. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — used by the browser client.
- `SUPABASE_SERVICE_ROLE_KEY` — **server only**, used exclusively inside
  `app/api/cron/fetch-scores/route.js` to write scores and grade picks (this bypasses RLS, so never
  expose it to the client or prefix it with `NEXT_PUBLIC_`).
- `CRON_SECRET` — optional but recommended; locks the cron route down to requests carrying
  `Authorization: Bearer <CRON_SECRET>`.
- `ANTHROPIC_API_KEY` — optional. Only needed if you want "Generate AI Recap" to call a real model.
  Without it, the button falls back to a free, client-generated text template — the feature still works,
  it just won't be written by Claude.

## 3. Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`. Sign in with an email, pick a display name, then hit
`http://localhost:3000/api/cron/fetch-scores` once (in the browser or with curl) to pull in the current
week's games before you try picking.

## 4. Deploy

Push to GitHub and import into Vercel. Add the same environment variables in the Vercel project settings.
`vercel.json` schedules `/api/cron/fetch-scores` to run every 5 minutes automatically — Vercel will
inject the `Authorization: Bearer <CRON_SECRET>` header for you as long as `CRON_SECRET` is set in your
project's environment variables.

## How the pieces fit together

- **Auth**: Supabase email magic links. On first sign-in, the user picks a display name, which is
  upserted into `profiles`.
- **Picks**: `picks` has a unique `(user_id, game_id)` constraint, so selecting a team is a single
  `upsert`. The UI double-checks the kickoff time client-side, and RLS double-checks it again
  server-side (see the `insert`/`update` policies in `sql/schema.sql`), so a locked pick can't be
  changed even by someone poking the API directly.
- **Scores**: the cron route is the only writer for `games` and the only thing allowed to set
  `picks.is_correct`, since it runs with the service-role key. Nothing about the schema depends on a
  specific cron provider — you can trigger that route from Vercel Cron, GitHub Actions, or a plain curl
  in crontab.
- **Leaderboard**: computed client-side from three simple selects (`profiles`, `games`, `picks`) rather
  than a SQL view, to keep the schema easy to read and change. If your family pool gets huge, that logic
  is a good candidate to move into a Postgres view later.
- **AI recap**: entirely optional server call; degrades gracefully to a local template so the app stays
  free to run with zero external dependencies if you don't want to add an Anthropic key.

## Notes / things to double check before game day

- ESPN's scoreboard endpoint is undocumented and public — it can change shape without notice. The parser
  in `fetch-scores/route.js` reads defensively (optional chaining, fallbacks) but keep an eye on it.
- Team abbreviations are ESPN's (e.g. `WSH`, `LAR`), matched against the `TEAM_NAMES` map in `app/page.js`
  for display. Add any missing abbreviations there if ESPN changes one.
- This starter doesn't include team logos — swap the abbreviation badge in `TeamButton` for an `<img>`
  pointed at your logo source of choice if you want crests instead of text.
