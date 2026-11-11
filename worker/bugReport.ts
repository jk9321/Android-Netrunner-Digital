/**
 * The "Report a bug" endpoint: POST /api/bug-report turns a player's report
 * into a GitHub issue. The token lives only in the Worker (a secret named
 * GITHUB_TOKEN), never in the page, and the player is never shown where the
 * report went.
 *
 * Abuse limits, none of which need storage of their own:
 * - the request must come from the site itself (Origin header) and be small;
 * - a hidden form field that people never fill (bots do) drops the report;
 * - Cloudflare's rate limiting binding, when configured, allows a burst of
 *   BURST_LIMIT reports a minute from one address;
 * - the issues themselves are the counter: before posting, the Worker reads
 *   the latest issues and refuses once there are DAILY_LIMIT_TOTAL reports in
 *   the last 24 hours, or DAILY_LIMIT_PER_REPORTER from the same address. The
 *   address is stored only as a salted hash in the issue ("Reporter: ab12…").
 */

export interface BugReportEnv {
  GITHUB_TOKEN?: string;
  /** "owner/name" of the repository that gets the issues. */
  BUG_REPORT_REPO?: string;
  BUG_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export const MAX_DESCRIPTION = 1000;
export const MIN_DESCRIPTION = 10;
export const MAX_REQUEST_BYTES = 400_000;
export const DAILY_LIMIT_TOTAL = 30;
export const DAILY_LIMIT_PER_REPORTER = 5;
/** GitHub refuses issue and comment bodies over 65,536 characters. */
const MAX_BODY = 60_000;
export const TITLE_PREFIX = '[Bug report]';
const LABEL = 'bug report';

export interface GameReport {
  seed: number;
  format: string;
  opponent: string;
  turn: string;
  replay: string;
  corpDeck: string;
  runnerDeck: string;
  log: string;
  /** The saved game (config, engine state, table), gzipped then base64. */
  snapshot?: string;
}

export interface BugReport {
  description: string;
  screen: string;
  version: string;
  /** A form field hidden from people; anything in it means a bot filled the form. */
  website?: string;
  game?: GameReport;
  crash?: { message: string; stack?: string };
}

type Result = { status: number; body: { ok: boolean; error?: string } };
const fail = (status: number, error: string): Result => ({ status, body: { ok: false, error } });

const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

/** Checks the shape of the posted JSON and trims every field to a sane size. */
export function parseReport(raw: unknown): BugReport | string {
  if (!raw || typeof raw !== 'object') return 'The report could not be read.';
  const r = raw as Record<string, unknown>;
  const description = typeof r.description === 'string' ? r.description.trim() : '';
  if (description.length < MIN_DESCRIPTION) return `Please describe the problem in at least ${MIN_DESCRIPTION} characters.`;
  if (description.length > MAX_DESCRIPTION) return `Please keep the description under ${MAX_DESCRIPTION} characters.`;
  const report: BugReport = {
    description,
    screen: str(r.screen, 40) ?? 'unknown',
    version: str(r.version, 80) ?? 'unknown',
    website: str(r.website, 200) ?? undefined,
  };
  if (r.game && typeof r.game === 'object') {
    const g = r.game as Record<string, unknown>;
    report.game = {
      seed: typeof g.seed === 'number' && Number.isFinite(g.seed) ? g.seed : 0,
      format: str(g.format, 200) ?? '',
      opponent: str(g.opponent, 100) ?? '',
      turn: str(g.turn, 200) ?? '',
      replay: str(g.replay, 300) ?? '',
      corpDeck: str(g.corpDeck, 6000) ?? '',
      runnerDeck: str(g.runnerDeck, 6000) ?? '',
      // The newest lines matter most, so a long log loses its start
      log: typeof g.log === 'string' ? g.log.slice(-200_000) : '',
      snapshot: typeof g.snapshot === 'string' && /^[A-Za-z0-9+/=]+$/.test(g.snapshot) ? g.snapshot : undefined,
    };
  }
  if (r.crash && typeof r.crash === 'object') {
    const c = r.crash as Record<string, unknown>;
    report.crash = { message: str(c.message, 1000) ?? '', stack: str(c.stack, 4000) ?? undefined };
  }
  return report;
}

/** A code fence longer than any run of backticks in the text, so the text can't close it (or ping anyone with @). */
export function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(s => s.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

/** Plain text for places outside a code fence: no @mentions, no line breaks. */
function inline(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/@/g, '@\u200b').replace(/[<>]/g, '').trim();
}

export function issueTitle(description: string): string {
  const first = inline(description.split('\n')[0]);
  return `${TITLE_PREFIX} ${first.length > 70 ? `${first.slice(0, 67)}…` : first}`;
}

/** The issue body. The game log is cut from the front when the whole body would be too long for GitHub. */
export function issueBody(report: BugReport, meta: { reporter: string; site: string; userAgent: string }): string {
  const head = [
    '### Description',
    fence(report.description, 'text'),
    '',
    `**Screen:** ${inline(report.screen)}`,
    `**Version:** ${inline(report.version)} (${inline(meta.site)})`,
    `**Browser:** ${inline(meta.userAgent).slice(0, 300) || 'unknown'}`,
    `**Reporter:** \`${meta.reporter}\` (anonymous, salted hash)`,
  ];
  if (report.crash) {
    head.push('', '### Crash', fence(`${report.crash.message}\n\n${report.crash.stack ?? ''}`.trim()));
  }
  const g = report.game;
  if (!g) return head.join('\n');
  head.push(
    `**Format:** ${inline(g.format)}`,
    `**Opponent:** ${inline(g.opponent)}`,
    `**When:** ${inline(g.turn)}`,
    `**Seed:** ${g.seed} (replay the deal: \`${inline(g.replay).replace(/`/g, '')}\`)`,
    g.snapshot ? '**Saved game:** in the first comment (paste it into a file and run `node scripts/bug-report-state.mjs <file>`)' : '',
    '',
    '<details><summary>Corp deck</summary>',
    '',
    fence(g.corpDeck),
    '',
    '</details>',
    '',
    '<details><summary>Runner deck</summary>',
    '',
    fence(g.runnerDeck),
    '',
    '</details>',
    '',
  );
  const top = head.join('\n');
  const room = MAX_BODY - top.length - 200;
  let log = g.log;
  let cut = '';
  if (log.length > room) {
    log = log.slice(log.length - Math.max(0, room));
    log = log.slice(log.indexOf('\n') + 1);
    cut = ' (oldest lines cut)';
  }
  return `${top}<details><summary>Game log${cut}</summary>\n\n${fence(log)}\n\n</details>\n`;
}

