const button = document.getElementById("toggle");
const status = document.getElementById("status");

let activeTabId = null;
let subtitlesActive = false;

function render() {
    button.textContent = subtitlesActive ? "Stop subtitles" : "Start subtitles";
}

async function getMeetTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.id || !tab.url?.startsWith("https://meet.google.com/")) {
        return null;
    }

    return tab;
}

async function initialize() {
    try {
        const tab = await getMeetTab();
        if (!tab) {
            status.textContent = "Open a Google Meet tab to use SignBridge.";
            return;
        }

        activeTabId = tab.id;
        const response = await chrome.tabs.sendMessage(activeTabId, {
            type: "getState"
        });
        subtitlesActive = Boolean(response?.active);
        render();
        button.disabled = false;
        status.textContent = subtitlesActive
            ? "Subtitles are active on this Meet tab."
            : "Ready to start live subtitles.";
    } catch (error) {
        status.textContent = "Reload the Google Meet tab, then open SignBridge again.";
        console.error("SignBridge could not connect to the Meet tab:", error);
    }
}

button.addEventListener("click", async () => {
    if (activeTabId === null) {
        return;
    }

    const type = subtitlesActive ? "stop" : "start";
    button.disabled = true;
    status.textContent = type === "start" ? "Starting subtitles..." : "Stopping subtitles...";

    try {
        const response = await chrome.tabs.sendMessage(activeTabId, { type });
        subtitlesActive = Boolean(response?.active);
        render();
        status.textContent = subtitlesActive
            ? "Subtitles started. Allow microphone access if prompted."
            : "Subtitles stopped.";
    } catch (error) {
        status.textContent = "Could not reach this Meet tab. Reload it and try again.";
        console.error("SignBridge could not update subtitles:", error);
    } finally {
        button.disabled = false;
    }
});

void initialize();
