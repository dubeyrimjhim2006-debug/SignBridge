import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = '/api';
const numberPositions = {
  one: [0, 0], two: [1, 0], three: [2, 0], four: [3, 0], five: [4, 0],
  six: [0, 1], seven: [1, 1], eight: [2, 1], nine: [3, 1], ten: [4, 1],
  eleven: [0, 2], twelve: [1, 2], thirteen: [2, 2], fourteen: [3, 2], fifteen: [4, 2],
  sixteen: [0, 3], seventeen: [1, 3], eighteen: [2, 3], nineteen: [3, 3], twenty: [4, 3]
};
const numberWords = new Set(Object.keys(numberPositions));
const numberWordByDigit = Object.fromEntries(
  Object.keys(numberPositions).map((word, index) => [String(index + 1), word])
);
const alphabetPositions = Object.fromEntries(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter, index) => [
    letter.toLowerCase(),
    [index % 7, Math.floor(index / 7)]
  ])
);
const numberColumns = [17, 92, 166, 241, 316];
const numberRows = [43, 155, 267, 379];
const alphabetColumns = [14, 77, 139, 202, 265, 327, 390];
const alphabetRows = [13, 98, 180, 261];
const signImageCache = new Map();
const signSpritePromises = new Map();

function loadSignSprite(spriteName) {
  if (!signSpritePromises.has(spriteName)) {
    signSpritePromises.set(spriteName, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        signSpritePromises.delete(spriteName);
        reject(new Error(`Could not load ${spriteName} hand signs.`));
      };
      image.src = `/assets/${spriteName}`;
    }));
  }

  return signSpritePromises.get(spriteName);
}

function findNumber(text) {
  let found = null;
  for (const word of Object.keys(numberPositions)) {
    const pattern = new RegExp(`\\b${word}\\b`, 'gi');
    for (const match of text.matchAll(pattern)) {
      if (!found || match.index > found.index) {
        found = { word, index: match.index };
      }
    }
  }
  return found?.word || null;
}

function findSpokenSign(text) {
  const number = findNumber(text);
  if (number) return { type: 'number', symbol: number, label: number };

  const letterMatch = text.match(/\bletter\s+([a-z])\b/i);
  if (letterMatch) {
    const symbol = letterMatch[1].toLowerCase();
    return { type: 'letter', symbol, label: `letter ${symbol.toUpperCase()}` };
  }

  return null;
}

function getSignAtTime(text, elapsed) {
  const tokens = text.match(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|[a-z]+|\d+)\b/gi) || [];
  let remaining = Math.max(0, elapsed);

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const number = numberWords.has(lower) ? lower : numberWordByDigit[token];
    if (number) {
      if (remaining < 0.8) return { type: 'number', symbol: number, label: number };
      remaining -= 0.8;
      continue;
    }

    const letters = lower.replace(/[^a-z]/g, '');
    if (!letters) continue;
    const letterIndex = Math.floor(remaining / 0.4);
    if (letterIndex < letters.length) {
      const symbol = letters[letterIndex];
      return { type: 'letter', symbol, label: `Letter ${symbol.toUpperCase()}` };
    }
    remaining -= letters.length * 0.4;
  }

  return null;
}

function getSignImage(type, symbol) {
  const cacheKey = `${type}:${symbol}`;
  if (signImageCache.has(cacheKey)) return signImageCache.get(cacheKey);

  const spriteName = type === 'number' ? '1-20.png' : 'a-z.png';
  const positions = type === 'number' ? numberPositions : alphabetPositions;
  const columns = type === 'number' ? numberColumns : alphabetColumns;
  const rows = type === 'number' ? numberRows : alphabetRows;
  const [column, row] = positions[symbol];
  const sourceX = columns[column];
  const sourceY = rows[row];
  const crop = type === 'number'
    ? { x: sourceX + 4, y: sourceY + 38, width: 58, height: 64, targetWidth: 72, targetHeight: 80 }
    : { x: sourceX + 4, y: sourceY + 6, width: 50, height: 54, targetWidth: 72, targetHeight: 78 };

  const promise = new Promise((resolve, reject) => {
    loadSignSprite(spriteName).then(image => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not prepare the ISL sign image.'));
        return;
      }

      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        crop.x, crop.y, crop.width, crop.height,
        (canvas.width - crop.targetWidth) / 2,
        (canvas.height - crop.targetHeight) / 2,
        crop.targetWidth, crop.targetHeight
      );
      resolve(canvas.toDataURL('image/png'));
    }, reject);
  });

  signImageCache.set(cacheKey, promise);
  promise.catch(() => signImageCache.delete(cacheKey));
  return promise;
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }
  return data;
}

