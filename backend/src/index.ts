import express from 'express';
import cors from 'cors';
import { getCourtDataWithCache, clearCache } from './service.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const USE_MOCK_DATA = process.env.MOCK_DATA === 'true';
const SOURCE_VERSION = process.env.SOURCE_VERSION || 'local-dev';

const capabilities = {
  pro1Enabled: true,
  rokettoEnabled: true,
  sources: ['alpha', 'nbc', 'pro1', 'roketto'],
};

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

    const data = await getCourtDataWithCache(date, undefined, suburbs);
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Mode: ${USE_MOCK_DATA ? 'MOCK DATA' : 'REAL SCRAPING'}`);
  console.log(`Set MOCK_DATA=true to use mock data`);
});
