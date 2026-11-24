import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const ALLOWED_GAS_URL_REGEX = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/;

// Server-side fallback proxy for Google Apps Script Web App requests
// Prevents opaque browser CORS "Failed to fetch" errors on redirects/errors in hosted/iframe environments
app.post('/api/gas-proxy', async (req, res) => {
  const { gasUrl, payload } = req.body || {};

  if (typeof gasUrl !== 'string' || !ALLOWED_GAS_URL_REGEX.test(gasUrl)) {
    return res.status(400).json({ error: 'Invalid Google Apps Script Web App URL.' });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Missing request payload.' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const rawText = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      const titleMatch = rawText.match(/<title[^>]*>([^<]+)<\/title>/i);
      const hint = titleMatch ? titleMatch[1].trim() : `HTTP ${upstream.status}`;
      return res.status(502).json({
        error: `Google Apps Script returned a non-JSON response (${hint}). The request may have timed out or exceeded size limits.`
      });
    }

    return res.status(upstream.ok ? 200 : upstream.status).json(parsed);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ error: 'Google Apps Script request timed out after 120 seconds.' });
    }
    return res.status(502).json({
      error: `Proxy request to Google Apps Script failed: ${err && err.message ? err.message : String(err)}`
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

// Serve static files from the root directory (matching GitHub Pages structure)
app.use(express.static(__dirname, {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  }
}));

// Fallback to index.html for root requests
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
