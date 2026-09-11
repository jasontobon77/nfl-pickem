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
    const finalGames = games.filter((g) => g.status === 'STATUS_FINAL' && g.winner);

    let gradedCount = 0;

    for (const game of finalGames) {
      // Picks that match the winner -> correct
      const { data: correctPicks, error: correctErr } = await supabaseAdmin
        .from('picks')
        .update({ is_correct: true })
        .eq('game_id', game.id)
        .eq('picked_team', game.winner)
        .select('id');

      if (correctErr) {
        throw new Error(`Grading (correct) failed for ${game.id}: ${correctErr.message}`);
      }

      // Picks that don't match the winner -> incorrect
      const { data: incorrectPicks, error: incorrectErr } = await supabaseAdmin
        .from('picks')
        .update({ is_correct: false })
        .eq('game_id', game.id)
        .neq('picked_team', game.winner)
        .select('id');

      if (incorrectErr) {
        throw new Error(`Grading (incorrect) failed for ${game.id}: ${incorrectErr.message}`);
      }

      gradedCount += (correctPicks?.length ?? 0) + (incorrectPicks?.length ?? 0);
    }

    return NextResponse.json({
      message: 'Full-season scores synced successfully.',
      seasonYear: year,
      weeksSynced: REGULAR_SEASON_WEEKS,
      gamesUpdated: games.length,
      finalGames: finalGames.length,
      picksGraded: gradedCount,
    });
  } catch (err) {
    console.error('[fetch-scores] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
