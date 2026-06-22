(function () {
  let stopped = false;
  let config = null;
  let changedFields = {};
  let observer = null;
  let initialized = false;

  const currentHost = location.hostname;

  function isOnTargetDomain(targetDomain) {
    const target = targetDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return currentHost === target || currentHost.endsWith("." + target);
  }

  function getFieldLabel(el) {
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.innerText.trim();
    }

    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.innerText.trim();
    }

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) return wrappingLabel.innerText.trim().split("\n")[0];

    const parent = el.parentElement;
    if (parent) {
      const label = parent.querySelector("label");
      if (label) return label.innerText.trim();
      const prev = el.previousElementSibling;
      if (prev && prev.innerText) return prev.innerText.trim();
    }

    if (el.placeholder) return el.placeholder;
    if (el.name) return el.name;
    if (el.id) return el.id;

    return `${el.tagName.toLowerCase()}[${el.type || el.role || ""}]`;
  }

  function getFieldKey(el) {
    if (el.id) return `id:${el.id}`;
    if (el.name) return `name:${el.name}`;

    if (el.getAttribute("data-testid"))
      return `testid:${el.getAttribute("data-testid")}`;

    if (el.getAttribute("aria-label"))
      return `aria:${el.getAttribute("aria-label")}`;

    const all = Array.from(
      document.querySelectorAll(
        "input, textarea, select, [role='switch'], [role='checkbox'], [role='radio'], [role='combobox'], [role='listbox'], [role='option'], [role='menuitemcheckbox'], [role='menuitemradio']",
      ),
    );

    return `pos:${all.indexOf(el)}`;
  }

  function getValue(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || "").toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();

    if (tag === "input") {
      if (type === "checkbox" || type === "radio")
        return el.checked ? "checked" : "unchecked";
      return el.value;
    }

    if (tag === "textarea") return el.value;

    if (tag === "select") {
      return Array.from(el.selectedOptions)
        .map((o) => o.text || o.value)
        .join(", ");
    }

    if (
      role === "switch" ||
      role === "checkbox" ||
      role === "menuitemcheckbox"
    ) {
      return el.getAttribute("aria-checked") === "true" ? "on" : "off";
    }

    if (role === "radio" || role === "menuitemradio") {
      return el.getAttribute("aria-checked") === "true"
        ? "selected"
        : "unselected";
    }

    if (role === "combobox" || role === "listbox") {
      return (
        el.getAttribute("aria-activedescendant") ||
        el.innerText.trim() ||
        el.getAttribute("aria-valuenow") ||
        ""
      );
    }

    if (role === "option") {
      return el.getAttribute("aria-selected") === "true"
        ? "selected"
        : "unselected";
    }

    return (
      el.getAttribute("aria-valuenow") ||
      el.getAttribute("aria-valuetext") ||
      el.innerText?.trim() ||
      ""
    );
  }

  function getInitialValue(el) {
    return el._pgOriginalValue !== undefined
      ? el._pgOriginalValue
      : getValue(el);
  }

  function recordChange(el) {
    if (stopped) return;
    const key = getFieldKey(el);
    const label = getFieldLabel(el);
    const original = getInitialValue(el);
    const current = getValue(el);

    if (current !== original) {
      changedFields[key] = {
        label,
        original,
        current,
        pageUrl: location.href,
        timestamp: new Date().toISOString(),
      };
    } else {
      delete changedFields[key];
    }

    reportChanges();
  }

  function attachListeners(el) {
    if (el._pgListening) return;

    el._pgListening = true;
    if (el._pgOriginalValue === undefined) el._pgOriginalValue = getValue(el);

    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();

    if (tag === "input" || tag === "textarea" || tag === "select") {
      el.addEventListener("input", () => recordChange(el));
      el.addEventListener("change", () => recordChange(el));
    }

    if (
      [
        "switch",
        "checkbox",
        "menuitemcheckbox",
        "radio",
        "menuitemradio",
        "option",
      ].includes(role)
    ) {
      el.addEventListener("click", () =>
        setTimeout(() => recordChange(el), 50),
      );
      el.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter")
          setTimeout(() => recordChange(el), 50);
      });
    }

    if (["combobox", "listbox"].includes(role)) {
      el.addEventListener("change", () => recordChange(el));
      el.addEventListener("click", () =>
        setTimeout(() => recordChange(el), 100),
      );
      const attrObs = new MutationObserver(() => recordChange(el));
      attrObs.observe(el, {
        attributes: true,
        attributeFilter: ["aria-activedescendant"],
      });
    }
  }

  function trackAll() {
    document
      .querySelectorAll(
        [
          "input",
          "textarea",
          "select",
          "[role='switch']",
          "[role='checkbox']",
          "[role='radio']",
          "[role='combobox']",
          "[role='listbox']",
          "[role='option']",
          "[role='menuitemcheckbox']",
          "[role='menuitemradio']",
        ].join(", "),
      )
      .forEach(attachListeners);
  }

  function disableButtons() {
    if (!config || !config.buttonSelectors || stopped) return;

    config.buttonSelectors.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((btn) => {
          btn.setAttribute(
            "data-pageguard-originally-disabled",
            btn.disabled ? "true" : "false",
          );
          btn.disabled = true;
          btn.setAttribute("data-pageguard-disabled", "true");
          btn.style.opacity = "0.5";
          btn.style.cursor = "not-allowed";
          btn.title = "Disabled by Prod Shield";
        });
      } catch (e) {}
    });
  }

  function enableButtons() {
    document.querySelectorAll("[data-pageguard-disabled]").forEach((btn) => {
      const wasOriginallyDisabled =
        btn.getAttribute("data-pageguard-originally-disabled") === "true";
      if (!wasOriginallyDisabled) {
        btn.disabled = false;
      }
      btn.style.opacity = "";
      btn.style.cursor = "";
      btn.title = "";
      btn.removeAttribute("data-pageguard-disabled");
      btn.removeAttribute("data-pageguard-originally-disabled");
    });
  }

  function reportChanges() {
    const fields = Object.values(changedFields);
    chrome.runtime.sendMessage({
      type: "FIELDS_CHANGED",
      changedFields: fields,
    });
  }

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      if (stopped) return;
      let needsRescan = false;

      mutations.forEach((mut) => {
        if (mut.type === "childList") needsRescan = true;
        if (mut.type === "attributes" && mut.target._pgListening)
          recordChange(mut.target);
      });

      if (needsRescan) {
        disableButtons();
        trackAll();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-checked",
        "aria-selected",
        "aria-pressed",
        "value",
        "checked",
      ],
    });
  }

  let bannerInterval = null;

  function startExtension() {
    stopped = false;
    chrome.runtime.sendMessage({ type: "START_EXTENSION" });
    disableButtons();
    trackAll();
    startObserver();
    const bannerMs =
      config && config.bannerDurationMs ? config.bannerDurationMs : 4000;
    showProductionBanner(bannerMs);
    if (bannerInterval) clearInterval(bannerInterval);
    bannerInterval = setInterval(() => showProductionBanner(bannerMs), 30000);
  }

  function init() {
    if (initialized) return;

    chrome.storage.local.get("config", (data) => {
      config = data.config || {
        targetDomain: "ds.mm.us",
        buttonSelectors: ["[data-testid='page-header-save-button']"],
        execution: true,
      };

      if (!isOnTargetDomain(config.targetDomain)) return;

      initialized = true;

      chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (response) => {
        const tabId = response && response.tabId;
        const tabKey = `stopped_${tabId}`;
        chrome.storage.local.get(tabKey, (stoppedData) => {
          stopped = !!stoppedData[tabKey];
          if (!stopped) {
            startExtension();
          }
        });
      });

      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === "STOP") {
          stopped = true;
          enableButtons();
          if (observer) observer.disconnect();
          if (bannerInterval) {
            clearInterval(bannerInterval);
            bannerInterval = null;
          }
          const existingBanner = document.getElementById("prod-shield-banner");
          if (existingBanner) existingBanner.remove();
          changedFields = {};
          reportChanges();
        }

        if (msg.type === "RESTART") {
          startExtension();
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function showProductionBanner(duration) {
    const bannerDuration =
      typeof duration === "number" && duration > 0 ? duration : 4000;
    if (document.getElementById("prod-shield-banner")) return;

    const banner = document.createElement("div");
    banner.id = "prod-shield-banner";
    banner.innerHTML = `
    <span style="font-size:18px;line-height:1;">⚠️</span>
    <span>You are in <strong>Production</strong> — <i>Prod Shield</i></span>
    <div id="prod-shield-timer-bar"></div>
  `;

    Object.assign(banner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      padding: "12px 24px",
      background: "linear-gradient(90deg, #7f1d1d, #991b1b, #7f1d1d)",
      color: "#fef2f2",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "14px",
      fontWeight: "600",
      letterSpacing: "0.2px",
      boxShadow: "0 4px 24px rgba(220,38,38,0.5)",
      borderBottom: "2px solid #ef4444",
      overflow: "hidden",
      transition: "opacity 0.6s ease, transform 0.6s ease",
      opacity: "0",
      transform: "translateY(-100%)",
    });

    const timerBar = banner.querySelector("#prod-shield-timer-bar");
    Object.assign(timerBar.style, {
      position: "absolute",
      bottom: "0",
      left: "0",
      height: "3px",
      width: "100%",
      background: "#ef4444",
      transformOrigin: "left",
      transition: `transform ${bannerDuration / 1000}s linear`,
    });

    document.body.appendChild(banner);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.style.opacity = "1";
        banner.style.transform = "translateY(0)";
        timerBar.style.transform = "scaleX(0)";
      });
    });

    setTimeout(() => {
      banner.style.opacity = "0";
      banner.style.transform = "translateY(-100%)";
      setTimeout(() => banner.remove(), 650);
    }, bannerDuration);
  }
})();
