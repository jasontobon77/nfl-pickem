import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// This route must use the SERVICE ROLE key (server-only, never exposed to
// the browser) because it writes to `games` and grades `picks`, both of
// which are locked down to read-only for normal users via RLS.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

const REGULAR_SEASON_WEEKS = 18;
const SEASON_TYPE_REGULAR = 2; // ESPN: 1 = preseason, 2 = regular season, 3 = postseason

export const dynamic = 'force-dynamic'; // never cache — this must hit ESPN live
export const runtime = 'nodejs';
export const maxDuration = 60; // pulling 18 weeks needs more than the 10s default

// Optional shared-secret check so this endpoint can't be hit by randoms.
// Set CRON_SECRET in your env and call the route with
// `Authorization: Bearer <CRON_SECRET>` from your scheduler (e.g. cron-job.org).
function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — open endpoint (fine for local/dev)
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

// NFL seasons are labeled by the year they START in (the "2026 season" runs
// Sept 2026 -> Feb 2027). If it's currently Jan or Feb, we're still inside
// the season that started the previous calendar year.
function currentSeasonYear() {
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan
  const year = now.getFullYear();
  return month <= 1 ? year - 1 : year;
}

// Parses one ESPN scoreboard response into our `games` row shape.
function parseEvents(events, fallbackWeek) {
  return events.map((event) => {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];

    const home = competitors.find((c) => c.homeAway === 'home');
    const away = competitors.find((c) => c.homeAway === 'away');

    const statusName =
      event.status?.type?.name ??
      competition?.status?.type?.name ??
      'STATUS_SCHEDULED';

    const homeScore = parseInt(home?.score ?? '0', 10) || 0;
    const awayScore = parseInt(away?.score ?? '0', 10) || 0;

    const isFinal = statusName === 'STATUS_FINAL';
    const winner = isFinal
      ? homeScore > awayScore
        ? home?.team?.abbreviation
        : away?.team?.abbreviation
      : null;

    // Venue — always present in ESPN's payload.
    const venue = competition?.venue;

    // Weather — only populated by ESPN a few days out from kickoff, and
    // generally absent for indoor/dome games or games already played.
    // Note: this lives on the EVENT object, not the competition object.
    const weather = event.weather;

    // Odds/moneyline — only populated once sportsbooks post lines, usually
    // a handful of days before kickoff. `odds` is an array of providers;
    // we just take the first one ESPN gives us. Moneyline values live in a
    // nested moneyline.home/away.close.odds string, e.g. "-198" or "+164".
    const oddsEntry = competition?.odds?.[0];
    const moneylineRaw = oddsEntry?.moneyline;
    const homeMoneylineStr = moneylineRaw?.home?.close?.odds ?? moneylineRaw?.home?.open?.odds ?? null;
    const awayMoneylineStr = moneylineRaw?.away?.close?.odds ?? moneylineRaw?.away?.open?.odds ?? null;

    return {
      id: event.id,
      week: event.week?.number ?? fallbackWeek,
      home_team: home?.team?.abbreviation ?? 'UNK',
      away_team: away?.team?.abbreviation ?? 'UNK',
      home_score: homeScore,
      away_score: awayScore,
      winner,
      status: statusName,
      kickoff_time: event.date, // ISO string, matches timestamptz
      venue_name: venue?.fullName ?? null,
      venue_city: venue?.address?.city ?? null,
      venue_state: venue?.address?.state ?? null,
      indoor: venue?.indoor ?? false,
      weather_condition: weather?.displayValue ?? null,
      weather_temp: weather?.temperature ?? null,
      home_moneyline: homeMoneylineStr ? parseInt(homeMoneylineStr, 10) : null,
      away_moneyline: awayMoneylineStr ? parseInt(awayMoneylineStr, 10) : null,
      odds_details: oddsEntry?.details ?? null,
    };
  });
}

async function fetchWeek(week, year) {
  const url = `${ESPN_SCOREBOARD_URL}?week=${week}&seasontype=${SEASON_TYPE_REGULAR}&year=${year}`;
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    console.error(`[fetch-scores] week ${week} request failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const events = data?.events ?? [];
  return parseEvents(events, week);
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const startedAt = Date.now();
    const year = currentSeasonYear();

    // ---- 1. Pull every regular-season week in parallel --------------------
    const weekNumbers = Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1);
    const weekResults = await Promise.all(weekNumbers.map((w) => fetchWeek(w, year)));
    const games = weekResults.flat();

    if (games.length === 0) {
      return NextResponse.json({ message: 'No events returned by ESPN.', updated: 0 });
    }

    // ---- 2. Upsert all games in one round trip -----------------------------
    const { error: upsertError } = await supabaseAdmin
      .from('games')
      .upsert(games, { onConflict: 'id' });

    if (upsertError) {
      throw new Error(`Supabase upsert (games) failed: ${upsertError.message}`);
    }

    // ---- 3. Grade picks for any games that are now final -------------------
    // Pull every pick for finished games, work out in memory which ones have a
    // missing or wrong is_correct, and update only those in a few batches. This
    // keeps the run fast no matter how deep into the season we are (cron-job.org
    // gives each request 30 seconds). It still re-checks every finished game on
    // every run, so a hand-edited pick gets re-graded automatically.
    const finalGames = games.filter((g) => g.status === 'STATUS_FINAL' && g.winner);
    const winnerByGame = new Map(finalGames.map((g) => [g.id, g.winner]));
    const finalIds = finalGames.map((g) => g.id);

    const markCorrect = [];
    const markIncorrect = [];

    if (finalIds.length > 0) {
      const pageSize = 1000;
      let from = 0;

      while (true) {
        const { data: picks, error: picksError } = await supabaseAdmin
          .from('picks')
          .select('id, game_id, picked_team, is_correct')
          .in('game_id', finalIds)
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);

        if (picksError) {
          throw new Error(`Reading picks failed: ${picksError.message}`);
        }

        for (const pick of picks) {
          const shouldBeCorrect = pick.picked_team === winnerByGame.get(pick.game_id);
          if (pick.is_correct !== shouldBeCorrect) {
            (shouldBeCorrect ? markCorrect : markIncorrect).push(pick.id);
          }
        }

        if (picks.length < pageSize) break;
        from += pageSize;
      }
    }

    const updateInChunks = async (ids, value) => {
      const chunkSize = 100;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const { error: updateError } = await supabaseAdmin
          .from('picks')
          .update({ is_correct: value })
          .in('id', ids.slice(i, i + chunkSize));

        if (updateError) {
          throw new Error(`Grading update failed: ${updateError.message}`);
        }
      }
    };

    await updateInChunks(markCorrect, true);
    await updateInChunks(markIncorrect, false);

    return NextResponse.json({
      message: 'Full-season scores synced successfully.',
      seasonYear: year,
      weeksSynced: REGULAR_SEASON_WEEKS,
      gamesUpdated: games.length,
      finalGames: finalGames.length,
      picksGraded: markCorrect.length + markIncorrect.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[fetch-scores] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
