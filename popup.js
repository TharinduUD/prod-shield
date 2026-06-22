const statusBadge = document.getElementById("status-badge");
const domainInfo = document.getElementById("domain-info");
const changesList = document.getElementById("changes-list");
const changeCount = document.getElementById("change-count");
const stopBtn = document.getElementById("stop-btn");
const restartBtn = document.getElementById("restart-btn");
const restartNote = document.getElementById("restart-note");
const exportBtn = document.getElementById("export-btn");

const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const mainView = document.getElementById("main-view");
const cfgDomain = document.getElementById("cfg-domain");
const cfgSelectors = document.getElementById("cfg-selectors");
const cfgRestart = document.getElementById("cfg-restart");
const cfgBanner = document.getElementById("cfg-banner");
const cfgDisableButtons = document.getElementById("cfg-disable-buttons");
const settingsSave = document.getElementById("settings-save");
const settingsCancel = document.getElementById("settings-cancel");
const settingsSavedMsg = document.getElementById("settings-saved-msg");

let settingsOpen = false;

function openSettings() {
  chrome.storage.local.get("config", (data) => {
    const cfg = data.config || {};
    cfgDomain.value = cfg.targetDomain || "";
    cfgSelectors.value = (cfg.buttonSelectors || []).join("\n");
    cfgRestart.value =
      cfg.restartMinutes !== undefined ? cfg.restartMinutes : 15;
    cfgBanner.value =
      cfg.bannerDurationMin !== undefined ? cfg.bannerDurationMin : 1;
    cfgDisableButtons.checked = cfg.disableButtonsEnabled !== false;
    settingsSavedMsg.style.display = "none";
  });
  settingsOpen = true;
  settingsToggle.classList.add("active");
  settingsPanel.style.display = "block";
  mainView.style.display = "none";
}

function closeSettings() {
  settingsOpen = false;
  settingsToggle.classList.remove("active");
  settingsPanel.style.display = "none";
  mainView.style.display = "block";
}

settingsToggle.addEventListener("click", () => {
  if (settingsOpen) closeSettings();
  else openSettings();
});

settingsCancel.addEventListener("click", closeSettings);

settingsSave.addEventListener("click", () => {
  const domain = cfgDomain.value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const rawSelectors = cfgSelectors.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const restartMinutes = Math.max(1, parseInt(cfgRestart.value, 10) || 15);
  const bannerDurationMin = Math.max(1, parseInt(cfgBanner.value, 10) || 1);
  const disableButtonsEnabled = cfgDisableButtons.checked;

  chrome.storage.local.get("config", (data) => {
    const existing = data.config || {};
    const newConfig = {
      ...existing,
      targetDomain: domain,
      buttonSelectors: rawSelectors.length
        ? rawSelectors
        : existing.buttonSelectors || [],
      disableButtonsEnabled,
      restartMinutes,
      bannerDurationMin,
    };
    chrome.storage.local.set({ config: newConfig }, () => {
      settingsSavedMsg.style.display = "block";
      setTimeout(() => {
        settingsSavedMsg.style.display = "none";
      }, 3000);

      domainInfo.textContent = `Monitoring: ${domain || "—"}`;
      targetHost = domain;

      if (currentTabId) {
        chrome.tabs.sendMessage(
          currentTabId,
          { type: "CONFIG_UPDATED", config: newConfig },
          () => { chrome.runtime.lastError; }
        );
      }
    });
  });
});

let currentTab = null;
let currentTabId = null;
let currentHost = "";
let targetHost = "";
let currentFields = [];
let lastStoppedState = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  currentTabId = tab?.id;
  try {
    currentHost = new URL(tab.url).hostname;
  } catch (e) {}

  chrome.storage.local.get("config", (data) => {
    const config = data.config || {};
    targetHost = (config.targetDomain || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    domainInfo.textContent = `Monitoring: ${config.targetDomain || "—"}`;
  });

  // Poll storage every 500ms — this drives ALL UI state
  pollState();
  setInterval(pollState, 500);
}

