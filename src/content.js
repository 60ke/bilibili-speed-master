(function () {
  "use strict";

  const CONFIG = {
    speeds: [16, 8, 3],
    maxSpeed: 16,
    minSpeed: 0.1,
    storageKey: "bilibili_speed_master_rate",
    persistKey: "persist_speed_enabled",
    pageStorageKey: "bilibili_speed_master_rate_fallback",
    rateAttribute: "data-bilibili-speed-master-rate",
    enabledAttribute: "data-bilibili-speed-master-enabled",
  };

  let currentRate = 1.0;
  let persistEnabled = true;
  let isInitialized = false;
  let isApplyingSpeed = false;
  let attachedVideo = null;
  let allowNativeRateChangeUntil = 0;

  console.log("Bilibili Speed Master: Content Script Loaded");

  function isContextValid() {
    return (
      typeof chrome !== "undefined" && chrome.runtime && !!chrome.runtime.id
    );
  }

  function isValidRate(rate) {
    return (
      !Number.isNaN(rate) && rate >= CONFIG.minSpeed && rate <= CONFIG.maxSpeed
    );
  }

  function normalizeRate(rate) {
    const parsed = parseFloat(rate);
    if (!isValidRate(parsed)) return null;
    return Math.round(parsed * 10) / 10;
  }

  function parseRateText(text) {
    if (!text) return null;

    const normalizedText = text.trim().replace("倍速", "1");
    const match = normalizedText.match(/\d+(?:\.\d+)?/);
    return match ? normalizeRate(match[0]) : null;
  }

  function getFallbackRate() {
    try {
      return normalizeRate(window.localStorage.getItem(CONFIG.pageStorageKey));
    } catch (error) {
      return null;
    }
  }

  function saveFallbackRate(rate) {
    try {
      window.localStorage.setItem(CONFIG.pageStorageKey, String(rate));
    } catch (error) {
      // Ignore localStorage failures in private mode or restricted pages.
    }
  }

  function updateGuardState() {
    const root = document.documentElement;
    if (!root) return;

    root.setAttribute(CONFIG.rateAttribute, String(currentRate));
    root.setAttribute(
      CONFIG.enabledAttribute,
      persistEnabled ? "true" : "false",
    );
  }

  function installMainWorldGuard() {
    const root = document.documentElement;
    if (!root || root.dataset.bilibiliSpeedMasterGuardInstalled === "true")
      return;

    root.dataset.bilibiliSpeedMasterGuardInstalled = "true";
    updateGuardState();

    const script = document.createElement("script");
    script.textContent = `(() => {
      const RATE_ATTR = '${CONFIG.rateAttribute}';
      const ENABLED_ATTR = '${CONFIG.enabledAttribute}';
      const MARKER = Symbol.for('bilibili-speed-master.playback-rate-guard');
      const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
      if (!proto || proto[MARKER]) return;

      const playbackRateDescriptor = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
      const defaultPlaybackRateDescriptor = Object.getOwnPropertyDescriptor(proto, 'defaultPlaybackRate');
      if (!playbackRateDescriptor || !playbackRateDescriptor.get || !playbackRateDescriptor.set) return;

      Object.defineProperty(proto, MARKER, { value: true });

      const getDesiredRate = () => {
        const rootElement = document.documentElement;
        if (!rootElement || rootElement.getAttribute(ENABLED_ATTR) === 'false') return null;

        const rate = Number.parseFloat(rootElement.getAttribute(RATE_ATTR));
        if (!Number.isFinite(rate) || rate <= 0 || rate > ${CONFIG.maxSpeed}) return null;
        return Math.round(rate * 10) / 10;
      };

      const shouldReplaceRate = (nextRate, desiredRate) => {
        return desiredRate !== null && Math.abs(desiredRate - 1) > 0.01 && Math.abs(Number(nextRate) - 1) <= 0.01;
      };

      Object.defineProperty(proto, 'playbackRate', {
        configurable: playbackRateDescriptor.configurable,
        enumerable: playbackRateDescriptor.enumerable,
        get() {
          return playbackRateDescriptor.get.call(this);
        },
        set(nextRate) {
          const desiredRate = getDesiredRate();
          playbackRateDescriptor.set.call(this, shouldReplaceRate(nextRate, desiredRate) ? desiredRate : nextRate);
        }
      });

      if (defaultPlaybackRateDescriptor && defaultPlaybackRateDescriptor.get && defaultPlaybackRateDescriptor.set) {
        Object.defineProperty(proto, 'defaultPlaybackRate', {
          configurable: defaultPlaybackRateDescriptor.configurable,
          enumerable: defaultPlaybackRateDescriptor.enumerable,
          get() {
            return defaultPlaybackRateDescriptor.get.call(this);
          },
          set(nextRate) {
            const desiredRate = getDesiredRate();
            defaultPlaybackRateDescriptor.set.call(this, shouldReplaceRate(nextRate, desiredRate) ? desiredRate : nextRate);
          }
        });
      }

      const restoreDesiredRate = (event) => {
        const media = event.target;
        if (!(media instanceof HTMLMediaElement)) return;

        const desiredRate = getDesiredRate();
        if (desiredRate === null || Math.abs(media.playbackRate - desiredRate) <= 0.01) return;

        window.setTimeout(() => {
          const latestDesiredRate = getDesiredRate();
          if (latestDesiredRate === null || Math.abs(media.playbackRate - latestDesiredRate) <= 0.01) return;
          playbackRateDescriptor.set.call(media, latestDesiredRate);
          if (defaultPlaybackRateDescriptor && defaultPlaybackRateDescriptor.set) {
            defaultPlaybackRateDescriptor.set.call(media, latestDesiredRate);
          }
        }, 0);
      };

      window.addEventListener('ratechange', restoreDesiredRate, true);
      window.addEventListener('loadedmetadata', restoreDesiredRate, true);
      window.addEventListener('canplay', restoreDesiredRate, true);
      window.addEventListener('play', restoreDesiredRate, true);
    })();`;

    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  const fallbackRate = getFallbackRate();
  if (fallbackRate !== null) {
    currentRate = fallbackRate;
  }
  installMainWorldGuard();

  function safeStorageSet(data) {
    if (!isContextValid()) return;

    try {
      chrome.storage.local.set(data);
    } catch (error) {
      console.warn("Bilibili Speed Master: Failed to save settings", error);
    }
  }

  function updateBadge(speed) {
    if (!isContextValid()) return;

    try {
      const result = chrome.runtime.sendMessage({
        type: "UPDATE_BADGE",
        speed: speed,
      });
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch (error) {
      // The page may outlive the extension context after an extension reload.
    }
  }

  function getVideo() {
    const directVideo = document.querySelector("video");
    if (directVideo) return directVideo;

    const bwpVideo = document.querySelector("bwp-video");
    if (!bwpVideo) return null;

    if (bwpVideo.shadowRoot) {
      const shadowVideo = bwpVideo.shadowRoot.querySelector("video");
      if (shadowVideo) return shadowVideo;
    }

    // Some Bilibili player builds expose the inner media element on the custom element.
    return bwpVideo.video || bwpVideo.$video || bwpVideo;
  }

  function updateUI(rate) {
    const speedBtn = document.querySelector(
      ".bpx-player-ctrl-playbackrate-result",
    );
    if (speedBtn) {
      const newText = rate === 1 ? "倍速" : rate + "x";
      if (speedBtn.innerText !== newText) {
        speedBtn.innerText = newText;
      }
    }

    const input = document.querySelector(".custom-speed-input");
    if (input && document.activeElement !== input) {
      input.value = rate;
    }
  }

  function setVideoRate(video, rate) {
    if (!video || typeof video.playbackRate === "undefined") return false;

    if (Math.abs(video.playbackRate - rate) <= 0.01) return true;

    isApplyingSpeed = true;
    try {
      video.playbackRate = rate;
      if ("defaultPlaybackRate" in video) {
        video.defaultPlaybackRate = rate;
      }
      return Math.abs(video.playbackRate - rate) <= 0.01;
    } catch (error) {
      console.warn("Bilibili Speed Master: Failed to apply speed", error);
      return false;
    } finally {
      setTimeout(() => {
        isApplyingSpeed = false;
      }, 0);
    }
  }

  function saveCurrentRate(rate) {
    currentRate = rate;
    saveFallbackRate(rate);
    updateGuardState();
    if (persistEnabled) {
      safeStorageSet({ [CONFIG.storageKey]: rate });
    }
  }

  // Core function to set speed and save to storage.
  // The target speed is saved even if the video element is temporarily missing during refresh.
  function applySpeed(rate, save = true) {
    const normalizedRate = normalizeRate(rate);
    if (normalizedRate === null) return;

    if (save) {
      saveCurrentRate(normalizedRate);
    } else {
      currentRate = normalizedRate;
      saveFallbackRate(normalizedRate);
      updateGuardState();
    }

    const video = getVideo();
    setVideoRate(video, normalizedRate);
    updateUI(normalizedRate);
    updateBadge(normalizedRate);
    attachVideoListeners(video);
  }

  // Force current speed regardless of Bilibili resets.
  function enforce() {
    if (!persistEnabled || !isInitialized) return;

    updateGuardState();

    const video = getVideo();
    attachVideoListeners(video);

    if (video && Math.abs(video.playbackRate - currentRate) > 0.01) {
      console.log(`Bilibili Speed Master: Enforcing speed ${currentRate}x`);
      setVideoRate(video, currentRate);
    }

    updateUI(currentRate);
    updateBadge(currentRate);
  }

  function scheduleEnforce(delay = 0) {
    if (!persistEnabled) return;
    setTimeout(enforce, delay);
  }

  function handleNativeRateChange() {
    if (!isInitialized || !persistEnabled || isApplyingSpeed) return;

    const video = getVideo();
    if (!video) return;

    const nativeRate = normalizeRate(video.playbackRate);
    if (nativeRate === null || Math.abs(nativeRate - currentRate) <= 0.01)
      return;

    const isExplicitNativeSelection = Date.now() < allowNativeRateChangeUntil;

    // Bilibili refresh/player initialization usually writes 1x automatically.
    // Keep the saved custom rate in that case, but still allow the user to choose
    // Bilibili's built-in rates from the original menu.
    if (Math.abs(nativeRate - 1) <= 0.01 && !isExplicitNativeSelection) {
      scheduleEnforce(0);
      scheduleEnforce(100);
      scheduleEnforce(500);
      return;
    }

    saveCurrentRate(nativeRate);
    updateUI(nativeRate);
    updateBadge(nativeRate);
  }

  function attachVideoListeners(video) {
    if (
      !video ||
      video === attachedVideo ||
      typeof video.addEventListener !== "function"
    )
      return;

    if (
      attachedVideo &&
      typeof attachedVideo.removeEventListener === "function"
    ) {
      attachedVideo.removeEventListener(
        "ratechange",
        handleNativeRateChange,
        true,
      );
      attachedVideo.removeEventListener(
        "loadedmetadata",
        handleNativeRateChange,
        true,
      );
      attachedVideo.removeEventListener(
        "canplay",
        handleNativeRateChange,
        true,
      );
      attachedVideo.removeEventListener("play", handleNativeRateChange, true);
    }

    attachedVideo = video;
    video.addEventListener("ratechange", handleNativeRateChange, true);
    video.addEventListener("loadedmetadata", handleNativeRateChange, true);
    video.addEventListener("canplay", handleNativeRateChange, true);
    video.addEventListener("play", handleNativeRateChange, true);
  }

  function handleNativeSpeedMenuSelection(event) {
    const item =
      event.target && event.target.closest
        ? event.target.closest(".bpx-player-ctrl-playbackrate-menu-item")
        : null;
    if (!item || item.classList.contains("custom-speed-item")) return;

    const nativeRate = parseRateText(item.textContent);
    if (nativeRate === null) return;

    // This runs in capture phase before Bilibili's own click handler. Updating the
    // desired rate first keeps our refresh guard from blocking the original menu.
    allowNativeRateChangeUntil = Date.now() + 1500;
    saveCurrentRate(nativeRate);
    updateUI(nativeRate);
    updateBadge(nativeRate);
  }

  document.addEventListener(
    "pointerdown",
    handleNativeSpeedMenuSelection,
    true,
  );
  document.addEventListener("click", handleNativeSpeedMenuSelection, true);

  function injectSpeedMenu() {
    const menu = document.querySelector(".bpx-player-ctrl-playbackrate-menu");
    if (!menu || menu.querySelector(".custom-speed-item")) return;

    // Custom Input
    const inputLi = document.createElement("li");
    inputLi.className = "custom-speed-input-container";
    inputLi.innerHTML = `
            <div class="custom-speed-label">自定义倍速:</div>
            <input type="number" step="0.1" min="${CONFIG.minSpeed}" max="${CONFIG.maxSpeed}" class="custom-speed-input">
        `;
    const input = inputLi.querySelector("input");
    input.value = currentRate;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        const val = normalizeRate(input.value);
        if (val !== null) {
          applySpeed(val);
        }
        e.stopPropagation();
      }
    };
    input.onclick = (e) => e.stopPropagation();
    menu.insertBefore(inputLi, menu.firstChild);

    // Fixed Speeds
    let referenceNode = inputLi.nextSibling;
    CONFIG.speeds.forEach((speed) => {
      const li = document.createElement("li");
      li.className = "bpx-player-ctrl-playbackrate-menu-item custom-speed-item";
      li.innerText = speed + "x";
      li.onclick = (e) => {
        e.stopPropagation();
        applySpeed(speed);
        menu.parentElement.classList.remove("bpx-state-active");
      };
      menu.insertBefore(li, referenceNode);
    });
  }

  // 1. Load Settings
  if (isContextValid()) {
    chrome.storage.local.get(
      [CONFIG.storageKey, CONFIG.persistKey],
      (result) => {
        if (chrome.runtime.lastError) return;

        persistEnabled = result[CONFIG.persistKey] !== false;

        const savedRate = normalizeRate(result[CONFIG.storageKey]);
        if (savedRate !== null) {
          currentRate = savedRate;
          saveFallbackRate(savedRate);
        }
        updateGuardState();

        console.log(
          "Bilibili Speed Master: Settings loaded",
          currentRate,
          "Persist:",
          persistEnabled,
        );
        isInitialized = true;

        // Apply repeatedly during page refresh because the Bilibili player may set 1x
        // after metadata/player initialization.
        enforce();
        scheduleEnforce(100);
        scheduleEnforce(500);
        scheduleEnforce(1500);
      },
    );

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (changes[CONFIG.persistKey]) {
        persistEnabled = changes[CONFIG.persistKey].newValue !== false;
        updateGuardState();
      }

      if (changes[CONFIG.storageKey]) {
        const savedRate = normalizeRate(changes[CONFIG.storageKey].newValue);
        if (savedRate !== null) {
          applySpeed(savedRate, false);
        }
      }
    });
  } else {
    isInitialized = true;
  }

  // 2. Listen for Popup Messages
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "SET_SPEED") {
        applySpeed(message.speed);
      }
    });
  }

  // 3. Heartbeat (The "Ultimate Insurance")
  // Every 1 second, make sure the speed is correct. Low CPU cost, high reliability.
  setInterval(() => {
    if (isInitialized) {
      enforce();
      injectSpeedMenu(); // Also ensure menu is injected if player reloads
    }
  }, 1000);

  // 4. Mutation Observer (For faster response)
  const observer = new MutationObserver(() => {
    if (isInitialized) {
      injectSpeedMenu();
      enforce();
    }
  });

  function startObserver() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", startObserver, {
        once: true,
      });
      return;
    }

    observer.observe(document.body, { childList: true, subtree: true });
  }

  startObserver();

  // 5. Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const video = getVideo();
    if (!video) return;

    if (e.shiftKey && e.key === ">") {
      applySpeed(Math.min(video.playbackRate + 0.5, CONFIG.maxSpeed));
    } else if (e.shiftKey && e.key === "<") {
      applySpeed(Math.max(video.playbackRate - 0.5, CONFIG.minSpeed));
    } else if (e.key.toLowerCase() === "r") {
      applySpeed(1.0);
    }
  });
})();
