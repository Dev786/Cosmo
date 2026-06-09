import {
  summarize, siteLabel, llmSafeLabel, fmtDur, phraseToday, phraseWeek, phraseTrend, renderMarkdown,
  type ActivitySample, type Category, type DaySummary,
} from '../activityLog';

// summarize() accepts an explicit samples array, so these tests never touch
// ~/.pixel (record/readDay are thin best-effort fs wrappers left to integration).
const BASE = 1_700_000_000_000;
const mk = (i: number, category: Category, app = 'X'): ActivitySample =>
  ({ ts: BASE + i * 30_000, app, category, secs: 30 });

describe('summarize: aggregation', () => {
  it('sums totals, groups by category, and sorts apps descending', () => {
    const samples: ActivitySample[] = [
      ...Array.from({ length: 10 }, (_, i) => mk(i, 'dev', 'Code')),       // 300s
      ...Array.from({ length: 5 }, (_, i) => mk(20 + i, 'social', 'Safari')), // 150s
      ...Array.from({ length: 3 }, (_, i) => mk(40 + i, 'comms', 'Slack')),   // 90s
    ];
    const s = summarize('2026-06-08', samples);
    expect(s.totalSecs).toBe(540);
    expect(s.byCategory.dev).toBe(300);
    expect(s.byCategory.social).toBe(150);
    expect(s.byCategory.comms).toBe(90);
    expect(s.byCategory.design).toBe(0);
    expect(s.byApp.map(a => a.app)).toEqual(['Code', 'Safari', 'Slack']);
    expect(s.byApp[0]).toEqual({ app: 'Code', secs: 300, category: 'dev' });
  });

  it('returns an empty summary for no samples', () => {
    const s = summarize('2026-06-08', []);
    expect(s.totalSecs).toBe(0);
    expect(s.byApp).toEqual([]);
    expect(s.peakFocus).toBeUndefined();
  });

  // Regression for the "Chrome time hides what I actually did" bug: a sample with a
  // domain (browser tab) must bucket by SITE, not collapse under the browser app name.
  it('buckets browser samples by site, never under the browser app name', () => {
    const mkd = (i: number, category: Category, app: string, domain: string): ActivitySample =>
      ({ ts: BASE + i * 30_000, app, category, secs: 30, domain });
    const samples: ActivitySample[] = [
      ...Array.from({ length: 60 }, (_, i) => mkd(i, 'entertainment', 'Google Chrome', 'primevideo.com')), // 30m
      ...Array.from({ length: 10 }, (_, i) => mkd(100 + i, 'dev', 'Google Chrome', 'github.com')),          // 5m
      ...Array.from({ length: 5 }, (_, i) => mk(200 + i, 'dev', 'Code')),                                   // app sample, no domain
    ];
    const labels = summarize('2026-06-09', samples).byApp.map(a => a.app);
    expect(labels).toContain('Prime Video');     // the site, by name
    expect(labels).toContain('GitHub');
    expect(labels).toContain('Code');             // non-browser stays an app
    expect(labels).not.toContain('Google Chrome');
    expect(summarize('2026-06-09', samples).byApp[0])
      .toEqual({ app: 'Prime Video', secs: 1800, category: 'entertainment' });
  });
});

describe('siteLabel', () => {
  it('maps known hosts (and their subdomains), falls back to the bare host', () => {
    expect(siteLabel('primevideo.com')).toBe('Prime Video');
    expect(siteLabel('www.primevideo.com')).toBe('Prime Video');
    expect(siteLabel('music.youtube.com')).toBe('YouTube');     // subdomain
    expect(siteLabel('mail.google.com')).toBe('Gmail');         // specific google host
    expect(siteLabel('weworkremotely.com')).toBe('weworkremotely.com'); // unknown → bare host
    expect(siteLabel('127.0.0.1')).toBe('localhost');
    expect(siteLabel('newtab')).toBe('New Tab');
  });
});

describe('llmSafeLabel (privacy: no raw domains reach the model)', () => {
  it('passes known service names and app names; hides unrecognized raw hosts', () => {
    expect(llmSafeLabel('Prime Video')).toBe('Prime Video');  // known service → surfaces by name
    expect(llmSafeLabel('GitHub')).toBe('GitHub');
    expect(llmSafeLabel('Code')).toBe('Code');                // plain app name
    expect(llmSafeLabel('localhost')).toBe('localhost');
    expect(llmSafeLabel('careers.bain.com')).toBe('a website'); // raw host → generic (would leak job hunt)
    expect(llmSafeLabel('weworkremotely.com')).toBe('a website');
  });

  it('phraseToday surfaces a known site but not a raw host', () => {
    const mkd = (i: number, c: Category, app: string, domain: string): ActivitySample =>
      ({ ts: BASE + i * 30_000, app, category: c, secs: 30, domain });
    const text = phraseToday(summarize('2026-06-09', [
      ...Array.from({ length: 40 }, (_, i) => mkd(i, 'entertainment', 'Google Chrome', 'primevideo.com')),
      ...Array.from({ length: 30 }, (_, i) => mkd(50 + i, 'neutral', 'Google Chrome', 'careers.bain.com')),
    ]));
    expect(text).toContain('Prime Video');
    expect(text).not.toContain('bain');        // sensitive host never reaches the LLM string
    expect(text).toContain('a website');
  });
});

