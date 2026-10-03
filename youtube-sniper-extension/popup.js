// Constants & State
// Key
import { validateKey, isKeyVerified } from "./KS.mjs";

// Other State Variables
let running = false;
let buttonCooldown = false;
let cooldownTimer = null;
let lastTabUrl = null;

// DOM Elements
// Main UI
const btn = document.getElementById("toggle");
const status = document.getElementById("status");
const linkList = document.getElementById("linkList");
const cooldownText = document.getElementById("cooldownText");

// Settings
const settingsIcon = document.getElementById("settingsIcon");
const settingsPanel = document.getElementById("settingsPanel");

const soundSetting = document.getElementById("soundSetting");
const soundSelect = document.getElementById("soundSelect");

const ignoreSameUser = document.getElementById("ignoreSameUser");
const autoStop = document.getElementById("autoStop");
const autoCopy = document.getElementById("autoCopy");
const bypassCooldown = document.getElementById("bypassCooldown");
const streamerOnly = document.getElementById("streamerOnly");

const resetLinksBtn = document.getElementById("resetLinksBtn");
const resetRecentLinksBtn = document.getElementById("resetRecentLinksBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");

// Stats
const statOpened = document.getElementById("statOpened");
const statDetected = document.getElementById("statDetected");
const statLastHit = document.getElementById("statLastHit");
const statFastest = document.getElementById("statFastest");

// Recent Links
const recentIcon = document.getElementById("recentIcon");
const recentPanel = document.getElementById("recentPanel");
const recentList = document.getElementById("recentList");

// Utility Functions
// isYouTube
function isYouTube(url = "") {
    return url.includes("youtube.com");
}

// Recent Panel
function closeRecentPanel() {
    const panel = document.getElementById("recentPanel");
    const icon = document.getElementById("recentIcon");

    if (!panel || !icon) return;

    panel.classList.remove("open");
    icon.classList.remove("open");
}

// Resolver
async function resolveFinalUrl(url) {
    return new Promise((resolve) => {

        chrome.tabs.create({ url, active: false }, (tab) => {

            const tabId = tab.id;

            const checkComplete = (updatedTabId, changeInfo, tabInfo) => {

                if (updatedTabId !== tabId) return;

                // Wait for page to fully load
                if (changeInfo.status === "complete") {

                    chrome.tabs.get(tabId, (t) => {

                        const finalUrl = t?.url || url;

                        chrome.tabs.onUpdated.removeListener(checkComplete);
                        chrome.tabs.remove(tabId);

                        resolve(finalUrl);
                    });
                }
            };

            chrome.tabs.onUpdated.addListener(checkComplete);

            // Fallback timeout
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(checkComplete);
                chrome.tabs.remove(tabId);
                resolve(url);
            }, 6000);
        });
    });
}

// Functions

// Key
function normalizeKey(str) {
    return (str || "")
        .toString()
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
}

// State
function loadState() {
    chrome.storage.local.get(["enabled"], (data) => {
        running = !!data.enabled;
        updateUI();
    });
}

// Settings Save
function saveSettings() {
    chrome.storage.local.set({
        settings: {
            sound: soundSetting.checked,
            soundFile: soundSelect.value,
            ignoreSameUser: ignoreSameUser.checked,
            autoStop: autoStop.checked,
            autoCopy: autoCopy.checked,
            bypassCooldown: bypassCooldown.checked,
            streamerOnly: streamerOnly.checked
        }
    });
}

//  UI State Update
function updateUI() {

    if (running) {
        status.textContent = "ON";
        status.style.color = "lime";
        btn.textContent = "Stop";

        btn.classList.add("on");
        btn.classList.remove("off");

    } else {
        status.textContent = "OFF";
        status.style.color = "red";
        btn.textContent = "Start";

        btn.classList.add("off");
        btn.classList.remove("on");
    }
}

// Cooldown
function startCooldown() {

    chrome.storage.local.get(["settings"], (data) => {

        const settings = data.settings || {};

        // Bypass Cooldown
        if (settings.bypassCooldown) {
            chrome.storage.local.set({ cooldownEnd: 0 });
            return;
        }

        const endTime = Date.now() + 10000;

        chrome.storage.local.set({ cooldownEnd: endTime });

        setTimeout(() => {
            chrome.storage.local.set({ cooldownEnd: 0 });
        }, 10000);
    });
}

