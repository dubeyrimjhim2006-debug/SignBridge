# SignBridge API

Start the API from the project root with `npm --prefix server run dev`. MongoDB
is not required. Lecture records are stored in `server/data/lectures.json` and
uploaded audio/video files are stored in `server/uploads/`.

Browser-based live subtitles work without this API. Translating uploaded audio
or video into timestamped English captions uses the OpenAI audio translation
service and requires `OPENAI_API_KEY` in `server/.env`. The audio translation
service auto-detects supported spoken languages, including Tamil, Telugu, and
Marathi, and returns timestamped English captions for playback.