describe('summarize: peakFocus', () => {
  it('reports a ≥15min heads-down stretch', () => {
    const samples = Array.from({ length: 31 }, (_, i) => mk(i, 'dev', 'Code')); // 930s
    const s = summarize('2026-06-08', samples);
    expect(s.peakFocus).toBeDefined();
    expect(s.peakFocus?.secs).toBe(930);
  });

  it('ignores a short focus run (<15min)', () => {
    const samples = Array.from({ length: 10 }, (_, i) => mk(i, 'dev')); // 300s
    expect(summarize('2026-06-08', samples).peakFocus).toBeUndefined();
  });

  it('tolerates a brief (≤5min) non-focus interruption within one stretch', () => {
    const samples: ActivitySample[] = [
      ...Array.from({ length: 20 }, (_, i) => mk(i, 'dev', 'Code')),     // 0..570s  (600s)
      mk(20, 'social', 'Safari'),                                        // 30s blip
      ...Array.from({ length: 20 }, (_, i) => mk(21 + i, 'dev', 'Code')),// resumes  (600s)
    ];
    const s = summarize('2026-06-08', samples);
    expect(s.peakFocus?.secs).toBe(1200);
  });

  it('splits stretches separated by a long (>5min) gap', () => {
    const first = Array.from({ length: 10 }, (_, i) => mk(i, 'dev'));        // 300s
    // jump 10 minutes (20 slots) ahead, then another 300s of dev
    const second = Array.from({ length: 10 }, (_, i) => mk(30 + i, 'dev'));  // gap = 600s > 300s
    expect(summarize('2026-06-08', [...first, ...second]).peakFocus).toBeUndefined();
  });
});

describe('digest formatters (pure)', () => {
  const s = (i: number, c: Category, app = 'X'): ActivitySample => ({ ts: BASE + i * 30_000, app, category: c, secs: 30 });
  const dayWith = (date: string, samples: ActivitySample[]): DaySummary => summarize(date, samples);

  it('fmtDur formats durations', () => {
    expect(fmtDur(0)).toBe('0m');
    expect(fmtDur(20)).toBe('<1m');
    expect(fmtDur(600)).toBe('10m');
    expect(fmtDur(3600)).toBe('1h');
    expect(fmtDur(3660)).toBe('1h 1m');
  });

  it('phraseToday: empty vs populated', () => {
    expect(phraseToday(dayWith('2026-06-08', []))).toMatch(/haven't tracked/i);
    const day = dayWith('2026-06-08', [
      ...Array.from({ length: 20 }, (_, i) => s(i, 'dev', 'Code')),            // 600s
      ...Array.from({ length: 10 }, (_, i) => s(30 + i, 'social', 'Safari')), // 300s
    ]);
    const text = phraseToday(day);
    expect(text).toContain('Today so far');
    expect(text).toContain('Code 10m');
    expect(text).toContain('Focused work 10m');
    expect(text).toContain('distractions 5m');
  });

  it('phraseWeek: empty vs populated', () => {
    const empties = Array.from({ length: 7 }, (_, i) => dayWith(`2026-06-0${i + 1}`, []));
    expect(phraseWeek(empties)).toMatch(/haven't tracked any activity this week/i);
    const days = [
      ...Array.from({ length: 6 }, (_, i) => dayWith(`2026-06-0${i + 1}`, [])),
      dayWith('2026-06-08', Array.from({ length: 20 }, (_, i) => s(i, 'dev', 'Code'))), // 600s today
    ];
    const text = phraseWeek(days);
    expect(text).toContain('This week');
    expect(text).toContain('across 1 day');
  });

  it('renderMarkdown: headers + today table + week table', () => {
    const days = [
      ...Array.from({ length: 6 }, (_, i) => dayWith(`2026-06-0${i + 1}`, [])),
      dayWith('2026-06-08', [
        ...Array.from({ length: 20 }, (_, i) => s(i, 'dev', 'Code')),
        ...Array.from({ length: 4 }, (_, i) => s(30 + i, 'comms', 'Slack')),
      ]),
    ];
    const md = renderMarkdown(days);
    expect(md).toContain('# Activity');
    expect(md).toContain('Local only');
    expect(md).toContain('## Today — 2026-06-08');
    expect(md).toContain('| Code | 10m | dev |');
    expect(md).toContain('## Last 7 days');
  });
});

describe('phraseTrend: week over week', () => {
  const zero: Record<Category, number> = {
    dev: 0, comms: 0, design: 0, research: 0, social: 0, entertainment: 0, meeting: 0, neutral: 0,
  };
  const day = (work: number, distract: number): DaySummary => ({
    date: '2026-06-08', totalSecs: work + distract, byApp: [],
    byCategory: { ...zero, dev: work, social: distract },
  });

  it('reports nothing trackable when this week is empty', () => {
    expect(phraseTrend([], [])).toMatch(/haven't tracked enough this week/i);
  });

  it('defers comparison when there is no prior week', () => {
    const msg = phraseTrend([day(3600, 0)], []);
    expect(msg).toMatch(/once there's more history/i);
    expect(msg).toContain('1h');
  });

  it('compares focus + distraction against last week', () => {
    const msg = phraseTrend([day(7200, 0)], [day(3600, 0)]); // 2h vs 1h focus
    expect(msg).toMatch(/^Week over week:/);
    expect(msg).toContain('up 100%');
  });

  it('flags a drop in focused work', () => {
    const msg = phraseTrend([day(1800, 0)], [day(3600, 0)]); // 30m vs 1h
    expect(msg).toContain('down 50%');
  });
});
