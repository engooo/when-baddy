import express from 'express';
import cors from 'cors';
import { getCourtDataWithCache, clearCache } from './service.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const USE_MOCK_DATA = process.env.MOCK_DATA === 'true';

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mode: USE_MOCK_DATA ? 'mock' : 'real',
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
    const data = await getCourtDataWithCache(date);
    res.json({
      success: true,
      data,
      count: data.length,
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
    res.json({
      success: true,
      message: 'Cache refreshed',
      data,
      count: data.length,
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
