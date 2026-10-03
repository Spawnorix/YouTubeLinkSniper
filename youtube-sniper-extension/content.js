console.log("[SNIPER] Sniper loaded");

// Constants & State
let enabled = false;
let observer = null;
let isLivePage = false;
let cooldown = false;
let watchdogStarted = false;
let lastHitTime = null;
let openSound = null;

const processedLinks = new Map();
const processedUsers = new Map();

const DUPLICATE_TIMEOUT = 1e9;
const LINK_LOCK_MS = 1000;

let globalStreamer = "@stream";

// Settings
let settings = {
    sound: true,
    ignoreSameUser: false,
    autoStop: false,
    autoCopy: true,
    bypassCooldown: false,
    streamerOnly: false
};

// Startup
const firedLinks = new Map();

chrome.storage.local.get(["settings"], (data) => {
    if (!data.settings) {
        chrome.storage.local.set({
            // Default
            settings: {
                sound: true,
                ignoreSameUser: false,
                autoStop: false,
                autoCopy: true,
                bypassCooldown: false,
                streamerOnly: false
            }
        });
    }

});

chrome.storage.local.set({ enabled: false });
chrome.runtime.sendMessage({ type: "test" });

chrome.storage.local.get(["settings"], (data) => {
    settings = Object.assign(settings, data.settings || {});

    updateSound(settings.soundFile);
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
        settings = changes.settings.newValue;

        updateSound(settings.soundFile);
    }
});

chrome.storage.local.get(["enabled"], (data) => {
    enabled = !!data.enabled;
});

// Functions
// Sound
function updateSound(file) {

    if (!file) return;

    try {

        const soundUrl = chrome.runtime.getURL(file);

        openSound = new Audio(soundUrl);

        openSound.preload = "auto";
        openSound.volume = 0.6;

        openSound.load();

        console.log("[SOUND] Loaded:", soundUrl);

    } catch (e) {
        console.log("[SOUND] Load error:", e);
    }
}

async function playOpenSound() {

    if (!settings.sound) return;
    if (!openSound) return;

    try {

        openSound.pause();

        openSound.currentTime = 0;

        const cloned = openSound.cloneNode();

        cloned.volume = 0.6;

        await cloned.play();

        console.log("[SOUND] Played");

    } catch (e) {
        console.log("[SOUND] Play failed:", e);
    }
}

// Cleanup
function cleanProcessed() {

    const now = Date.now();

    for (const [key, time] of processedLinks.entries()) {
        if (now - time > DUPLICATE_TIMEOUT * 1000) {
            processedLinks.delete(key);
        }
    }
}

// Stop on refresh
window.addEventListener("beforeunload", () => {
    chrome.storage.local.set({ enabled: false });
    enabled = false;

    if (observer) {
        observer.disconnect();
        observer = null;
    }
});

// Cooldown
function startCooldown() {

    if (settings.bypassCooldown) return;

    cooldown = true;

    const endTime = Date.now() + 10000;

    chrome.storage.local.set({ cooldownEnd: endTime });

    setTimeout(() => {
        cooldown = false;
        chrome.storage.local.set({ cooldownEnd: 0 });
    }, 10000);
}

// Watchdog
function watchChatReconnect() {

    if (watchdogStarted) return;
    watchdogStarted = true;

    setInterval(() => {

        if (!enabled) return;

        const iframe = document.querySelector("iframe#chatframe, iframe[src*='live_chat']");
        if (!iframe) return;

        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const chat = doc.querySelector("#items");

        // Reattach observer if chat disappears
        if (!chat) {
            console.log("[SNIPER] chat lost — retrying...");
            waitForChat();
        }

    }, 5000);
}

// Link Opening
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

