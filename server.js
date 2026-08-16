// Macphail's Sheriff Court Practice - AI Search backend
//
// This is the only place the Anthropic API key ever lives.
// The webpage (on Netlify) sends the question + relevant book passages
// here, and this server does the actual call to Anthropic and sends
// back the answer. This keeps the key private and out of the browser.

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- CORS: only allow requests from your own site(s) ---
// Add every domain your frontend is served from (Netlify URL, custom
// domain, etc). "*" would work too but is less safe.
const ALLOWED_ORIGINS = [
  'https://macpahail.netlify.app',
  // 'https://your-custom-domain.co.uk', // add if you use one
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g. curl, server-to-server health checks)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  }
}));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// --- Bookmarks: a simple shared list stored in a file on this server ---
// Anyone using the site can add a bookmark, and everyone else sees it.
// Note: because Render's free/starter disk isn't permanent storage, this
// file resets if the service gets redeployed. Good enough for informal
// day-to-day reference; ask if you want it made properly permanent later.
const BOOKMARKS_FILE = path.join(__dirname, 'bookmarks.json');

function readBookmarks() {
  try {
    return JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeBookmarks(list) {
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(list, null, 2));
}

app.get('/api/bookmarks', (req, res) => {
  res.json(readBookmarks());
});

app.post('/api/bookmarks', (req, res) => {
  const { page, note, addedBy } = req.body || {};
  const pageNum = Number(page);
  if (!pageNum || pageNum < 1) {
    return res.status(400).json({ error: 'Missing or invalid "page".' });
  }
  const list = readBookmarks();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    page: pageNum,
    note: String(note || '').slice(0, 300),
    addedBy: String(addedBy || '').slice(0, 60),
    addedAt: new Date().toISOString(),
  };
  list.unshift(entry);
  if (list.length > 300) list.length = 300;
  writeBookmarks(list);
  res.json(list);
});

app.delete('/api/bookmarks/:id', (req, res) => {
  const list = readBookmarks().filter(b => b.id !== req.params.id);
  writeBookmarks(list);
  res.json(list);
});

app.get('/', (req, res) => {
  res.send('Macphail AI Search backend is running.');
});

app.post('/api/ask', async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is not configured with an API key yet.' });
    }

    const { question, passages } = req.body || {};

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Missing "question" in request.' });
    }
    if (!Array.isArray(passages) || passages.length === 0) {
      return res.status(400).json({ error: 'Missing "passages" in request.' });
    }

    // Build the same style of prompt the old frontend-only version used,
    // but now it happens safely on the server.
    const context = passages
      .slice(0, 8)
      .map(pg => `[Page ${pg.p}]\n${String(pg.t).slice(0, 900)}`)
      .join('\n\n---\n\n');

    const prompt = `You are a Scottish legal assistant with expertise in sheriff court procedure. Answer the question below using ONLY the passages provided from Macphail's Sheriff Court Practice (4th Edition). Be specific and practical. Cite page numbers. If passages don't fully answer the question, say so.

PASSAGES:
${context}

QUESTION: ${question}

Give a clear, structured answer in plain English with correct legal terminology.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: errBody?.error?.message || `Anthropic API error (${response.status})`,
      });
    }

    const data = await response.json();
    const answer = (data.content || [])
      .map(block => block.text || '')
      .join('');

    return res.json({ answer: answer || 'No response received.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unexpected server error: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Macphail AI backend listening on port ${PORT}`);
});