function startCooldownFromStorage(endTime) {

    chrome.storage.local.get(["settings"], (data) => {

        // Hide cooldown when bypass is true
        if (data.settings?.bypassCooldown) {
            cooldownText.classList.add("cooldownHidden");
            return;
        }

        clearInterval(cooldownTimer);
        cooldownText.classList.remove("cooldownHidden");

        function update() {

            const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

            // Cooldown finished
            if (remaining <= 0) {
                cooldownText.classList.add("cooldownHidden");
                clearInterval(cooldownTimer);
                return;
            }

            cooldownText.textContent = "COOLDOWN: " + remaining;
        }

        // Countdown
        update();
        cooldownTimer = setInterval(update, 1000);

    });
}

// Key System
function initKeySystem() {
    const overlay = document.getElementById("keyOverlay");
    const input = document.getElementById("keyInput");
    const btn = document.getElementById("keySubmit");

    const status =
        document.getElementById("keyStatus") ||
        document.getElementById("keyError");

    // Validate key UI
    if (!overlay || !input || !btn) {
        console.error("Key UI elements missing");
        return;
    }

    btn.addEventListener("click", async () => {
        // Normalize entered key
        const userKey = normalizeKey(input.value);

        if (status) status.textContent = "";

        if (!userKey) {
            if (status) status.textContent = "Please enter a key";
            return;
        }

        // Verify key
        const ok = await validateKey(userKey);

        if (ok) {
            overlay.style.display = "none";
            startApp();
        } else {
            if (status) {
                status.textContent = "Invalid Key";
                status.style.color = "#ff0000";
            }
        }
    });
}

// Data Loading
function loadSettings() {
    chrome.storage.local.get(["settings"], function (data) {

        let s = data.settings;

        if (!s) {
            // Default
            s = {
                sound: true,
                soundFile: "notifications/Notification1.mp3",
                ignoreSameUser: false,
                autoStop: false,
                autoCopy: true,
                bypassCooldown: false,
                streamerOnly: false
            };

            chrome.storage.local.set({ settings: s });
        }

        // Apply settings to UI
        soundSetting.checked = s.sound;
        ignoreSameUser.checked = s.ignoreSameUser;
        autoStop.checked = s.autoStop;
        autoCopy.checked = s.autoCopy;
        bypassCooldown.checked = s.bypassCooldown;
        streamerOnly.checked = s.streamerOnly;

        soundSelect.value = s.soundFile || "notifications/Notification1.mp3";
    });
}

function loadStats() {
    chrome.storage.local.get(["stats"], (data) => {

        const stats = data.stats || {
            opened: 0,
            detected: 0,
            lastHit: 0,
            fastestHit: 0
        };

        statOpened.textContent = stats.opened || 0;
        statDetected.textContent = stats.detected || 0;

        const fastest = Number(stats.fastestHit);

        if (Number.isFinite(fastest) && fastest > 0) {
            statFastest.textContent = fastest + " ms";
        } else {
            statFastest.textContent = "0 ms";
        }

        if (!stats.lastHit) {
            statLastHit.textContent = "0s ago";
            return;
        }

        const diff = Math.floor((Date.now() - stats.lastHit) / 1000);

        if (diff < 60) {
            statLastHit.textContent = diff + "s ago";
        }
        else if (diff < 3600) {
            statLastHit.textContent = Math.floor(diff / 60) + "m ago";
        }
        else if (diff < 86400) {
            statLastHit.textContent = Math.floor(diff / 3600) + "h ago";
        }
        else if (diff < 2592000) {
            statLastHit.textContent = Math.floor(diff / 86400) + "d ago";
        }
        else if (diff < 31536000) {
            statLastHit.textContent = Math.floor(diff / 2592000) + "mon ago";
        }
        else {
            statLastHit.textContent = Math.floor(diff / 31536000) + "y ago";
        }
    });
}