function pollState() {
  if (!currentTabId) return;

  chrome.storage.local.get(
    ["config", `stopped_${currentTabId}`, `changedFields_${currentTabId}`],
    (data) => {
      const config = data.config || {};
      const stopped = !!data[`stopped_${currentTabId}`];
      const fields = data[`changedFields_${currentTabId}`] || [];

      // Update targetHost if config loaded after init
      if (!targetHost && config.targetDomain) {
        targetHost = config.targetDomain
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        domainInfo.textContent = `Monitoring: ${config.targetDomain}`;
      }

      const isOnTarget =
        targetHost &&
        (currentHost === targetHost || currentHost.endsWith("." + targetHost));

      if (!isOnTarget) {
        statusBadge.textContent = "Inactive";
        statusBadge.className = "badge badge-inactive";
        stopBtn.style.display = "flex";
        stopBtn.disabled = true;
        restartBtn.style.display = "none";
        restartNote.textContent = "Not on the monitored domain.";
        return;
      }

      // Update stop/restart buttons based on stopped state
      if (stopped) {
        statusBadge.textContent = "Stopped";
        statusBadge.className = "badge badge-stopped";
        stopBtn.style.display = "none";
        restartBtn.style.display = "flex";
        restartNote.textContent = `Extension is stopped. Auto-restarts in ${config.restartMinutes || 15} minutes, or click Restart.`;
      } else {
        statusBadge.textContent = "Active";
        statusBadge.className = "badge badge-active";
        stopBtn.style.display = "flex";
        restartBtn.style.display = "none";
        if (fields.length > 0) {
          stopBtn.disabled = true;
          restartNote.textContent = "Export change logs before stopping.";
        } else {
          stopBtn.disabled = false;
          restartNote.textContent =
            "Restarts automatically on page refresh or new tab.";
        }
        if (lastStoppedState !== false) {
          stopBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            </svg>
            Stop Extension`;
        }
      }
      lastStoppedState = stopped;

      // Update changed fields list
      currentFields = fields;
      renderChangedFields(fields);
    },
  );
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

function shortUrl(url) {
  try {
    return new URL(url).pathname;
  } catch (e) {
    return url;
  }
}

function renderChangedFields(fields) {
  changeCount.textContent = fields.length;
  exportBtn.style.display = fields.length > 0 ? "flex" : "none";

  if (fields.length === 0) {
    changesList.innerHTML = `<div class="empty-state">No fields changed yet.</div>`;
    return;
  }

  changesList.innerHTML = fields
    .map((f) => {
      const orig = String(f.original ?? "(empty)");
      const curr = String(f.current ?? "(empty)");
      const time = formatTime(f.timestamp);
      const path = shortUrl(f.pageUrl || "");
      return `
      <div class="change-item">
        <div class="change-meta">
          ${path ? `<span class="change-url" title="${escapeHtml(f.pageUrl || "")}">${escapeHtml(path)}</span>` : ""}
          ${time ? `<span class="change-time">${time}</span>` : ""}
        </div>
        <div class="change-label">${escapeHtml(f.label)}</div>
        <div class="change-values">
          <div class="change-val"><span class="val-tag val-orig">Was</span><span class="val-text">${escapeHtml(orig)}</span></div>
          <div class="change-val"><span class="val-tag val-new">Now</span><span class="val-text">${escapeHtml(curr)}</span></div>
        </div>
      </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

exportBtn.addEventListener("click", () => {
  if (!currentFields.length) return;
  const now = new Date();
  const dateStr = now.toLocaleString();
  const rows = currentFields
    .map(
      (f, i) => `
    <tr class="${i % 2 === 0 ? "even" : "odd"}">
      <td>${escapeHtml(f.label)}</td>
      <td class="mono">${escapeHtml(String(f.original ?? ""))}</td>
      <td class="mono">${escapeHtml(String(f.current ?? ""))}</td>
      <td class="url">${escapeHtml(f.pageUrl || "")}</td>
      <td>${escapeHtml(formatTime(f.timestamp))}</td>
    </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Prod Shield — Change Log</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
  h1 { font-size: 20px; color: #1d4ed8; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  .meta { color: #64748b; font-size: 11px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1d4ed8; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr.even td { background: #f8fafc; }
  tr.odd td { background: #fff; }
  .mono { font-family: monospace; font-size: 11px; }
  .url { font-size: 10px; color: #2563eb; word-break: break-all; }
  .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print {
    body { padding: 16px; }
    button { display: none; }
  }
</style>
</head>
<body>
  <h1><img src="data:image/png;base64,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" style="width:28px;height:28px;vertical-align:middle;margin-right:8px;" /> Prod Shield — Change Log</h1>
  <div class="meta">Generated: ${dateStr} &nbsp;·&nbsp; ${currentFields.length} change${currentFields.length !== 1 ? "s" : ""} recorded</div>
  <table>
    <thead>
      <tr>
        <th>Field</th>
        <th>Original Value</th>
        <th>New Value</th>
        <th>Page URL</th>
        <th>Time</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Prod Shield Extension &nbsp;·&nbsp; Exported ${dateStr}</div>
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  chrome.tabs.create({ url: URL.createObjectURL(blob) });
});

stopBtn.addEventListener("click", () => {
  if (!currentTabId) return;
  console.log("currentTabId", currentTabId);
  chrome.runtime.sendMessage({ type: "STOP_EXTENSION", tabId: currentTabId });
});

restartBtn.addEventListener("click", () => {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({
    type: "RESTART_EXTENSION",
    tabId: currentTabId,
  });
});

init();
