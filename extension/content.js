let box = null;
let recognition = null;
let restartTimer = null;
let recognitionEnabled = false;
let lastSignWord = null;

const spriteCache = new Map();
const signImageCache = new Map();
const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

const SIGN_WIDTH = 80;
const SIGN_HEIGHT = 120;

const numberPositions = {
    one: [0, 0],
    two: [1, 0],
    three: [2, 0],
    four: [3, 0],
    five: [4, 0],
    six: [0, 1],
    seven: [1, 1],
    eight: [2, 1],
    nine: [3, 1],
    ten: [4, 1],
    eleven: [0, 2],
    twelve: [1, 2],
    thirteen: [2, 2],
    fourteen: [3, 2],
    fifteen: [4, 2],
    sixteen: [0, 3],
    seventeen: [1, 3],
    eighteen: [2, 3],
    nineteen: [3, 3],
    twenty: [4, 3]
};

function loadSprite(file) {
    if (spriteCache.has(file)) {
        return spriteCache.get(file);
    }

    const imagePromise = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load sprite: ${file}`));
        image.src = chrome.runtime.getURL(`assets/${file}`);
    });

    spriteCache.set(file, imagePromise);
    imagePromise.catch(() => spriteCache.delete(file));
    return imagePromise;
}

async function cropSprite(file, x, y, width, height) {
    const image = await loadSprite(file);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Could not create a canvas context for the sign sprite.");
    }

    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    return canvas.toDataURL("image/png");
}

function getSignImage(word) {
    if (signImageCache.has(word)) {
        return signImageCache.get(word);
    }

    const [column, row] = numberPositions[word];
    const imagePromise = cropSprite(
        "download.png",
        column * SIGN_WIDTH,
        row * SIGN_HEIGHT,
        SIGN_WIDTH,
        SIGN_HEIGHT
    );
    signImageCache.set(word, imagePromise);
    imagePromise.catch(() => signImageCache.delete(word));
    return imagePromise;
}

function preloadSignImages() {
    return Promise.all(Object.keys(numberPositions).map(getSignImage));
}

function findNumber(text) {
    let found = null;

    for (const word of Object.keys(numberPositions)) {
        const pattern = new RegExp(`\\b${word}\\b`, "gi");

        for (const match of text.matchAll(pattern)) {
            if (!found || match.index > found.index) {
                found = { word, index: match.index };
            }
        }
    }

    return found?.word || null;
}

async function showNumberSign(word) {
    const position = numberPositions[word];
    if (!position || !box) {
        return;
    }

    if (lastSignWord === word && box.querySelector(".sign-image")) {
        return;
    }

    lastSignWord = word;
    try {
        const imageUrl = await getSignImage(word);

        if (!box || lastSignWord !== word) {
            return;
        }

        let image = box.querySelector(".sign-image");
        if (!image) {
            image = document.createElement("img");
            image.className = "sign-image";
            box.appendChild(image);
        }

        image.src = imageUrl;
        image.alt = `${word} sign`;
    } catch (error) {
        console.error("SignBridge could not display the number sign:", error);
    }
}

function removeSign() {
    lastSignWord = null;
    box?.querySelector(".sign-image")?.remove();
}

function updateSign(text) {
    const number = findNumber(text);
    if (number) {
        void showNumberSign(number);
    } else {
        removeSign();
    }
}

function setSubtitle(text) {
    const textElement = box?.querySelector("#signbridge-text");
    if (textElement) {
        textElement.textContent = text;
    }
}

function stopRecognition() {
    recognitionEnabled = false;
    if (restartTimer !== null) {
        window.clearTimeout(restartTimer);
        restartTimer = null;
    }

    const currentRecognition = recognition;
    recognition = null;
    if (currentRecognition) {
        currentRecognition.onend = null;
        try {
            currentRecognition.stop();
        } catch (error) {
            console.error("SignBridge could not stop speech recognition cleanly:", error);
        }
    }
}

function startRecognition() {
    if (!SpeechRecognition) {
        setSubtitle("Speech recognition is not supported in this browser. Use the latest Google Chrome or Microsoft Edge.");
        return;
    }

    recognitionEnabled = true;
    const currentRecognition = new SpeechRecognition();
    recognition = currentRecognition;

    currentRecognition.continuous = true;
    currentRecognition.interimResults = true;
    currentRecognition.lang = "en-US";
    currentRecognition.onstart = () => setSubtitle("Listening... speak clearly into your microphone.");
    currentRecognition.onspeechstart = () => setSubtitle("Voice detected; creating live subtitles.");

    currentRecognition.onresult = event => {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join("")
            .trim();
        const latestResult = event.results[event.results.length - 1];
        const phrase = latestResult?.[0]?.transcript.trim() || "";

        setSubtitle(transcript || "Listening...");
        updateSign(phrase);
    };

    currentRecognition.onerror = event => {
        const messages = {
            "not-allowed": "Microphone access was blocked. Allow microphone access for this page, then start subtitles again.",
            "service-not-allowed": "Speech recognition is unavailable. Check your browser settings and try again.",
            "audio-capture": "No microphone was found. Connect or enable a microphone, then start subtitles again.",
            "no-speech": "No speech detected. Listening will continue..."
        };

        setSubtitle(messages[event.error] || `Speech recognition error: ${event.error}. Listening will retry if possible.`);
        console.error("SignBridge speech recognition error:", event.error);

        if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
            recognitionEnabled = false;
        }
    };

    currentRecognition.onend = () => {
        if (!recognitionEnabled || recognition !== currentRecognition) {
            return;
        }

        restartTimer = window.setTimeout(() => {
            restartTimer = null;
            if (!recognitionEnabled || recognition !== currentRecognition) {
                return;
            }

            try {
                setSubtitle("Reconnecting to speech recognition...");
                currentRecognition.start();
            } catch (error) {
                recognitionEnabled = false;
                setSubtitle("Speech recognition could not restart. Click Stop, then Start subtitles to try again.");
                console.error("SignBridge could not restart speech recognition:", error);
            }
        }, 300);
    };

    try {
        currentRecognition.start();
    } catch (error) {
        recognitionEnabled = false;
        setSubtitle("Speech recognition could not start. Check microphone access and try again.");
        console.error("SignBridge could not start speech recognition:", error);
    }
}

function startSubtitles() {
    if (box) {
        return { active: true };
    }

    box = document.createElement("div");
    box.id = "signbridge-subtitles";
    box.innerHTML = `
  <div class="signbridge-content">
    <small>SIGNBRIDGE LIVE SUBTITLES</small>
    <div id="signbridge-text">Listening...</div>
  </div>
`;
    document.body.appendChild(box);
    void preloadSignImages().catch(error => {
        console.error("SignBridge could not preload ISL number signs:", error);
    });
    startRecognition();

    return { active: true };
}

function stopSubtitles() {
    stopRecognition();
    box?.remove();
    box = null;
    lastSignWord = null;

    return { active: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "getState") {
        sendResponse({ active: Boolean(box) });
    } else if (message.type === "start") {
        sendResponse(startSubtitles());
    } else if (message.type === "stop") {
        sendResponse(stopSubtitles());
    }
});