// Recent Links
function loadRecentLinks() {

    chrome.storage.local.get(["recentLinks"], (data) => {

        const links = (data.recentLinks || []).slice(0, 15);

        recentList.innerHTML = "";

        if (links.length === 0) {
            recentList.innerHTML = `<div class="emptyState">No recent links found</div>`;
            return;
        }

        for (const item of links) {

            const div = document.createElement("div");
            div.className = "recentItem";

            div.innerHTML = `
                <div class="linkTopBar">

                    <span class="copyBtn recentTopCopyBtn" title="Copy link">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </span>

                    <span class="deleteBtn recentDeleteBtn" title="Delete">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18"></path>
                            <path d="M8 6V4h8v2"></path>
                            <path d="M19 6l-1 16H6L5 6"></path>
                        </svg>
                    </span>

                </div>

                <div class="linkMainInfo">

                    <div><b>${item.user || "user"}</b></div>

                    <div>
                        <a href="${item.url}" target="_blank" class="recentLink">
                            ${item.url}
                        </a>
                    </div>

                </div>
            `;

            const copyBtn = div.querySelector(".copyBtn");
            const deleteBtn = div.querySelector(".recentDeleteBtn");

            let copyCooldown = false;

            // Copy
            copyBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (copyCooldown) return;
                copyCooldown = true;

                try {
                    await navigator.clipboard.writeText(item.url);

                    copyBtn.classList.add("success");

                    setTimeout(() => {
                        copyBtn.classList.remove("success");
                        copyCooldown = false;
                    }, 700);

                } catch (err) {
                    console.error("Copy failed:", err);
                    copyCooldown = false;
                }
            });

            // Delete
            deleteBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                chrome.storage.local.get(["recentLinks"], (data) => {

                    const recentLinks = (data.recentLinks || []).filter(
                        l => !(l.url === item.url && l.time === item.time)
                    );

                    chrome.storage.local.set({ recentLinks }, () => {
                        loadRecentLinks();
                    });
                });
            });

            recentList.appendChild(div);
        }
    });
}

// Load Links
function loadLinks() {

    chrome.storage.local.get(["links"], (data) => {

        const links = (data.links || []).slice(0, 20);

        linkList.innerHTML = "";

        if (links.length === 0) {
            linkList.innerHTML = `<div class="emptyState">No links found</div>`;
            return;
        }

        for (const item of links) {

            const div = document.createElement("div");
            div.className = "linkEntry";

            const streamer = (item.streamer || "").replace(/^@+/, "");
            const user = (item.user || "").replace(/^@+/, "");

            div.innerHTML = `
                <div class="linkTopBar">
                    <div class="topLeftBtns">

                        <div class="copyBtn" title="Copy link">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </div>

                        <div class="deleteBtn" title="Delete">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18"></path>
                                <path d="M8 6V4h8v2"></path>
                                <path d="M19 6l-1 16H6L5 6"></path>
                            </svg>
                        </div>

                    </div>
                </div>

                <div class="linkMainInfo">

                    <div>
                        <span class="label">Streamer:</span>
                        <a href="https://www.youtube.com/@${streamer}" target="_blank">
                            @${streamer}
                        </a>
                    </div>

                    <div>
                        <span class="label">Message sent by:</span>
                        <a href="https://www.youtube.com/@${user}" target="_blank">
                            @${user}
                        </a>
                    </div>

                    <div>
                        <span class="label">Link:</span>
                        <a href="${item.url}" class="psLink">
                            ${item.url}
                        </a>
                    </div>

                </div>
            `;

            const copyBtn = div.querySelector(".copyBtn");
            const deleteBtn = div.querySelector(".deleteBtn");
            const psLink = div.querySelector(".psLink");

            let copyCooldown = false;

            // Copy
            copyBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (copyCooldown) return;
                copyCooldown = true;

                await navigator.clipboard.writeText(item.url);

                copyBtn.classList.add("success");

                setTimeout(() => {
                    copyBtn.classList.remove("success");
                    copyCooldown = false;
                }, 700);
            });

            // Delete
            deleteBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                chrome.storage.local.get(["links"], (data) => {

                    const links = (data.links || []).filter(l => l.id !== item.id);

                    chrome.storage.local.set({ links }, () => {
                        loadLinks();
                    });
                });
            });

            psLink.addEventListener("click", async (e) => {
                e.preventDefault();

                chrome.tabs.create({
                    url: item.url,
                    active: true
                });
            });

            linkList.appendChild(div);
        }
    });
}

// Startup Validation
isKeyVerified().then((verified) => {
    if (!verified) {
        initKeySystem();
    } else {
        document.getElementById("keyOverlay").style.display = "none";
        startApp();
    }
});

// Reset Buttons
if (resetLinksBtn) {
    resetLinksBtn.addEventListener("click", () => {
        chrome.storage.local.set({ links: [] }, () => {
            loadLinks();
        });
    });
}

