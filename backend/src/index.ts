import './env.js';
import express from 'express';
import cors from 'cors';
import { getCourtDataWithCache, clearCache } from './service.js';

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_PREWARM_ENABLED = process.env.CACHE_PREWARM_ENABLED !== 'false';
const CACHE_PREWARM_INTERVAL_MS = Number(process.env.CACHE_PREWARM_INTERVAL_MS || 5 * 60 * 1000);
const CACHE_PREWARM_LOOKAHEAD_DAYS = Number(process.env.CACHE_PREWARM_LOOKAHEAD_DAYS || 1);
const PREWARM_WEBHOOK_TOKEN = process.env.PREWARM_WEBHOOK_TOKEN || '';

app.use(cors());
app.use(express.json());

const USE_MOCK_DATA = process.env.MOCK_DATA === 'true';
const SOURCE_VERSION = process.env.SOURCE_VERSION || 'local-dev';

const capabilities = {
  pro1Enabled: true,
  rokettoEnabled: true,
  sources: ['alpha', 'nbc', 'pro1', 'roketto', 'picklepoint', 'mindbody'],
};

function todaySydneyYmd(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    const fallback = new Date();
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
  }

  return `${year}-${month}-${day}`;
}

function addDaysToYmd(ymd: string, days: number): string {
  const parts = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) {
    return ymd;
  }

  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(ymd: string): { day: number; month: number; year: number } | null {
  const parts = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) {
    return null;
  }

  return {
    year: Number(parts[1]),
    month: Number(parts[2]),
    day: Number(parts[3]),
  };
}

type PrewarmResult = {
  date: string;
  rowCount: number;
};

type PrewarmOptions = {
  lookaheadDays?: number;
  clearExistingCache?: boolean;
};

function clampLookaheadDays(input: number): number {
  if (!Number.isFinite(input)) {
    return CACHE_PREWARM_LOOKAHEAD_DAYS;
  }

  return Math.max(0, Math.min(14, Math.floor(input)));
}

function getRequestToken(req: express.Request): string {
  const bearer = req.header('authorization');
  if (bearer && bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim();
  }

  return req.header('x-prewarm-token')?.trim() || '';
}

function requirePrewarmAuth(req: express.Request, res: express.Response): boolean {
  if (!PREWARM_WEBHOOK_TOKEN) {
    return true;
  }

  const suppliedToken = getRequestToken(req);
  if (!suppliedToken || suppliedToken !== PREWARM_WEBHOOK_TOKEN) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Valid prewarm token is required',
    });
    return false;
  }

  return true;
}

async function prewarmCache(options?: PrewarmOptions): Promise<PrewarmResult[]> {
  const lookaheadDays = clampLookaheadDays(options?.lookaheadDays ?? CACHE_PREWARM_LOOKAHEAD_DAYS);

  if (options?.clearExistingCache) {
    clearCache();
  }

  const baseDate = todaySydneyYmd();
  const datesToWarm: string[] = [];

  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    datesToWarm.push(addDaysToYmd(baseDate, offset));
  }

  console.log(`[prewarm] Starting cache warm-up for ${datesToWarm.join(', ')}`);

  return Promise.all(
    datesToWarm.map(async (ymd) => {
      const parsed = parseYmd(ymd);
      if (!parsed) {
        return { date: ymd, rowCount: 0 };
      }

      const data = await getCourtDataWithCache(parsed);
      console.log(`[prewarm] Warmed ${ymd} with ${data.length} rows`);
      return { date: ymd, rowCount: data.length };
    })
  );
}

let prewarmInProgress = false;

async function runPrewarmSafely(): Promise<void> {
  if (!CACHE_PREWARM_ENABLED) {
    return;
  }

  if (prewarmInProgress) {
    console.log('[prewarm] Skip run: previous warm-up still in progress');
    return;
  }

  prewarmInProgress = true;
  try {
    await prewarmCache();
  } catch (error) {
    console.error('[prewarm] Cache warm-up failed:', error);
  } finally {
    prewarmInProgress = false;
  }
}

