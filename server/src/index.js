import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const app = express();
const port = process.env.PORT || 5000;
const uploadDir = path.resolve('uploads');
const dataDir = path.resolve('data');
const lectureFile = path.join(dataDir, 'lectures.json');
await fsp.mkdir(uploadDir, { recursive: true });
await fsp.mkdir(dataDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

let lectures;
try {
  lectures = JSON.parse(await fsp.readFile(lectureFile, 'utf8'));
  if (!Array.isArray(lectures)) {
    throw new Error('Local lecture data must contain a JSON array.');
  }
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw new Error(`Could not load local lecture data from ${lectureFile}: ${error.message}`);
  }
  lectures = [];
}

let writeQueue = Promise.resolve();
function saveLectures() {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const temporaryFile = `${lectureFile}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporaryFile, JSON.stringify(lectures, null, 2), 'utf8');
      await fsp.rename(temporaryFile, lectureFile);
    } catch (error) {
      await fsp.unlink(temporaryFile).catch(() => {});
      throw error;
    }
  });
  return writeQueue;
}

function findLecture(id) {
  return lectures.find(lecture => lecture._id === id);
}

app.get('/api/health', (_, res) => res.json({ ok: true, storage: 'local-json' }));
app.get('/api/lectures', async (_, res) => {
  res.json([...lectures].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});
app.get('/api/lectures/:id', async (req, res) => {
  const lecture = findLecture(req.params.id);
  if (!lecture) return res.status(404).json({ message: 'Lecture not found' });
  res.json(lecture);
});
app.post('/api/lectures', upload.single('media'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'A lecture audio or video file is required' });
  const lecture = {
    _id: randomUUID(),
    title: req.body.title || req.file.originalname,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    transcript: req.body.transcript || '',
    createdAt: new Date().toISOString()
  };

  try {
    lectures.push(lecture);
    await saveLectures();
    res.status(201).json(lecture);
  } catch (error) {
    lectures = lectures.filter(item => item._id !== lecture._id);
    await fsp.unlink(req.file.path).catch(unlinkError => {
      console.error('Could not remove an unrecorded lecture upload:', unlinkError);
    });
    console.error('Could not save local lecture data:', error);
    res.status(500).json({ message: 'Could not save lecture information to local storage.' });
  }
});
app.post('/api/lectures/:id/transcribe', async (req, res) => {
  try {
    const lecture = findLecture(req.params.id);
    if (!lecture) return res.status(404).json({ message: 'Lecture not found' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        message: 'Automatic transcription is not configured. Add OPENAI_API_KEY to the server environment.'
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await client.audio.translations.create({
      file: fs.createReadStream(path.join(uploadDir, lecture.filename)),
      model: 'whisper-1',
      response_format: 'verbose_json'
    });
    lecture.transcript = result.text;
    lecture.captions = Array.isArray(result.segments) && result.segments.length
      ? result.segments
        .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.text?.trim())
        .map(segment => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim()
        }))
      : [{
        start: 0,
        end: Number.isFinite(result.duration) && result.duration > 0 ? result.duration : 0,
        text: result.text
      }];
    lecture.translationLanguage = 'English';
    await saveLectures();
    res.json({
      transcript: lecture.transcript,
      captions: lecture.captions,
      translationLanguage: lecture.translationLanguage
    });
  } catch (error) {
    console.error('Lecture transcription failed:', error);
    res.status(502).json({ message: 'The transcription service failed. Check its configuration and try again.' });
  }
});

app.listen(port, () => console.log(`SignBridge API running on http://localhost:${port} (local JSON storage)`));