function openLink(url, detectTime) {

    try {

        // Clean URL
        const cleanUrl = String(url || "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();

        if (!cleanUrl) return;

        console.log("[SNIPER] OPENING:", cleanUrl);

        // Open link in new tab
        const win = window.open(cleanUrl, "_blank");

        if (!win) {
            console.log("[SNIPER] popup blocked — fallback");
            location.href = cleanUrl;
        }

        // Log open delay
        if (detectTime) {
            console.log(
                "[SNIPER] open delay:",
                Math.round(performance.now() - detectTime),
                "ms"
            );
        }

    } catch (e) {
        console.log("[SNIPER] openLink error:", e);
    }
}

// Link Detection
async function scanNode(node) {
    try {
        if (!node || node.nodeType !== 1) return;

        const matches = [];
        const now = Date.now();

        // Extract Roblox links from anchors
        const anchors = node.querySelectorAll?.("a[href]") || [];

        for (const a of anchors) {
            if (!a) continue;

            let href = a.href || "";
            if (!href) continue;

            // Resolve YouTube redirect URLs
            if (href.includes("youtube.com/redirect")) {
                try {
                    const url = new URL(href);
                    const real = url.searchParams.get("q");
                    if (real) href = real;
                } catch {}
            }

            href = href.replace(/&amp;/g, "&");

            try {
                href = new URL(href, document.baseURI).toString();
            } catch {}

            if (
                // Match Roblox server links
                href.includes("roblox.com/share") &&
                href.includes("&type=Server") &&
                !href.includes("...")
            ) {
                matches.push(href);
            }
        }

        // Check if the node itself is a link
        if (node.matches?.("a[href]")) {
            let href = node.href || "";

            if (href.includes("youtube.com/redirect")) {
                try {
                    const url = new URL(href);
                    const real = url.searchParams.get("q");
                    if (real) href = real;
                } catch {}
            }

            if (
                href.includes("roblox.com/share") &&
                href.includes("&type=Server") &&
                !href.includes("...")
            ) {
                matches.push(href);
            }
        }

        // Extract plain Roblox links
        const text = (node.innerText || "").replace(/[\u200B-\u200D\uFEFF]/g, "");

        const regex = text.match(
            /https:\/\/www\.roblox\.com\/share\?code=[a-zA-Z0-9]+&type=Server/g
        );

        if (regex) {
            for (const r of regex) {
                if (!r.includes("...")) matches.push(r);
            }
        }

        if (!matches.length) return;

        const streamer = globalStreamer || "@stream";
        cleanProcessed();

        const detectTime = performance.now();

        // Process detected links
        for (const raw of matches) {
            const cleanLink = raw.trim();

            if (!window.__firedLinks) window.__firedLinks = new Map();

            // Prevent duplicate openings
            const lastFire = window.__firedLinks.get(cleanLink);
            if (lastFire && now - lastFire < 1500) continue;

            window.__firedLinks.set(cleanLink, now);

            // Validate link
            if (!cleanLink.includes("&type=Server")) continue;
            if (cleanLink.includes("...")) continue;
            if (!cleanLink.includes("roblox.com/share")) continue;

            // Cooldown & Duplicate protection
            if (!settings.bypassCooldown && cooldown) continue;
            if (!settings.bypassCooldown && processedLinks.has(cleanLink)) continue;

            if (!settings.bypassCooldown) {
                processedLinks.set(cleanLink, now);
            }

            let user = "user";

            const messageEl =
                node.closest?.("yt-live-chat-text-message-renderer") ||
                node.closest?.("yt-live-chat-paid-message-renderer") ||
                node.closest?.("yt-live-chat-membership-item-renderer");

            if (messageEl) {
                const authorEl = messageEl.querySelector("#author-name");
                if (authorEl) user = authorEl.innerText || "user";
            }

            const cleanUser = user
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .replace(/^@+/, "")
                .trim();

            const normalizedUser = cleanUser.toLowerCase();

            // Only allow links posted by the streamer/channel owner
            if (settings.streamerOnly) {
                const normalizedStreamer = streamer.replace(/^@+/, "").toLowerCase();
                if (normalizedUser !== normalizedStreamer) continue;
            }

            // Ignore previously detected users
            if (settings.ignoreSameUser && processedUsers.has(normalizedUser)) continue;

            if (settings.ignoreSameUser) {
                processedUsers.set(normalizedUser, true);
            }

            const reactionTime = Math.max(
                1,
                Math.floor(performance.now() - detectTime)
            );

            // Unique ID per link instance
            const id = crypto.randomUUID();

            if (!window.__recentQueue) window.__recentQueue = Promise.resolve();

            // Save to recent links
            window.__recentQueue = window.__recentQueue.then(() => {
                return new Promise((resolve) => {
                    chrome.storage.local.get(["recentLinks"], (data) => {
                        const recentLinks = data.recentLinks || [];

                        recentLinks.unshift({
                            id,
                            streamer,
                            user: "@" + cleanUser,
                            url: cleanLink,
                            time: Date.now()
                        });

                        chrome.storage.local.set({ recentLinks }, resolve);
                    });
                });
            });

            // Open detected link
            if (enabled) {
              setTimeout(() => {
                openLink(cleanLink, detectTime);

                // Auto copy link
                if (settings.autoCopy) {
                    try {
                        navigator.clipboard.writeText(cleanLink);
                    } catch {}
                }

                // Play notification sound (default)
                if (settings.sound) {
                    try {
                        const audio = new Audio(
                            chrome.runtime.getURL(
                                settings.soundFile ||
                                    "notifications/Notification1.mp3"
                            )
                        );

                        audio.volume = 0.6;

                        const playPromise = audio.play();

                        if (playPromise !== undefined) {
                            playPromise.catch((err) => {
                                console.log("[SNIPER] sound blocked:", err);
                            });
                        }
                    } catch (e) {
                        console.log("[SNIPER] sound error:", e);
                    }
                }

                if (!settings.bypassCooldown) startCooldown();

                // Update stats & saved links
                chrome.storage.local.get(["stats", "links"], (data) => {
                    const stats = data.stats || {
                        opened: 0,
                        detected: 0,
                        lastHit: 0,
                        fastestHit: 0
                    };

                    const links = data.links || [];

                    stats.detected++;
                    stats.opened++;
                    stats.lastHit = Date.now();

                    if (!stats.fastestHit || reactionTime < stats.fastestHit) {
                        stats.fastestHit = reactionTime;
                    }

                    // Store unique instance
                    links.unshift({
                        id,
                        streamer,
                        user: "@" + cleanUser,
                        url: cleanLink
                    });

                    chrome.storage.local.set({ stats, links });
                });

                // Stop after successful hit
                if (settings.autoStop) stop();
              }, 150);
            }
        }
    } catch (e) {
        console.log("[SNIPER ERROR]", e);
    }
}

// Streamer Detection
function captureStreamer() {
    try {
        let raw = null;

        const owner =
            document.querySelector('#owner a[href*="/@"]') ||
            document.querySelector('ytd-video-owner-renderer a[href*="/@"]') ||
            document.querySelector('#channel-name a[href*="/@"]');

        if (owner?.href) {
            const match = owner.href.match(/youtube\.com\/(@[^\/\?]+)/);
            if (match) raw = match[1];
        }

        if (!raw) {
            const fallback = location.href.match(/youtube\.com\/(@[^\/\?]+)/);
            if (fallback) raw = fallback[1];
        }

        if (raw) {
            globalStreamer = raw.startsWith("@") ? raw : "@" + raw;
            console.log("[SNIPER] Streamer detected:", globalStreamer);
        }

    } catch (e) {
        console.log("captureStreamer error", e);
    }
}

// Chat Observer
function waitForChat() {

    const iframe = document.querySelector("iframe#chatframe, iframe[src*='live_chat']");
    if (!iframe) return setTimeout(waitForChat, 1000);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    if (!doc) return setTimeout(waitForChat, 1000);

    const chat = doc.querySelector("#items");
    if (!chat) return setTimeout(waitForChat, 1000);

    isLivePage = true;

    captureStreamer();

    // Reset previous observer
    if (observer) observer.disconnect();

    observer = new MutationObserver((muts) => {

        if (!enabled) return;

        for (const m of muts) {

            for (const n of m.addedNodes) {

                if (!n || n.nodeType !== 1) continue;

                const messageEl =
                    n.tagName === "YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER" ||
                    n.tagName === "YT-LIVE-CHAT-PAID-MESSAGE-RENDERER" ||
                    n.tagName === "YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER"
                        ? n
                        : n.querySelector?.(
                            "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-membership-item-renderer"
                        );

                // Scan
                if (messageEl) {
                    scanNode(messageEl);
                }
            }
        }

    });

    observer.observe(chat, {
        childList: true,
        subtree: true
    });
}

// Controls
// Start
function start() {

    enabled = true;

    const startTime = Date.now();

    chrome.storage.local.set({
        enabled: true,
        sessionStart: startTime
    });

    console.log("[SNIPER] started");

    watchChatReconnect();
    waitForChat();
}

// Stop
function stop() {

    enabled = false;
    watchdogStarted = false;

    chrome.storage.local.set({ enabled: false });

    console.log("[SNIPER] stopped");

    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

// Messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.action === "start") {
        start();
        sendResponse({ enabled: true });
    }

    if (msg.action === "stop") {
        stop();
        sendResponse({ enabled: false });
    }

    if (msg.action === "getStatus") {
        sendResponse({ enabled });
    }

    return true;
});