function App() {
  const [lectures, setLectures] = useState([]);
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const [liveActive, setLiveActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [livePhrase, setLivePhrase] = useState('');
  const [liveStatus, setLiveStatus] = useState('Start live subtitles to see English speech and number signs here.');
  const [liveSign, setLiveSign] = useState(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [mediaSign, setMediaSign] = useState(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const recognition = useRef(null);
  const liveActiveRef = useRef(false);
  const restartTimer = useRef(null);
  const letterQueue = useRef([]);
  const letterWord = useRef('');
  const queuedLetterCount = useRef(0);
  const letterPlaybackActive = useRef(false);
  const letterPlaybackTimer = useRef(null);
  const letterPlayId = useRef(0);
  const mediaSignRef = useRef(null);

  const load = async () => {
    try {
      const response = await fetch(`${API}/lectures`);
      setLectures(await readResponse(response));
    } catch (error) {
      setNotice(`Could not connect to the lecture library: ${error.message}`);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setMediaCaption('');
    setMediaSign(null);
    mediaSignRef.current = null;
  }, [selected?._id]);

  useEffect(() => {
    let cancelled = false;
    getSignImage('number', 'one')
      .then(src => {
        if (!cancelled) {
          setLiveSign(current => current || {
            type: 'number',
            symbol: 'one',
            label: 'Number one preview',
            src
          });
        }
      })
      .catch(error => {
        if (!cancelled) setLiveStatus(error.message);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const sign = findSpokenSign(livePhrase);
    if (!sign) {
      const word = livePhrase.match(/[a-z]+$/i)?.[0].toLowerCase() || '';
      if (!word || numberWords.has(word)) return;

      if (word !== letterWord.current) {
        if (letterWord.current && word.startsWith(letterWord.current)) {
          const newLetters = word.slice(letterWord.current.length);
          letterQueue.current.push(...newLetters);
        } else {
          letterQueue.current = [...word];
          queuedLetterCount.current = 0;
        }
        letterWord.current = word;
      } else if (word.length > queuedLetterCount.current) {
        letterQueue.current.push(...word.slice(queuedLetterCount.current));
      }

      queuedLetterCount.current = Math.max(queuedLetterCount.current, word.length);

      const showNextLetter = async () => {
        if (letterPlaybackActive.current || letterQueue.current.length === 0) return;
        letterPlaybackActive.current = true;
        const symbol = letterQueue.current.shift();

        try {
          const src = await getSignImage('letter', symbol);
          setLiveSign({
            type: 'letter',
            symbol,
            label: `Letter ${symbol.toUpperCase()}`,
            src,
            playId: ++letterPlayId.current
          });
        } catch (error) {
          setLiveStatus(error.message);
        }

        letterPlaybackTimer.current = window.setTimeout(() => {
          letterPlaybackActive.current = false;
          void showNextLetter();
        }, 400);
      };

      void showNextLetter();
      return;
    }

    letterQueue.current = [];
    letterWord.current = '';
    queuedLetterCount.current = 0;
    let cancelled = false;
    getSignImage(sign.type, sign.symbol).then(src => {
      if (!cancelled) setLiveSign({ ...sign, src });
    }).catch(error => {
      if (!cancelled) setLiveStatus(error.message);
    });

    return () => { cancelled = true; };
  }, [livePhrase]);

  useEffect(() => () => {
    liveActiveRef.current = false;
    window.clearTimeout(restartTimer.current);
    window.clearTimeout(letterPlaybackTimer.current);
    recognition.current?.stop();
    recorder.current?.stream.getTracks().forEach(track => track.stop());
  }, []);

  const save = async file => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setNotice('Choose an audio or video file smaller than 25 MB so OpenAI can translate it.');
      return;
    }

    setBusy(true);
    setNotice('');

    try {
      const data = new FormData();
      data.append('media', file);
      data.append('title', title || file.name);
      const response = await fetch(`${API}/lectures`, { method: 'POST', body: data });
      const item = await readResponse(response);
      setSelected(item);
      setTitle('');
      setNotice('Lecture saved.');
      await load();
    } catch (error) {
      setNotice(`Could not save this lecture: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error('Audio recording is not supported in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      recorder.current = new MediaRecorder(stream);
      recorder.current.ondataavailable = event => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recorder.current.onerror = event => {
        setNotice(`Recording failed: ${event.error?.message || 'Unknown recording error.'}`);
      };
      recorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: recorder.current.mimeType || 'audio/webm' });
        void save(new File([blob], 'recorded-lecture.webm', { type: blob.type }));
      };
      recorder.current.start();
      setRecording(true);
      setNotice('Recording lecture audio.');
    } catch (error) {
      setNotice(`Could not start recording: ${error.message}`);
    }
  };

  const stopRecording = () => {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
      recorder.current.stream.getTracks().forEach(track => track.stop());
    }
    setRecording(false);
  };

  const stopLiveSubtitles = () => {
    liveActiveRef.current = false;
    window.clearTimeout(restartTimer.current);
    restartTimer.current = null;
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onend = null;
      current.stop();
    }
    setLiveActive(false);
    setLiveStatus('Live subtitles stopped.');
  };

  const startLiveSubtitles = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLiveStatus('Speech recognition is not supported here. Use the latest Chrome or Microsoft Edge.');
      return;
    }

    try {
      void Promise.all([loadSignSprite('1-20.png'), loadSignSprite('a-z.png')]).catch(error => {
        console.error('SignBridge could not preload ISL sprite sheets:', error);
      });

      const current = new SpeechRecognition();
      recognition.current = current;
      liveActiveRef.current = true;
      current.continuous = true;
      current.interimResults = true;
      current.lang = 'en-US';
      current.onstart = () => setLiveStatus('Listening... speak clearly into your microphone.');
      current.onspeechstart = () => setLiveStatus('Voice detected; creating live subtitles.');
      current.onresult = event => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('')
          .trim();
        const latestResult = event.results[event.results.length - 1];
        const phrase = latestResult?.[0]?.transcript.trim() || '';
        setLiveTranscript(transcript);
        setLivePhrase(phrase);
        setLiveStatus(latestResult && !latestResult.isFinal
          ? 'Live interim subtitle; it will refine as speech recognition processes your voice.'
          : 'Listening to English speech.');
      };
      current.onerror = event => {
        const messages = {
          'not-allowed': 'Microphone access was blocked. Allow access in the browser and try again.',
          'service-not-allowed': 'Speech recognition is unavailable in the browser.',
          'audio-capture': 'No microphone was found. Connect a microphone and try again.',
          'no-speech': 'No speech detected yet; continuing to listen.'
        };
        setLiveStatus(messages[event.error] || `Speech recognition error: ${event.error}.`);
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
          liveActiveRef.current = false;
          setLiveActive(false);
        }
      };
      current.onend = () => {
        if (!liveActiveRef.current || recognition.current !== current) return;
        restartTimer.current = window.setTimeout(() => {
          try {
            if (liveActiveRef.current && recognition.current === current) {
              setLiveStatus('Reconnecting to speech recognition...');
              current.start();
            }
          } catch (error) {
            liveActiveRef.current = false;
            setLiveActive(false);
            setLiveStatus(`Could not restart speech recognition: ${error.message}`);
          }
        }, 300);
      };
      current.start();
      setLiveActive(true);
      setLiveTranscript('');
      setLivePhrase('');
      letterQueue.current = [];
      letterWord.current = '';
      queuedLetterCount.current = 0;
      setLiveStatus('Starting speech recognition... allow microphone access if prompted.');
    } catch (error) {
      liveActiveRef.current = false;
      setLiveActive(false);
      setLiveStatus(`Could not start speech recognition: ${error.message}`);
    }
  };

  const transcribe = async id => {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch(`${API}/lectures/${id}/transcribe`, { method: 'POST' });
      const updated = await readResponse(response);
      if (!updated.transcript) throw new Error('The transcription service returned an empty transcript.');
      setSelected(current => current?._id === id
        ? { ...current, ...updated }
        : current);
      setNotice('English translation is ready. Play the media to show synchronized captions and hand signs.');
      await load();
    } catch (error) {
      setNotice(`Could not generate a transcript: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const updateMediaSubtitles = event => {
    const captions = selected?.captions;
    if (!Array.isArray(captions) || captions.length === 0) return;

    const currentTime = event.currentTarget.currentTime;
    const segment = captions.find(caption =>
      currentTime >= caption.start &&
      (caption.end <= caption.start || currentTime < caption.end)
    );
    if (!segment) {
      setMediaCaption('');
      mediaSignRef.current = null;
      setMediaSign(null);
      return;
    }

    setMediaCaption(segment.text);
    const sign = getSignAtTime(segment.text, currentTime - segment.start);
    if (!sign) {
      mediaSignRef.current = null;
      setMediaSign(null);
      return;
    }

    const cacheKey = `${sign.type}:${sign.symbol}`;
    if (mediaSignRef.current?.cacheKey === cacheKey) return;

    const request = { ...sign, cacheKey };
    mediaSignRef.current = request;
    setMediaSign({ ...request, src: null });
    getSignImage(sign.type, sign.symbol)
      .then(src => {
        if (mediaSignRef.current === request) {
          setMediaSign({ ...request, src });
        }
      })
      .catch(error => {
        if (mediaSignRef.current === request) {
          setNotice(`Could not load the translated hand sign: ${error.message}`);
        }
      });
  };

  const visible = lectures.filter(item =>
    `${item.title} ${item.transcript}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <main>
      <nav className="top-nav">
        <a href="/download.html">Download Meet extension ↗</a>
      </nav>

      <header>
        <div>
          <span className="eyebrow">SIGNBRIDGE / SMART LECTURE</span>
          <h1>Learn every lecture<br /><em>in your language.</em></h1>
          <p>Accessible lecture capture with live English subtitles, searchable transcripts, and Indian Sign Language number signs.</p>
        </div>
        <div className="avatar" aria-label="Indian Sign Language">
          👋
          <small>Indian Sign<br />Language</small>
        </div>
      </header>

      <section className="live-panel" aria-label="Live subtitles and number signs">
        <div className="live-heading">
          <div>
            <span className="eyebrow">LIVE ENGLISH → ISL HAND SIGNS</span>
            <h2>Live subtitles &amp; signs</h2>
          </div>
          <button type="button" onClick={liveActive ? stopLiveSubtitles : startLiveSubtitles}>
            {liveActive ? 'Stop live subtitles' : 'Start live subtitles'}
          </button>
        </div>
        <div className="live-output">
          <div>
            <p className="live-status" role="status">{liveStatus}</p>
            <p className="live-transcript">{liveTranscript || 'Your live English subtitles will appear here.'}</p>
          </div>
          {liveSign && (
            <div className="live-sign">
              <img
                key={liveSign.playId || `${liveSign.type}:${liveSign.symbol}`}
                src={liveSign.src}
                alt={`Indian Sign Language ${liveSign.label} hand sign`}
                onError={() => setLiveStatus('The hand-sign image could not be displayed. Refresh the page and try again.')}
              />
              <strong>{liveSign.label}</strong>
            </div>
          )}
        </div>
        <p className="live-help">Number words show their number sign. Other spoken words are spelled one letter sign at a time, 400 ms per letter. Speech recognition uses your browser microphone.</p>
      </section>

      <section className="capture">
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Lecture title (optional)"
          aria-label="Lecture title"
        />
        <label className="upload">
          Upload audio / video
          <input
            type="file"
            accept="audio/*,video/*"
            disabled={busy}
            onChange={event => {
              void save(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <button type="button" onClick={recording ? stopRecording : startRecording} disabled={busy}>
          {recording ? '■ Stop recording' : '● Record lecture'}
        </button>
      </section>
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="layout">
        <aside>
          <div className="section-title">
            <span>LECTURE LIBRARY</span>
            <b>{lectures.length}</b>
          </div>
          <input
            className="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search transcripts..."
            aria-label="Search lectures and transcripts"
          />
          {visible.map(item => (
            <button
              className={`lecture ${selected?._id === item._id ? 'active' : ''}`}
              onClick={() => setSelected(item)}
              key={item._id}
            >
              <strong>{item.title}</strong>
              <small>{new Date(item.createdAt).toLocaleDateString()}</small>
            </button>
          ))}
        </aside>

        <article>
          {selected ? (
            <>
              <span className="eyebrow">NOW VIEWING</span>
              <h2>{selected.title}</h2>
              <div className={`media-player ${selected.mimeType?.startsWith('video/') ? 'video-player' : 'audio-player'}`}>
                {selected.mimeType?.startsWith('video/') ? (
                  <video
                    key={selected._id}
                    controls
                    src={`/uploads/${encodeURIComponent(selected.filename)}`}
                    onTimeUpdate={updateMediaSubtitles}
                    onSeeked={updateMediaSubtitles}
                  />
                ) : (
                  <audio
                    key={selected._id}
                    controls
                    src={`/uploads/${encodeURIComponent(selected.filename)}`}
                    onTimeUpdate={updateMediaSubtitles}
                    onSeeked={updateMediaSubtitles}
                  />
                )}
                {selected.captions?.length > 0 && mediaCaption && (
                  <div className="media-caption" aria-live="polite">
                    <p>{mediaCaption}</p>
                    {mediaSign?.src && (
                      <div className="media-caption-sign">
                        <img src={mediaSign.src} alt={`ISL ${mediaSign.label} hand sign`} />
                        <strong>{mediaSign.label}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="transcript-head">
                <h3>Transcript</h3>
                <button type="button" onClick={() => void transcribe(selected._id)} disabled={busy}>
                  {busy ? 'Translating…' : 'Translate audio/video to English'}
                </button>
              </div>
              <div className="transcript">
                {selected.transcript || 'Translate this audio or video to create English subtitles. Play the media to follow the translated captions and ISL signs.'}
              </div>
            </>
          ) : (
            <div className="empty">
              <div>🎓</div>
              <h2>Your lecture space is ready.</h2>
              <p>Upload a lecture or record one to begin, or start live subtitles above.</p>
            </div>
          )}
        </article>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
