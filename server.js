const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);
app.use('/downloads', express.static(DOWNLOADS_DIR));

function ytdlp(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const stdout = await ytdlp(['--dump-json', '--no-playlist', url], 30000);
    const info = JSON.parse(stdout);
    const formats = (info.formats || [])
      .filter(f => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none'))
      .map(f => ({
        format_id: f.format_id,
        ext: f.ext,
        quality: f.height ? `${f.height}p` : (f.format_note || f.format_id),
        filesize: f.filesize || f.filesize_approx || null,
        vcodec: f.vcodec,
        acodec: f.acodec,
        height: f.height || 0,
      }))
      .filter((f, i, arr) => arr.findIndex(x => x.quality === f.quality && x.ext === f.ext) === i)
      .sort((a, b) => b.height - a.height);
    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      view_count: info.view_count,
      upload_date: info.upload_date,
      platform: info.extractor_key,
      formats,
    });
  } catch (e) {
    console.error('Info error:', e.message);
    res.status(500).json({ error: 'Failed to fetch info: ' + e.message });
  }
});

app.post('/api/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const timestamp = Date.now();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${timestamp}_%(title)s.%(ext)s`);
  const args = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '-o', outputTemplate,
    url
  ];
  console.log('Downloading:', url);
  try {
    await ytdlp(args, 3600000);
    const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(`${timestamp}_`));
    if (!files.length) return res.status(500).json({ error: 'File not found after download' });
    const filename = files[0];
    console.log('Done:', filename);
    res.json({
      filename,
      downloadUrl: `/downloads/${encodeURIComponent(filename)}`,
    });
  } catch (e) {
    console.error('Download error:', e.message);
    res.status(500).json({ error: 'Download failed: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} already in use. Run: npx kill-port ${PORT}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});