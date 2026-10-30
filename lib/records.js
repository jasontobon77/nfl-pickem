// Turns raw rows (profiles, games, picks) into win/loss records.
// Used by both the Leaderboard and Pick History tabs so they always agree.
//
// Rules:
//  - Only finished games count.
//  - A pick on file always counts, even if the player joined after that game
//    (this keeps hand-entered backfilled picks).
//  - A MISSING pick counts as a loss, but only for games that kicked off after
//    the player joined, so a late joiner isn't charged for earlier weeks.

export function buildRecords(profiles, games, picks) {
  const finalGames = (games ?? []).filter((g) => g.status === 'STATUS_FINAL' && g.winner);

  const pickByKey = new Map();
  for (const p of picks ?? []) {
    pickByKey.set(`${p.user_id}:${p.game_id}`, p.picked_team);
  }

  return (profiles ?? []).map((profile) => {
    const joinedAt = profile.created_at ? new Date(profile.created_at) : null;
    const weeks = {};
    let wins = 0;
    let losses = 0;

    for (const game of finalGames) {
      const pickedTeam = pickByKey.get(`${profile.id}:${game.id}`) ?? null;

      if (pickedTeam === null && joinedAt && new Date(game.kickoff_time) < joinedAt) {
        continue;
      }

      const won = pickedTeam !== null && pickedTeam === game.winner;

      if (!weeks[game.week]) {
        weeks[game.week] = { wins: 0, losses: 0, games: [] };
      }
      const week = weeks[game.week];

      if (won) {
        wins += 1;
        week.wins += 1;
      } else {
        losses += 1;
        week.losses += 1;
      }

      week.games.push({ game, pickedTeam, result: won ? 'win' : 'loss' });
    }

    for (const week of Object.values(weeks)) {
      week.games.sort((a, b) => new Date(a.game.kickoff_time) - new Date(b.game.kickoff_time));
    }

    return {
      userId: profile.id,
      displayName: profile.display_name,
      wins,
      losses,
      weeks,
    };
  });
}