async function runPrewarmJob(options?: PrewarmOptions): Promise<PrewarmResult[] | null> {
  if (prewarmInProgress) {
    console.log('[prewarm] Skip run: previous warm-up still in progress');
    return null;
  }

  prewarmInProgress = true;
  try {
    return await prewarmCache(options);
  } finally {
    prewarmInProgress = false;
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mode: USE_MOCK_DATA ? 'mock' : 'real',
    sourceVersion: SOURCE_VERSION,
    capabilities,
  });
});

// Get all court data
app.get('/api/courts', async (req, res) => {
  try {
    let date: { day: number; month: number; year: number } | undefined;
    if (req.query.date && typeof req.query.date === 'string') {
      const parts = req.query.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (parts) {
        date = { year: parseInt(parts[1]), month: parseInt(parts[2]), day: parseInt(parts[3]) };
      }
    }

    let suburbs: string[] | undefined;
    if (req.query.suburbs && typeof req.query.suburbs === 'string') {
      suburbs = req.query.suburbs.split(',').map((s) => s.trim());
    }

    let sport: 'badminton' | 'pickleball' | undefined;
    if (req.query.sport === 'badminton' || req.query.sport === 'pickleball') {
      sport = req.query.sport;
    }

    const data = await getCourtDataWithCache(date, undefined, suburbs, sport);
    const byClub = data.reduce<Record<string, number>>((acc, row) => {
      acc[row.club] = (acc[row.club] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data,
      count: data.length,
      byClub,
      sourceVersion: SOURCE_VERSION,
      capabilities,
      mode: USE_MOCK_DATA ? 'mock' : 'real',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching court data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch court data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Refresh cache endpoint
app.post('/api/refresh', async (req, res) => {
  try {
    clearCache();
    const data = await getCourtDataWithCache();
    const byClub = data.reduce<Record<string, number>>((acc, row) => {
      acc[row.club] = (acc[row.club] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      message: 'Cache refreshed',
      data,
      count: data.length,
      byClub,
      sourceVersion: SOURCE_VERSION,
      capabilities,
      mode: USE_MOCK_DATA ? 'mock' : 'real',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error refreshing court data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh court data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Prewarm cache endpoint for external schedulers
app.post('/api/prewarm', async (req, res) => {
  if (!requirePrewarmAuth(req, res)) {
    return;
  }

  const bodyLookahead = typeof req.body?.lookaheadDays === 'number' ? req.body.lookaheadDays : undefined;
  const queryLookahead = typeof req.query.lookaheadDays === 'string' ? Number(req.query.lookaheadDays) : undefined;
  const lookaheadDays = bodyLookahead ?? queryLookahead;
  const clearExistingCache = req.body?.clearExistingCache === true;

  try {
    const results = await runPrewarmJob({ lookaheadDays, clearExistingCache });
    if (!results) {
      res.status(409).json({
        success: false,
        error: 'Prewarm already running',
      });
      return;
    }

    const warmedRows = results.reduce((sum, row) => sum + row.rowCount, 0);
    res.json({
      success: true,
      message: 'Cache prewarm completed',
      dates: results,
      warmedRows,
      sourceVersion: SOURCE_VERSION,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[prewarm] External prewarm failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to prewarm cache',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Mode: ${USE_MOCK_DATA ? 'MOCK DATA' : 'REAL SCRAPING'}`);
  console.log(`Set MOCK_DATA=true to use mock data`);

  if (CACHE_PREWARM_ENABLED) {
    console.log(`[prewarm] Enabled (interval=${CACHE_PREWARM_INTERVAL_MS}ms, lookaheadDays=${CACHE_PREWARM_LOOKAHEAD_DAYS})`);
    void runPrewarmSafely();
    setInterval(() => {
      void runPrewarmSafely();
    }, CACHE_PREWARM_INTERVAL_MS);
  } else {
    console.log('[prewarm] Disabled');
  }
});
