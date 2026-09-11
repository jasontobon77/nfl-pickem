import { NextResponse } from 'next/server';

// This route is optional. If ANTHROPIC_API_KEY is not set, the frontend
// falls back to a template-based recap generated entirely client-side, so
// the app still works for free with zero external calls.
export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const { standings, week } = await request.json();

    if (!Array.isArray(standings) || standings.length === 0) {
      return NextResponse.json({ error: 'No standings provided.' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured on the server.' },
        { status: 501 }
      );
    }

    const ranked = [...standings].sort((a, b) => b.totalWins - a.totalWins);
    const standingsText = ranked
      .map(
        (p, i) =>
          `${i + 1}. ${p.displayName} — ${p.totalWins}-${p.totalLosses} overall, ` +
          `${p.weekWins}-${p.weekLosses} this week`
      )
      .join('\n');

    const prompt = `You are writing a fun, family-friendly recap for a family NFL Pick'Em pool, week ${week}.
Here are the current standings, best to worst:

${standingsText}

Write exactly 3 short paragraphs:
1. Celebrate the current leader with some good-natured hype.
2. Call out one or two mid-pack storylines (close races, hot/cold streaks).
3. Gently roast whoever is in last place — keep it playful and affectionate, never mean.

Keep the whole thing under 180 words, casual tone, no headers or markdown formatting.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      throw new Error(`Anthropic API error: ${anthropicRes.status} ${errText}`);
    }

    const data = await anthropicRes.json();
    const text = data.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return NextResponse.json({ recap: text || 'The recap generator came up empty this week.' });
  } catch (err) {
    console.error('[generate-recap] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
