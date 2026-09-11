'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

const TEAM_NAMES = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills',
  CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns',
  DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs',
  LV: 'Raiders', LAC: 'Chargers', LAR: 'Rams', MIA: 'Dolphins',
  MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SF: '49ers',
  SEA: 'Seahawks', TB: 'Buccaneers', TEN: 'Titans', WSH: 'Commanders',
};

function teamLabel(abbr) {
  if (!abbr) return '—';
  return TEAM_NAMES[abbr] ? `${TEAM_NAMES[abbr]}` : abbr;
}

function formatKickoff(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isLocked(kickoffIso) {
  return new Date() > new Date(kickoffIso);
}

// ---------------------------------------------------------------------------

export default function Page() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('picks'); // 'picks' | 'leaderboard'
  const [selectedWeek, setSelectedWeek] = useState(1);

  // ---- Auth bootstrap -----------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ---- Load / create profile once we have a session -----------------------
  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!cancelled && !error) {
        setProfile(data);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <main className="min-h-screen pb-20">
      <SiteHeader session={session} profile={profile} setProfile={setProfile} authLoading={authLoading} />

      <div className="max-w-4xl mx-auto px-4 mt-6">
        <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

        {activeTab === 'picks' ? (
          <PicksTab
            session={session}
            profile={profile}
            selectedWeek={selectedWeek}
            setSelectedWeek={setSelectedWeek}
          />
        ) : (
          <LeaderboardTab selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Header: title + auth
// ---------------------------------------------------------------------------

function SiteHeader({ session, profile, setProfile, authLoading }) {
  return (
    <header className="border-b border-fieldLine bg-panel/60 backdrop-blur">
      <div className="max-w-4xl mx-auto px-4 py-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-none text-hashGold">Family Pick&apos;Em</h1>
          <p className="text-chalkDim text-sm mt-1">Think you know ball? Pick winners. Repeat weekly. Have Fun!</p>
        </div>
        <AuthWidget session={session} profile={profile} setProfile={setProfile} authLoading={authLoading} />
      </div>
    </header>
  );
}

function AuthWidget({ session, profile, setProfile, authLoading }) {
  const [authMode, setAuthMode] = useState('password'); // 'magic' | 'password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // "Set a password" panel, shown once already signed in
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);

  const handleSendLink = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
    } else {
      setOtpSent(true);
    }
  };

  const handlePasswordSignIn = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
    }
    // On success, the onAuthStateChange listener in the parent component
    // picks up the new session automatically — nothing else to do here.
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    if (!displayName.trim() || !session?.user) return;
    setBusy(true);
    const { data, error: upsertError } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, display_name: displayName.trim() })
      .select()
      .single();
    setBusy(false);
    if (!upsertError) {
      setProfile(data);
    } else {
      setError(upsertError.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setPasswordSaved(true);
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  if (authLoading) {
    return <div className="text-chalkDim text-sm">Loading…</div>;
  }

  // Not signed in
  if (!session) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <form
          onSubmit={authMode === 'magic' ? handleSendLink : handlePasswordSignIn}
          className="flex items-center gap-2"
        >
          {authMode === 'magic' && otpSent ? (
            <p className="text-win text-sm">Check {email} for a sign-in link.</p>
          ) : (
            <>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@family.com"
                className="bg-field border border-fieldLine rounded px-3 py-1.5 text-sm text-chalk placeholder:text-chalkDim focus:border-hashGold outline-none"
              />
              {authMode === 'password' && (
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="bg-field border border-fieldLine rounded px-3 py-1.5 text-sm text-chalk placeholder:text-chalkDim focus:border-hashGold outline-none"
                />
              )}
              <button
                type="submit"
                disabled={busy}
                className="bg-hashGold text-field font-semibold text-sm px-3 py-1.5 rounded hover:brightness-110 disabled:opacity-50"
              >
                {busy ? (authMode === 'magic' ? 'Sending…' : 'Signing in…') : 'Sign in'}
              </button>
            </>
          )}
          {error && <p className="text-loss text-xs ml-2">{error}</p>}
        </form>

        <button
          type="button"
          onClick={() => {
            setAuthMode(authMode === 'magic' ? 'password' : 'magic');
            setError('');
            setOtpSent(false);
          }}
          className="text-[11px] text-chalkDim hover:text-chalk underline underline-offset-2"
        >
          {authMode === 'magic' ? 'Have a password instead? Sign in with it' : 'Use an email link instead'}
        </button>
      </div>
    );
  }

  // Signed in but no display name yet
  if (!profile) {
    return (
      <form onSubmit={handleSaveName} className="flex items-center gap-2">
        <input
          type="text"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Pick a display name"
          className="bg-field border border-fieldLine rounded px-3 py-1.5 text-sm text-chalk placeholder:text-chalkDim focus:border-hashGold outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="bg-hashGold text-field font-semibold text-sm px-3 py-1.5 rounded hover:brightness-110 disabled:opacity-50"
        >
          Save
        </button>
        {error && <p className="text-loss text-xs">{error}</p>}
      </form>
    );
  }

  // Fully signed in
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-3">
        <span className="text-sm text-chalk">
          Playing as <span className="text-hashGold font-semibold">{profile.display_name}</span>
        </span>
        <button
          onClick={() => {
            setShowSetPassword((v) => !v);
            setError('');
            setPasswordSaved(false);
          }}
          className="text-xs text-chalkDim border border-fieldLine rounded px-2.5 py-1.5 hover:text-chalk hover:border-chalkDim"
        >
          {showSetPassword ? 'Close' : 'Set a password'}
        </button>
        <button
          onClick={handleSignOut}
          className="text-xs text-chalkDim border border-fieldLine rounded px-2.5 py-1.5 hover:text-chalk hover:border-chalkDim"
        >
          Sign out
        </button>
      </div>

      {showSetPassword && (
        <form onSubmit={handleSetPassword} className="flex items-center gap-2">
          {passwordSaved ? (
            <p className="text-win text-sm">
              Password set — next time, sign in with your email and that password.
            </p>
          ) : (
            <>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="bg-field border border-fieldLine rounded px-3 py-1.5 text-sm text-chalk placeholder:text-chalkDim focus:border-hashGold outline-none"
              />
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm"
                className="bg-field border border-fieldLine rounded px-3 py-1.5 text-sm text-chalk placeholder:text-chalkDim focus:border-hashGold outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="bg-hashGold text-field font-semibold text-sm px-3 py-1.5 rounded hover:brightness-110 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
          {error && <p className="text-loss text-xs">{error}</p>}
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function TabBar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'picks', label: 'Make Picks' },
    { id: 'leaderboard', label: 'Leaderboard & Recap' },
  ];
  return (
    <div className="flex gap-1 border-b border-fieldLine">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setActiveTab(t.id)}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
            activeTab === t.id
              ? 'border-hashGold text-hashGold'
              : 'border-transparent text-chalkDim hover:text-chalk'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function WeekSelector({ selectedWeek, setSelectedWeek }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-chalkDim">Week</span>
      <select
        value={selectedWeek}
        onChange={(e) => setSelectedWeek(Number(e.target.value))}
        className="bg-panelRaised border border-fieldLine rounded px-2.5 py-1.5 text-chalk focus:border-hashGold outline-none"
      >
        {WEEKS.map((w) => (
          <option key={w} value={w}>
            Week {w}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Make Picks
// ---------------------------------------------------------------------------

function PicksTab({ session, profile, selectedWeek, setSelectedWeek }) {
  const [games, setGames] = useState([]);
  const [picks, setPicks] = useState({}); // game_id -> picked_team
  const [loading, setLoading] = useState(true);
  const [savingGameId, setSavingGameId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const loadGames = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('week', selectedWeek)
      .order('kickoff_time', { ascending: true });

    if (!error) setGames(data ?? []);
    setLoading(false);
  }, [selectedWeek]);

  const loadPicks = useCallback(async () => {
    if (!session?.user) {
      setPicks({});
      return;
    }
    const { data, error } = await supabase
      .from('picks')
      .select('game_id, picked_team')
      .eq('user_id', session.user.id);

    if (!error) {
      const map = {};
      for (const p of data ?? []) map[p.game_id] = p.picked_team;
      setPicks(map);
    }
  }, [session]);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  useEffect(() => {
    loadPicks();
  }, [loadPicks]);

  const handlePick = async (game, team) => {
    setErrorMsg('');

    if (!session?.user || !profile) {
      setErrorMsg('Sign in and set a display name before picking.');
      return;
    }
    if (isLocked(game.kickoff_time)) {
      setErrorMsg('This game has already kicked off — picks are locked.');
      return;
    }

    setSavingGameId(game.id);
    const { error } = await supabase
      .from('picks')
      .upsert(
        { user_id: session.user.id, game_id: game.id, picked_team: team },
        { onConflict: 'user_id,game_id' }
      );
    setSavingGameId(null);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setPicks((prev) => ({ ...prev, [game.id]: team }));
    }
  };

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-chalk">Week {selectedWeek} Games</h2>
        <WeekSelector selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} />
      </div>

      {errorMsg && (
        <div className="mb-4 text-sm text-loss bg-loss/10 border border-loss/30 rounded px-3 py-2">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <p className="text-chalkDim text-sm">Loading games…</p>
      ) : games.length === 0 ? (
        <p className="text-chalkDim text-sm">
          No games synced for this week yet. Once the score-sync cron route runs, they&apos;ll show up here.
        </p>
      ) : (
        <div className="grid gap-3">
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              userPick={picks[game.id]}
              onPick={(team) => handlePick(game, team)}
              saving={savingGameId === game.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GameCard({ game, userPick, onPick, saving }) {
  const locked = isLocked(game.kickoff_time);
  const isFinal = game.status === 'STATUS_FINAL';
  const isLive = game.status === 'STATUS_IN_PROGRESS';

  return (
    <div className="bg-panel border border-fieldLine rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 text-xs text-chalkDim">
        <span>{formatKickoff(game.kickoff_time)}</span>
        <span
          className={
            isFinal ? 'text-chalkDim' : isLive ? 'text-hashGold font-semibold' : 'text-chalkDim'
          }
        >
          {isFinal ? 'Final' : isLive ? 'Live' : locked ? 'Locked' : 'Upcoming'}
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-fieldLine mt-2">
        <TeamButton
          abbr={game.away_team}
          score={game.away_score}
          showScore={isLive || isFinal}
          selected={userPick === game.away_team}
          isWinner={isFinal && game.winner === game.away_team}
          disabled={locked}
          saving={saving}
          onClick={() => onPick(game.away_team)}
        />
        <TeamButton
          abbr={game.home_team}
          score={game.home_score}
          showScore={isLive || isFinal}
          selected={userPick === game.home_team}
          isWinner={isFinal && game.winner === game.home_team}
          disabled={locked}
          saving={saving}
          onClick={() => onPick(game.home_team)}
        />
      </div>

      {userPick && (
        <div className="px-4 py-2 text-xs text-chalkDim">
          Your pick: <span className="text-hashGold font-semibold">{teamLabel(userPick)}</span>
          {isFinal && (
            <span className={`ml-2 font-semibold ${userPick === game.winner ? 'text-win' : 'text-loss'}`}>
              {userPick === game.winner ? '✓ Win' : '✗ Loss'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TeamButton({ abbr, score, showScore, selected, isWinner, disabled, saving, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || saving}
      className={`flex flex-col items-center justify-center gap-1 py-4 px-2 transition-colors ${
        selected ? 'bg-hashGold/15' : 'hover:bg-panelRaised'
      } ${disabled ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
    >
      <span
        className={`font-display text-2xl tracking-wide ${
          selected ? 'text-hashGold' : isWinner ? 'text-win' : 'text-chalk'
        }`}
      >
        {abbr}
      </span>
      <span className="text-xs text-chalkDim">{teamLabel(abbr)}</span>
      {showScore && <span className="font-mono-score text-lg mt-1 text-chalk">{score}</span>}
      {selected && <span className="text-[10px] uppercase tracking-wider text-hashGold mt-1">Your pick</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Leaderboard & AI Recap
// ---------------------------------------------------------------------------

function LeaderboardTab({ selectedWeek, setSelectedWeek }) {
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recap, setRecap] = useState('');
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState('');

  const loadStandings = useCallback(async () => {
    setLoading(true);

    const [{ data: profiles, error: profilesErr }, { data: games, error: gamesErr }, { data: picks, error: picksErr }] =
      await Promise.all([
        supabase.from('profiles').select('id, display_name'),
        supabase.from('games').select('id, week'),
        supabase.from('picks').select('user_id, game_id, is_correct'),
      ]);

    if (profilesErr || gamesErr || picksErr) {
      setLoading(false);
      return;
    }

    const gameWeekById = new Map((games ?? []).map((g) => [g.id, g.week]));

    const byUser = new Map(
      (profiles ?? []).map((p) => [
        p.id,
        { userId: p.id, displayName: p.display_name, totalWins: 0, totalLosses: 0, weekWins: 0, weekLosses: 0 },
      ])
    );

    for (const pick of picks ?? []) {
      const entry = byUser.get(pick.user_id);
      if (!entry || pick.is_correct === null || pick.is_correct === undefined) continue;

      const week = gameWeekById.get(pick.game_id);

      if (pick.is_correct) {
        entry.totalWins += 1;
        if (week === selectedWeek) entry.weekWins += 1;
      } else {
        entry.totalLosses += 1;
        if (week === selectedWeek) entry.weekLosses += 1;
      }
    }

    const rows = Array.from(byUser.values()).sort((a, b) => b.totalWins - a.totalWins);
    setStandings(rows);
    setLoading(false);
  }, [selectedWeek]);

  useEffect(() => {
    loadStandings();
  }, [loadStandings]);

  const buildFallbackRecap = useCallback(() => {
    if (standings.length === 0) return "No picks graded yet — nothing to recap this week.";
    const leader = standings[0];
    const last = standings[standings.length - 1];
    const mid = standings.slice(1, -1);

    const p1 = `${leader.displayName} sits atop the standings at ${leader.totalWins}-${leader.totalLosses}, picking winners like they've got a direct line to the officiating booth. Nobody's touching that spot this week.`;
    const p2 = mid.length
      ? `Meanwhile the middle of the pack is a scrum: ${mid
          .map((p) => `${p.displayName} (${p.totalWins}-${p.totalLosses})`)
          .join(', ')} are all one good Sunday away from shaking things up.`
      : `Everyone else is bunched up right behind, one good Sunday away from a shake-up.`;
    const p3 =
      last && last.userId !== leader.userId
        ? `And down in the basement, ${last.displayName} is holding it down at ${last.totalWins}-${last.totalLosses} — someone has to keep the standings honest. There's still time to turn it around. Probably.`
        : `Keep it up, everyone — the standings are still anyone's game.`;

    return `${p1}\n\n${p2}\n\n${p3}`;
  }, [standings]);

  const handleGenerateRecap = async () => {
    setRecapError('');
    setRecapLoading(true);
    try {
      const res = await fetch('/api/generate-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standings, week: selectedWeek }),
      });

      if (res.ok) {
        const data = await res.json();
        setRecap(data.recap);
      } else {
        // No AI key configured, or the call failed — fall back to a local template
        // so the feature still works for free.
        setRecap(buildFallbackRecap());
      }
    } catch (err) {
      setRecapError(err.message);
      setRecap(buildFallbackRecap());
    } finally {
      setRecapLoading(false);
    }
  };

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-chalk">Family Leaderboard</h2>
        <WeekSelector selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} />
      </div>

      {loading ? (
        <p className="text-chalkDim text-sm">Loading standings…</p>
      ) : standings.length === 0 ? (
        <p className="text-chalkDim text-sm">No players yet — invite the family to sign in and make picks.</p>
      ) : (
        <div className="bg-panel border border-fieldLine rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-chalkDim text-left border-b border-fieldLine">
                <th className="px-4 py-2.5 font-normal">Player</th>
                <th className="px-4 py-2.5 font-normal text-center">Week {selectedWeek}</th>
                <th className="px-4 py-2.5 font-normal text-center">Season</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((p, i) => (
                <tr key={p.userId} className={i % 2 === 0 ? 'bg-panel' : 'bg-panelRaised/40'}>
                  <td className="px-4 py-2.5">
                    <span className="text-chalk font-medium">{p.displayName}</span>
                    {i === 0 && p.totalWins > 0 && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-hashGold">Leader</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono-score text-chalk">
                    {p.weekWins}-{p.weekLosses}
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono-score text-chalk">
                    {p.totalWins}-{p.totalLosses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={handleGenerateRecap}
          disabled={recapLoading || standings.length === 0}
          className="bg-hashGold text-field font-semibold text-sm px-4 py-2 rounded hover:brightness-110 disabled:opacity-50"
        >
          {recapLoading ? 'Writing recap…' : 'Generate AI Recap'}
        </button>

        {recapError && <p className="text-loss text-xs mt-2">{recapError}</p>}

        {recap && (
          <div className="mt-4 bg-panel border border-fieldLine rounded-lg p-4 whitespace-pre-line text-sm text-chalk leading-relaxed">
            {recap}
          </div>
        )}
      </div>
    </section>
  );
}