/** The snapshot comment, or null when it is too big for one comment. */
export function snapshotComment(snapshot: string | undefined): string | null {
  if (!snapshot) return null;
  const body = `Saved game snapshot (gzip, base64):\n\n${fence(snapshot, 'text')}\n`;
  return body.length <= MAX_BODY ? body : null;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The same address always gives the same short hash, which can't be turned back into the address without the secret. */
export async function reporterId(ip: string, secret: string): Promise<string> {
  return (await sha256Hex(`bug-report:${secret}:${ip}`)).slice(0, 10);
}

interface IssueSummary {
  title: string;
  body: string | null;
  created_at: string;
  pull_request?: unknown;
}

/** Reports made in the last 24 hours, all and from this reporter. */
export function countRecent(issues: IssueSummary[], reporter: string, now: number): { total: number; mine: number } {
  const since = now - 24 * 60 * 60 * 1000;
  // Beta preview reports have no limits of their own and don't use up the live site's
  const recent = issues.filter(i => !i.pull_request && i.title.startsWith(TITLE_PREFIX) && Date.parse(i.created_at) >= since && !(i.body ?? '').includes('(beta preview)'));
  return { total: recent.length, mine: recent.filter(i => (i.body ?? '').includes(`\`${reporter}\``)).length };
}

function github(env: BugReportEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.BUG_REPORT_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'netrunner-bug-report-worker',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

/** True when the request was sent by a page on this same site. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function siteName(host: string): string {
  if (host.startsWith('beta-')) return 'beta preview';
  if (host.includes('-android-netrunner-digital.')) return `preview ${host.split('-android-netrunner-digital.')[0]}`;
  if (host.startsWith('android-netrunner-digital.')) return 'live site';
  return host;
}

async function handle(request: Request, env: BugReportEnv): Promise<Result> {
  if (request.method !== 'POST') return fail(405, 'Use POST.');
  if (!sameOrigin(request)) return fail(403, 'Reports can only be sent from the game itself.');
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_REQUEST_BYTES) return fail(413, 'The report is too large.');
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) return fail(413, 'The report is too large.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(400, 'The report could not be read.');
  }
  const report = parseReport(raw);
  if (typeof report === 'string') return fail(400, report);
  // A bot filled the hidden field: pretend it worked so it doesn't try again
  if (report.website) return { status: 200, body: { ok: true } };
  if (!env.GITHUB_TOKEN || !env.BUG_REPORT_REPO) return fail(503, 'Bug reports are not switched on yet. Please try again later.');

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const reporter = await reporterId(ip, env.GITHUB_TOKEN);
  // Beta preview reports skip the daily caps (Jeff, 2026-11-05) but keep the burst limit: online invite links bring other people there
  const beta = siteName(new URL(request.url).host) === 'beta preview';
  if (env.BUG_RATE_LIMITER) {
    const { success } = await env.BUG_RATE_LIMITER.limit({ key: reporter });
    if (!success) return fail(429, 'Too many reports at once. Please wait a minute and try again.');
  }

  if (!beta) {
    const recent = await github(env, '/issues?state=all&sort=created&direction=desc&per_page=100');
    if (!recent.ok) {
      console.error('Bug report: listing issues failed', recent.status, await recent.text());
      return fail(502, 'The report could not be sent. Please try again later.');
    }
    const counts = countRecent((await recent.json()) as IssueSummary[], reporter, Date.now());
    if (counts.mine >= DAILY_LIMIT_PER_REPORTER) return fail(429, 'You have sent the most reports allowed for today. Thank you! Please try again tomorrow.');
    if (counts.total >= DAILY_LIMIT_TOTAL) return fail(429, 'We have received a lot of reports today. Please try again tomorrow.');
  }

  const issue = {
    title: issueTitle(report.description),
    body: issueBody(report, {
      reporter,
      site: siteName(new URL(request.url).host),
      userAgent: request.headers.get('User-Agent') ?? '',
    }),
  };
  let created = await github(env, '/issues', { method: 'POST', body: JSON.stringify({ ...issue, labels: [LABEL] }) });
  // The label can be refused (no permission to create it); the report matters more
  if (created.status === 422 || created.status === 403) {
    created = await github(env, '/issues', { method: 'POST', body: JSON.stringify(issue) });
  }
  if (!created.ok) {
    console.error('Bug report: creating the issue failed', created.status, await created.text());
    return fail(502, 'The report could not be sent. Please try again later.');
  }
  const comment = snapshotComment(report.game?.snapshot);
  if (comment) {
    const { number } = (await created.json()) as { number: number };
    const posted = await github(env, `/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) });
    if (!posted.ok) console.error('Bug report: snapshot comment failed', posted.status);
  }
  return { status: 200, body: { ok: true } };
}

export async function handleBugReport(request: Request, env: BugReportEnv): Promise<Response> {
  let result: Result;
  try {
    result = await handle(request, env);
  } catch (error) {
    console.error('Bug report failed', error);
    result = fail(500, 'The report could not be sent. Please try again later.');
  }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
