const DEFAULT_CONFIG = {
  targetDomain: "https://www.test.com",
  buttonSelectors: [".test-btn"],
  disableButtonsEnabled: true,
  restartMinutes: 15,
  bannerDurationMin: 1,
  pageIdentifierEnabled: false,
  pageIdentifier: "",
};

const blinkTimers = {};

function startBlink(tabId) {
  if (blinkTimers[tabId]) return;
  let on = true;
  let cycles = 0;
  blinkTimers[tabId] = setInterval(() => {
    on = !on;
    cycles++;
    chrome.action.setBadgeBackgroundColor({
      color: on ? "#e53e3e" : "#ff9900",
      tabId,
    });
    if (cycles >= 12) {
      clearInterval(blinkTimers[tabId]);
      delete blinkTimers[tabId];
      chrome.storage.local.get([`changedFields_${tabId}`], (data) => {
        const count = (data[`changedFields_${tabId}`] || []).length;
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
        if (count > 0) chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
      });
    }
  }, 200);
}

function stopBlink(tabId) {
  if (blinkTimers[tabId]) {
    clearInterval(blinkTimers[tabId]);
    delete blinkTimers[tabId];
  }
}

function setBadgeActive(tabId) {
  chrome.action.setBadgeText({ text: "●", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId });
  chrome.action.setTitle({ title: "Prod Shield — Active", tabId });
}

function setBadgeStopped(tabId) {
  chrome.action.setBadgeText({ text: "⏸", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280", tabId });
  chrome.action.setTitle({ title: "Prod Shield — Stopped", tabId });
}

function setBadgeClear(tabId) {
  chrome.action.setBadgeText({ text: "", tabId });
  chrome.action.setTitle({ title: "Prod Shield", tabId });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("config", (data) => {
    if (!data.config) chrome.storage.local.set({ config: DEFAULT_CONFIG });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith("restart_")) return;
  const tabId = parseInt(alarm.name.replace("restart_", ""));

  chrome.storage.local.set({ [`stopped_${tabId}`]: false }, () => {
    chrome.alarms.clear(`restart_${tabId}`);
    chrome.tabs.sendMessage(tabId, { type: "RESTART" }, () => {
      chrome.runtime.lastError;
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TAB_ID") {
    sendResponse({ tabId: sender.tab?.id });
    return;
  }

  const tabId = sender.tab?.id || message?.tabId;
  if (!tabId) return;

  if (message.type === "DEACTIVATED") {
    stopBlink(tabId);
    setBadgeClear(tabId);
    return;
  }

  if (message.type === "START_EXTENSION") {
    chrome.storage.local.set({ [`stopped_${tabId}`]: false }, () => {
      setBadgeActive(tabId);
    });
    return;
  }

  if (message.type === "STOP_EXTENSION") {
    stopBlink(tabId);
    chrome.storage.local.get("config", (data) => {
      const restartMinutes =
        data.config && data.config.restartMinutes
          ? data.config.restartMinutes
          : 15;
      chrome.storage.local.set({ [`stopped_${tabId}`]: true }, () => {
        setBadgeStopped(tabId);
        chrome.tabs.sendMessage(tabId, { type: "STOP" }, () => {
          chrome.runtime.lastError;
        });
        chrome.alarms.create(`restart_${tabId}`, {
          delayInMinutes: restartMinutes,
        });
      });
    });
    return;
  }

  if (message.type === "RESTART_EXTENSION") {
    chrome.alarms.clear(`restart_${tabId}`);
    chrome.storage.local.set({ [`stopped_${tabId}`]: false }, () => {
      setBadgeActive(tabId);
      chrome.tabs.sendMessage(tabId, { type: "RESTART" }, () => {
        chrome.runtime.lastError;
      });
    });
    return;
  }

  if (message.type === "FIELDS_CHANGED") {
    const count = message.changedFields.length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count), tabId });
      startBlink(tabId);
    } else {
      stopBlink(tabId);
      chrome.action.setBadgeText({ text: "", tabId });
    }
    chrome.storage.local.set({
      [`changedFields_${tabId}`]: message.changedFields,
    });
    return;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    stopBlink(tabId);
    chrome.storage.local.get(`stopped_${tabId}`, (data) => {
      if (data[`stopped_${tabId}`]) {
        chrome.storage.local.remove([`changedFields_${tabId}`]);
        setBadgeStopped(tabId);
      } else {
        chrome.alarms.clear(`restart_${tabId}`);
        chrome.storage.local.remove([
          `stopped_${tabId}`,
          `changedFields_${tabId}`,
        ]);
        setBadgeClear(tabId);
      }
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopBlink(tabId);
  chrome.alarms.clear(`restart_${tabId}`);
  chrome.storage.local.remove([`stopped_${tabId}`, `changedFields_${tabId}`]);
});
