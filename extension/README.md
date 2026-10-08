# SignBridge Chrome Extension

## Install during development

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension` folder.
4. Open a Google Meet page.
5. Open the SignBridge toolbar popup and click **Start subtitles**.
6. Allow microphone access when the browser prompts you.

The extension runs on Google Meet pages only. It uses the browser's built-in
Web Speech API for English (`en-US`) recognition and displays recognized
number words from one to twenty using cropped signs from `assets/download.png`.
`assets/download1.png` is included for future alphabet-sign support.

Speech recognition availability and audio processing are controlled by the
browser. SignBridge does not use a SignBridge server, account, database, or
Google Meet private API for subtitles.