if (resetRecentLinksBtn) {
    resetRecentLinksBtn.addEventListener("click", () => {
        chrome.storage.local.set({ recentLinks: [] }, () => {
            loadRecentLinks();
        });
    });
}

if (resetStatsBtn) {
    resetStatsBtn.addEventListener("click", () => {
        chrome.storage.local.set({
            stats: {
                opened: 0,
                detected: 0,
                lastHit: 0,
                fastestHit: null
            }
        }, () => {
            loadStats();
        });
    });
}

// Setting Events
settingsIcon.addEventListener("click", (e) => {
    e.stopPropagation();

    closeRecentPanel();

    settingsPanel.classList.toggle("open");
});

document.addEventListener("click", (e) => {
    if (
        settingsPanel.classList.contains("open") &&
        !settingsPanel.contains(e.target) &&
        !settingsIcon.contains(e.target)
    ) {
        settingsPanel.classList.remove("open");
    }
});

soundSelect.addEventListener("change", () => {
    const file = soundSelect.value;

    const preview = new Audio(chrome.runtime.getURL(file));
    preview.volume = 0.6;

    try {
        preview.play();
    } catch (e) {
        console.log("Sound preview blocked:", e);
    }

    saveSettings();
});

[soundSetting, ignoreSameUser, autoStop, autoCopy, bypassCooldown, streamerOnly, soundSelect].forEach(el => {
    el.addEventListener("change", saveSettings);
});

// Storage Sync
chrome.storage.onChanged.addListener((changes, area) => {

    if (area !== "local") return;

    if (changes.cooldownEnd) {

        chrome.storage.local.get(["settings"], (data) => {

            // ignore cooldown if bypass is true
            if (data.settings?.bypassCooldown) {
                cooldownText.classList.add("cooldownHidden");
                return;
            }

            const endTime = changes.cooldownEnd.newValue;

            if (endTime > Date.now()) {
                startCooldownFromStorage(endTime);
            }

        });
    }

    // Toggle
    if (changes.enabled) {
        running = !!changes.enabled.newValue;
        updateUI();
    }

    if (changes.stats) {
        loadStats();
    }

    if (changes.links) {
        loadLinks();
    }
});

// Main Toggle
btn.addEventListener("click", async () => {

    // Cooldown Lock
    if (buttonCooldown) return;

    buttonCooldown = true;
    setTimeout(() => {
        buttonCooldown = false;
    }, 1000);

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.id) return;

    // Ensure user is on youtube
    if (!tab.url.includes("youtube.com")) {

        status.textContent = "Open YouTube first";
        status.style.color = "orange";

        setTimeout(() => {
            updateUI();
        }, 1000);

        return;
    }

    const action = running ? "stop" : "start";

    // Sync
    chrome.tabs.sendMessage(tab.id, { action }, () => {

        if (chrome.runtime.lastError) return;

        chrome.storage.local.get(["enabled"], (data) => {
            running = !!data.enabled;
            updateUI();
        });
    });
});

// Cooldown Restore
chrome.storage.local.get(["cooldownEnd"], (data) => {
    const endTime = data.cooldownEnd || 0;

    if (endTime > Date.now()) {
        startCooldownFromStorage(endTime);
    }
});

// Tab Detection
chrome.tabs.onActivated.addListener(async () => {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.url) return;

    if (tab.url.includes("youtube.com")) {

        chrome.storage.local.get(["enabled"], (data) => {
            if (data.enabled) {
                running = true;
                updateUI();
            }
        });
    }
});

// Recent Panel
recentIcon.addEventListener("click", () => {

    settingsPanel.classList.remove("open");

    const open = recentPanel.classList.toggle("open");
    recentIcon.classList.toggle("open", open);

    if (open) loadRecentLinks();
});


// Global Click Events
document.addEventListener("click", (e) => {

    const panel = document.getElementById("recentPanel");
    const icon = document.getElementById("recentIcon");

    if (!panel || !icon) return;

    const isOpen = panel.classList.contains("open");
    if (!isOpen) return;

    const clickedInsidePanel = panel.contains(e.target);
    const clickedButton = icon.contains(e.target);

    if (!clickedInsidePanel && !clickedButton) {
        panel.classList.remove("open");
        icon.classList.remove("open");
    }
});

// Startup
function startApp() {
    loadState();
    loadLinks();
    loadSettings();
    loadStats();

    setInterval(() => {
        loadStats();
    }, 1000);
}
