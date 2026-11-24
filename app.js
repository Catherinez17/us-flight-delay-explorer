"use strict";

const INDEX = {
  date: 0,
  dayOfWeek: 1,
  departureWindow: 2,
  airline: 3,
  origin: 4,
  flights: 5,
  completed: 6,
  delayed15: 7,
  cancelled: 8,
  diverted: 9,
  delayedArrivalDelayMinutes: 10,
  carrierDelayMinutes: 11,
  weatherDelayMinutes: 12,
  nasDelayMinutes: 13,
  securityDelayMinutes: 14,
  lateAircraftDelayMinutes: 15,
  carrierDelayFlights: 16,
  weatherDelayFlights: 17,
  nasDelayFlights: 18,
  securityDelayFlights: 19,
  lateAircraftDelayFlights: 20,
  distanceMiles: 21,
};

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEPARTURE_WINDOWS = ["00-02", "02-04", "04-06", "06-08", "08-10", "10-12", "12-14", "14-16", "16-18", "18-20", "20-22", "22-00"];
const MIN_RANKING_FLIGHTS = 20;
const CAUSES = [
  ["Carrier", "carrierDelayMinutes", "carrierDelayFlights", "Within the airline's control, such as maintenance, crew, cleaning, baggage loading, or fueling."],
  ["Late aircraft", "lateAircraftDelayMinutes", "lateAircraftDelayFlights", "The aircraft used for this flight arrived late from its previous flight."],
  ["National aviation system", "nasDelayMinutes", "nasDelayFlights", "Airport operations, heavy traffic, air traffic control, or non-extreme weather conditions."],
  ["Weather", "weatherDelayMinutes", "weatherDelayFlights", "Extreme weather that delays or prevents safe flight operations."],
  ["Security", "securityDelayMinutes", "securityDelayFlights", "Security-related disruption, such as a breach, terminal evacuation, screening failure, or unusually long screening lines."],
];

const FILTER_NAMES = {
  airline: "Carrier",
  origin: "Origin",
  dayOfWeek: "Day of week",
  departureWindow: "Departure",
};

const state = {
  data: null,
  filters: {
    airline: null,
    origin: null,
    dayOfWeek: [],
    departureWindow: [],
  },
  originLabelToCode: new Map(),
};

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function affectedFlightsLabel(value) {
  return `${numberFormat.format(value)} affected ${value === 1 ? "flight" : "flights"}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rate(delayed, completed) {
  return completed > 0 ? (100 * delayed) / completed : 0;
}

function onTimeRate(metrics) {
  return metrics.completed > 0 ? 100 - rate(metrics.delayed15, metrics.completed) : 0;
}

// The data file stores additive metrics in pre-aggregated cube rows. Keeping all
// rollups in these helpers gives every view the same denominators and totals.
function emptyMetrics() {
  return {
    flights: 0,
    completed: 0,
    delayed15: 0,
    cancelled: 0,
    diverted: 0,
    delayedArrivalDelayMinutes: 0,
    carrierDelayMinutes: 0,
    weatherDelayMinutes: 0,
    nasDelayMinutes: 0,
    securityDelayMinutes: 0,
    lateAircraftDelayMinutes: 0,
    carrierDelayFlights: 0,
    weatherDelayFlights: 0,
    nasDelayFlights: 0,
    securityDelayFlights: 0,
    lateAircraftDelayFlights: 0,
    distanceMiles: 0,
  };
}

function addRow(metrics, row) {
  for (const key of Object.keys(metrics)) metrics[key] += row[INDEX[key]];
  return metrics;
}

function summarize(rows) {
  return rows.reduce(addRow, emptyMetrics());
}

function groupRows(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, emptyMetrics());
    addRow(groups.get(key), row);
  }
  return groups;
}

// Cross-filtering uses one shared state. A view can exclude its own comparison
// dimension so the selected item remains visible alongside its peers.
function matches(row, excluded = new Set()) {
  const f = state.filters;
  const dayMatches = excluded.has("dayOfWeek") || !f.dayOfWeek.length || f.dayOfWeek.includes(row[INDEX.dayOfWeek]);
  const windowMatches = excluded.has("departureWindow") || !f.departureWindow.length || f.departureWindow.includes(row[INDEX.departureWindow]);
  return (
    (excluded.has("airline") || !f.airline || row[INDEX.airline] === f.airline) &&
    (excluded.has("origin") || !f.origin || row[INDEX.origin] === f.origin) &&
    dayMatches &&
    windowMatches
  );
}

function filteredRows(...exclude) {
  const excluded = new Set(exclude);
  return state.data.rows.filter((row) => matches(row, excluded));
}

function hasFilters() {
  return Object.values(state.filters).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
}

function toggleFilter(key, value) {
  state.filters[key] = state.filters[key] === value ? null : value;
  renderAll();
}

function setFilter(key, value) {
  if (key === "dayOfWeek" || key === "departureWindow") {
    const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
    const order = key === "dayOfWeek" ? [1, 2, 3, 4, 5, 6, 7] : DEPARTURE_WINDOWS;
    state.filters[key] = [...new Set(values)].filter((item) => order.includes(item)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  } else {
    state.filters[key] = value;
  }
  renderAll();
}

function resetFilters() {
  state.filters.airline = null;
  state.filters.origin = null;
  state.filters.dayOfWeek = [];
  state.filters.departureWindow = [];
  renderAll();
}

function windowLabel(value, compact = false) {
  if (!value || value === "Unknown") return "Unknown";
  const [startText, endText] = value.split("-");
  const start = Number(startText);
  const end = Number(endText);
  const formatHour = (hour, includeMinutes = false) => {
    const normalized = hour % 24;
    const suffix = normalized < 12 ? "AM" : "PM";
    const display = normalized % 12 || 12;
    return `${display}${includeMinutes ? ":00" : ""} ${suffix}`;
  };
  if (compact) {
    const startSuffix = start < 12 ? "a" : "p";
    const endSuffix = end === 0 || end < 12 ? "a" : "p";
    return `${start % 12 || 12}${startSuffix}–${end % 12 || 12}${endSuffix}`;
  }
  return `${formatHour(start)}–${formatHour(end)}`;
}

function filterLabel(key, value) {
  if (key === "airline") return `${value} · ${state.data.airlines[value] || value}`;
  if (key === "origin") return `${value} · ${state.data.origins[value] || value}`;
  if (key === "dayOfWeek") return value.map((day) => DAYS[day]).join(", ");
  if (key === "departureWindow") return value.map((window) => windowLabel(window)).join(", ");
  return value;
}

function initializeFilterControls() {
  const unique = (index) => [...new Set(state.data.rows.map((row) => row[index]))];
  const airlines = unique(INDEX.airline).sort();
  const origins = unique(INDEX.origin).sort();

  const originOptions = document.querySelector("#origin-options");
  originOptions.innerHTML = origins.map((code) => {
    const label = `${code} · ${state.data.origins[code] || code}`;
    state.originLabelToCode.set(label, code);
    state.originLabelToCode.set(code, code);
    return `<option value="${escapeHtml(label)}"></option>`;
  }).join("");
  const originInput = document.querySelector("#origin-filter");
  const commitOrigin = () => {
    const raw = originInput.value.trim();
    if (!raw) {
      setFilter("origin", null);
      return;
    }
    const code = state.originLabelToCode.get(raw) || state.originLabelToCode.get(raw.toUpperCase());
    if (!code) {
      originInput.setCustomValidity("Choose an airport from the list or enter its three-letter code.");
      originInput.reportValidity();
      return;
    }
    originInput.setCustomValidity("");
    setFilter("origin", code);
  };
  originInput.addEventListener("input", () => originInput.setCustomValidity(""));
  originInput.addEventListener("change", commitOrigin);
  originInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitOrigin();
  });

  const airlineSelect = document.querySelector("#airline-filter");
  airlineSelect.innerHTML = `<option value="">All reporting carriers</option>${airlines.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(`${value} · ${state.data.airlines[value] || value}`)}</option>`).join("")}`;
  airlineSelect.addEventListener("change", () => setFilter("airline", airlineSelect.value || null));

  // Weekdays and departure windows use checkbox menus so non-contiguous
  // selections are possible. Heatmap clicks and brushing update these same arrays.
  const buildMultiFilter = ({ key, detailsSelector, optionsSelector, values, labelFor, clearLabel }) => {
    const details = document.querySelector(detailsSelector);
    const options = document.querySelector(optionsSelector);
    options.innerHTML = `
      <button class="multi-filter-clear" type="button" aria-label="${escapeHtml(clearLabel)}">${escapeHtml(clearLabel)}</button>
      ${values.map((value) => `<label class="multi-option"><input type="checkbox" value="${escapeHtml(value)}" aria-label="${escapeHtml(labelFor(value))}"><span>${escapeHtml(labelFor(value))}</span></label>`).join("")}`;
    const commit = () => {
      const selected = [...options.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => key === "dayOfWeek" ? Number(input.value) : input.value);
      setFilter(key, selected);
    };
    options.addEventListener("change", commit);
    options.querySelector(".multi-filter-clear").addEventListener("click", () => setFilter(key, []));
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      document.querySelectorAll(".multi-filter[open]").forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
  };

  buildMultiFilter({
    key: "dayOfWeek",
    detailsSelector: "#weekday-filter",
    optionsSelector: "#weekday-options",
    values: [1, 2, 3, 4, 5, 6, 7],
    labelFor: (value) => DAYS[value],
    clearLabel: "All days",
  });
  buildMultiFilter({
    key: "departureWindow",
    detailsSelector: "#window-filter",
    optionsSelector: "#window-options",
    values: DEPARTURE_WINDOWS,
    labelFor: (value) => windowLabel(value),
    clearLabel: "All times",
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".multi-filter")) return;
    document.querySelectorAll(".multi-filter[open]").forEach((details) => { details.open = false; });
  });

  document.querySelector("#carrier-count").textContent = `(${airlines.length} in BTS)`;
  document.querySelector("#origin-count").textContent = `(${origins.length})`;
  originInput.placeholder = `All ${origins.length} origins`;
}

function renderFilterControls() {
  const airlineSelect = document.querySelector("#airline-filter");
  airlineSelect.value = state.filters.airline ?? "";
  airlineSelect.classList.toggle("active-filter", Boolean(state.filters.airline));

  const updateMultiFilter = ({ key, detailsSelector, optionsSelector, summarySelector, emptyLabel, selectedLabel }) => {
    const selected = state.filters[key];
    const details = document.querySelector(detailsSelector);
    document.querySelectorAll(`${optionsSelector} input[type="checkbox"]`).forEach((input) => {
      const value = key === "dayOfWeek" ? Number(input.value) : input.value;
      input.checked = selected.includes(value);
    });
    document.querySelector(summarySelector).textContent = selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? selectedLabel(selected[0])
        : `${selected.length} selected`;
    details.classList.toggle("active-filter", selected.length > 0);
  };

  updateMultiFilter({ key: "dayOfWeek", detailsSelector: "#weekday-filter", optionsSelector: "#weekday-options", summarySelector: "#weekday-summary", emptyLabel: "All days", selectedLabel: (value) => DAYS[value] });
  updateMultiFilter({ key: "departureWindow", detailsSelector: "#window-filter", optionsSelector: "#window-options", summarySelector: "#window-summary", emptyLabel: "All times", selectedLabel: (value) => windowLabel(value) });

  const originInput = document.querySelector("#origin-filter");
  originInput.value = state.filters.origin
    ? `${state.filters.origin} · ${state.data.origins[state.filters.origin] || state.filters.origin}`
    : "";
  originInput.classList.toggle("active-filter", Boolean(state.filters.origin));
}

function renderFilters() {
  const container = document.querySelector("#filter-chips");
  const active = [];
  for (const key of ["airline", "origin", "dayOfWeek", "departureWindow"]) {
    const value = state.filters[key];
    if (Array.isArray(value) ? value.length : value) active.push([key, filterLabel(key, value)]);
  }
  container.innerHTML = active.length
    ? active.map(([key, value]) => `<button class="filter-chip" type="button" data-key="${key}" aria-label="Remove ${FILTER_NAMES[key]} filter: ${escapeHtml(value)}"><strong>${FILTER_NAMES[key]}:</strong>&nbsp;${escapeHtml(value)}</button>`).join("")
    : "";
  container.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.key;
      setFilter(key, key === "dayOfWeek" || key === "departureWindow" ? [] : null);
    });
  });
  document.querySelector("#reset-button").disabled = active.length === 0;
}

function scopeItems(excluded = new Set()) {
  const items = [];
  if (!excluded.has("airline") && state.filters.airline) items.push(state.filters.airline);
  if (!excluded.has("origin") && state.filters.origin) items.push(state.filters.origin);
  if (!excluded.has("dayOfWeek") && state.filters.dayOfWeek.length) {
    items.push(state.filters.dayOfWeek.map((day) => DAYS_SHORT[day]).join(", "));
  }
  if (!excluded.has("departureWindow") && state.filters.departureWindow.length) {
    items.push(state.filters.departureWindow.map((window) => windowLabel(window, true)).join(", "));
  }
  return items;
}

function setScope(selector, excluded = []) {
  const items = scopeItems(new Set(excluded));
  const element = document.querySelector(selector);
  element.innerHTML = items.length
    ? `<strong>Applied:</strong> ${items.map(escapeHtml).join(" · ")}`
    : "Scope: all July flights";
  element.classList.toggle("has-scope-filter", items.length > 0);
}

function renderPanelScopes() {
  setScope("#timeline-scope");
  setScope("#carrier-scope", ["airline"]);
  setScope("#airport-scope", ["origin"]);
  setScope("#heatmap-scope");
  setScope("#cause-scope");
}

function renderKpis() {
  const metrics = summarize(filteredRows());
  const ontime = onTimeRate(metrics);
  const avgDelay = metrics.delayed15 ? metrics.delayedArrivalDelayMinutes / metrics.delayed15 : 0;
  const cancelRate = metrics.flights ? (100 * metrics.cancelled) / metrics.flights : 0;
  document.querySelector("#kpi-flights").textContent = numberFormat.format(metrics.flights);
  document.querySelector("#kpi-ontime").textContent = `${ontime.toFixed(1)}%`;
  document.querySelector("#kpi-delay").textContent = avgDelay.toFixed(1);
  document.querySelector("#kpi-cancel").textContent = `${cancelRate.toFixed(1)}%`;
  document.querySelector("#kpi-scope").textContent = hasFilters() ? "Filtered selection" : "All reported flights";
}

function showTooltip(event, title, lines, meaning = "") {
  const tooltip = document.querySelector("#tooltip");
  tooltip.innerHTML = `
    <strong class="tooltip-title">${escapeHtml(title)}</strong>
    ${meaning ? `<div class="tooltip-meaning"><span class="tooltip-section-label">Meaning</span><span>${escapeHtml(meaning)}</span></div>` : ""}
    <div class="tooltip-lines">${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div>`;
  tooltip.hidden = false;
  const pad = 14;
  const box = tooltip.getBoundingClientRect();
  let left = event.clientX + pad;
  let top = event.clientY + pad;
  if (left + box.width > window.innerWidth - pad) left = event.clientX - box.width - pad;
  if (top + box.height > window.innerHeight - pad) top = event.clientY - box.height - pad;
  tooltip.style.left = `${Math.max(pad, left)}px`;
  tooltip.style.top = `${Math.max(pad, top)}px`;
}

function hideTooltip() {
  document.querySelector("#tooltip").hidden = true;
}

function bindTargets(container, handler, tooltipBuilder) {
  container.querySelectorAll(".chart-target").forEach((target) => {
    if (handler) {
      target.addEventListener("click", () => handler(target.dataset));
      target.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handler(target.dataset);
        }
      });
    }
    target.addEventListener("pointermove", (event) => {
      const tip = tooltipBuilder(target.dataset);
      showTooltip(event, tip.title, tip.lines, tip.meaning);
    });
    target.addEventListener("pointerleave", hideTooltip);
    target.addEventListener("blur", hideTooltip);
  });
}

function renderTimeline() {
  const container = document.querySelector("#timeline-chart");
  const grouped = groupRows(filteredRows(), (row) => row[INDEX.date]);
  const entries = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) {
    container.innerHTML = '<p class="filter-empty">No flights match this selection.</p>';
    return;
  }

  const width = 1100;
  const height = 165;
  const margin = { top: 12, right: 18, bottom: 28, left: 58 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const values = entries.map(([, metrics]) => onTimeRate(metrics));
  const minY = Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - 5);
  const maxY = Math.min(100, Math.ceil(Math.max(...values) / 5) * 5 + 5);
  const allDates = [...new Set(state.data.rows.map((row) => row[INDEX.date]))].sort();
  const firstDateMs = Date.parse(`${allDates[0]}T00:00:00Z`);
  const lastDateMs = Date.parse(`${allDates.at(-1)}T00:00:00Z`);
  const dateRangeMs = Math.max(1, lastDateMs - firstDateMs);
  const x = (date) => margin.left + ((Date.parse(`${date}T00:00:00Z`) - firstDateMs) / dateRangeMs) * innerW;
  const y = (value) => margin.top + innerH - ((value - minY) / Math.max(1, maxY - minY)) * innerH;
  const points = entries.map(([date, metrics]) => ({ date, metrics, value: onTimeRate(metrics), x: x(date), y: y(onTimeRate(metrics)) }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const ticks = [minY, (minY + maxY) / 2, maxY];
  const average = onTimeRate(summarize(filteredRows()));
  const selectedWeekdayCount = state.filters.dayOfWeek.length;
  const showEveryAvailableDate = selectedWeekdayCount === 1;
  const dateTicks = showEveryAvailableDate
    ? points.map(({ date, x: tickX }) => ({ date, x: tickX }))
    : Array.from(
        { length: Math.floor((lastDateMs - firstDateMs) / (7 * 24 * 60 * 60 * 1000)) + 1 },
        (_, index) => {
          const tickMs = firstDateMs + index * 7 * 24 * 60 * 60 * 1000;
          const date = new Date(tickMs).toISOString().slice(0, 10);
          return { date, x: x(date) };
        },
      );

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily on-time arrival rate for July 2026, with a ${average.toFixed(1)} percent average reference line.">
      ${ticks.map((tick) => `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"></line><text x="${margin.left - 9}" y="${y(tick) + 4}" text-anchor="end">${tick.toFixed(0)}%</text>`).join("")}
      <line class="reference-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(average)}" y2="${y(average)}"></line>
      <text class="reference-label" x="${width - margin.right - 4}" y="${y(average) - 6}" text-anchor="end">Average ${average.toFixed(1)}%</text>
      <path d="${path}" fill="none" stroke="#1261a0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      ${points.map((point, index) => `<circle class="chart-target data-only-mark" tabindex="0" role="img" aria-label="${escapeHtml(dateFormat.format(new Date(`${point.date}T00:00:00Z`)))}: ${point.value.toFixed(1)} percent on time" data-date="${point.date}" data-index="${index}" cx="${point.x}" cy="${point.y}" r="4" fill="#2f80c9"></circle>`).join("")}
      ${dateTicks.map((tick) => `<text x="${tick.x}" y="${height - 8}" text-anchor="middle">${dateFormat.format(new Date(`${tick.date}T00:00:00Z`))}</text>`).join("")}
      <text x="13" y="${margin.top + innerH / 2}" transform="rotate(-90 13 ${margin.top + innerH / 2})" text-anchor="middle">On-time arrival rate</text>
    </svg>`;

  bindTargets(
    container,
    null,
    ({ date, index }) => {
      const point = points[Number(index)];
      return {
        title: dateFormat.format(new Date(`${date}T00:00:00Z`)),
        lines: [`${point.value.toFixed(1)}% on time`, `${numberFormat.format(point.metrics.flights)} reported flights`, `${rate(point.metrics.delayed15, point.metrics.completed).toFixed(1)}% delayed ≥15 min`],
      };
    }
  );
}

function renderRanking({ selector, groupKey, exclude, selectedValue, titleFor, maxRows = 12 }) {
  const container = document.querySelector(selector);
  const grouped = groupRows(filteredRows(exclude), (row) => row[INDEX[groupKey]]);
  let entries = [...grouped.entries()].map(([key, metrics]) => ({ key, metrics, value: onTimeRate(metrics) }));
  const addRanks = (sortedEntries) => {
    const tieCounts = new Map();
    for (const entry of sortedEntries) {
      const rateKey = entry.value.toFixed(10);
      tieCounts.set(rateKey, (tieCounts.get(rateKey) || 0) + 1);
    }
    let previousValue = null;
    let currentRank = 0;
    return sortedEntries.map((entry, index) => {
      if (previousValue === null || Math.abs(entry.value - previousValue) > 1e-9) currentRank = index + 1;
      previousValue = entry.value;
      return {
        ...entry,
        rank: currentRank,
        tied: tieCounts.get(entry.value.toFixed(10)) > 1,
      };
    });
  };

  // Formal ranks use the minimum-flight threshold. A selected category below
  // the threshold is inserted only as an explicitly unranked reference; when a
  // strict filter leaves no eligible categories, small samples preserve context.
  if (groupKey === "origin") {
    const allEntries = entries.sort(
      (a, b) => b.value - a.value || b.metrics.flights - a.metrics.flights || a.key.localeCompare(b.key)
    );
    const eligible = allEntries.filter((entry) => entry.metrics.flights >= MIN_RANKING_FLIGHTS);
    const ranked = addRanks(eligible);
    const selectedMetrics = selectedValue ? grouped.get(selectedValue) : null;
    const selectedIsEligible = selectedMetrics?.flights >= MIN_RANKING_FLIGHTS;
    if (selectedValue && selectedIsEligible) {
      const selectedIndex = ranked.findIndex((entry) => entry.key === selectedValue);
      const selectedEntry = ranked[selectedIndex];
      const start = Math.max(0, Math.min(selectedIndex - Math.floor((maxRows - 1) / 2), ranked.length - maxRows));
      entries = ranked.slice(start, start + maxRows);
      document.querySelector("#airport-note").textContent = selectedEntry.tied
        ? `Selected: tied rank #${selectedEntry.rank} of ${ranked.length} eligible origins`
        : `Selected: rank #${selectedEntry.rank} of ${ranked.length} eligible origins`;
    } else if (selectedValue && selectedMetrics) {
      const selectedEntry = allEntries.find((entry) => entry.key === selectedValue);
      const referenceEntries = [
        ...ranked,
        { ...selectedEntry, rank: null, tied: false, referenceOnly: true },
      ].sort(
        (a, b) => b.value - a.value || b.metrics.flights - a.metrics.flights || a.key.localeCompare(b.key)
      );
      const selectedIndex = referenceEntries.findIndex((entry) => entry.key === selectedValue);
      const start = Math.max(0, Math.min(selectedIndex - Math.floor((maxRows - 1) / 2), referenceEntries.length - maxRows));
      entries = referenceEntries.slice(start, start + maxRows);
      document.querySelector("#airport-note").textContent = `Selected origin: small sample with only ${numberFormat.format(selectedMetrics.flights)} flights · shown for reference`;
    } else if (!selectedValue && !ranked.length && allEntries.length) {
      entries = allEntries.slice(0, maxRows).map((entry) => ({
        ...entry,
        rank: null,
        tied: false,
        referenceOnly: true,
      }));
      document.querySelector("#airport-note").textContent =
        "No eligible origins · small samples shown for reference";
    } else {
      entries = ranked.slice(0, maxRows);
      document.querySelector("#airport-note").textContent = selectedValue
        ? "Selected: no flights"
        : `Top ${Math.min(maxRows, ranked.length)} of ${ranked.length} eligible origins`;
    }
  } else {
    const allEntries = entries.sort(
      (a, b) => b.value - a.value || b.metrics.flights - a.metrics.flights || a.key.localeCompare(b.key)
    );
    const eligible = allEntries.filter((entry) => entry.metrics.flights >= MIN_RANKING_FLIGHTS);
    const ranked = addRanks(eligible);
    const selectedMetrics = selectedValue ? grouped.get(selectedValue) : null;
    const selectedEntry = selectedValue ? allEntries.find((entry) => entry.key === selectedValue) : null;
    const selectedRankedEntry = selectedValue ? ranked.find((entry) => entry.key === selectedValue) : null;
    const selectedIsSmallSample = selectedMetrics && selectedMetrics.flights < MIN_RANKING_FLIGHTS;
    const showReferenceFallback = !selectedValue && !eligible.length && allEntries.length;
    entries = selectedIsSmallSample
      ? [...eligible, { ...selectedEntry, referenceOnly: true }].sort(
          (a, b) => b.value - a.value || b.metrics.flights - a.metrics.flights || a.key.localeCompare(b.key)
        )
      : showReferenceFallback
        ? allEntries.slice(0, maxRows).map((entry) => ({ ...entry, referenceOnly: true }))
        : eligible;

    const carrierNote = document.querySelector("#carrier-note");
    if (selectedIsSmallSample) {
      carrierNote.textContent = `Selected carrier: small sample with only ${numberFormat.format(selectedMetrics.flights)} flights · shown for reference`;
      carrierNote.hidden = false;
    } else if (selectedValue && !selectedMetrics) {
      carrierNote.textContent = "Selected carrier: no flights";
      carrierNote.hidden = false;
    } else if (selectedRankedEntry) {
      carrierNote.textContent = selectedRankedEntry.tied
        ? `Selected: tied rank #${selectedRankedEntry.rank} of ${ranked.length} eligible carriers`
        : `Selected: rank #${selectedRankedEntry.rank} of ${ranked.length} eligible carriers`;
      carrierNote.hidden = false;
    } else if (showReferenceFallback) {
      carrierNote.textContent = "No eligible carriers · small samples shown for reference";
      carrierNote.hidden = false;
    } else {
      carrierNote.textContent = "";
      carrierNote.hidden = true;
    }
  }
  if (!entries.length) {
    const entityLabel = groupKey === "origin" ? "origins" : "carriers";
    container.innerHTML = `<p class="filter-empty">No ${entityLabel} meet the ${MIN_RANKING_FLIGHTS}-flight ranking minimum.</p>`;
    return;
  }

  const width = 720;
  const rowH = 27;
  const margin = { top: 18, right: 89, bottom: 24, left: 155 };
  const height = margin.top + margin.bottom + entries.length * rowH;
  const innerW = width - margin.left - margin.right;
  const min = Math.max(0, Math.floor(Math.min(...entries.map((entry) => entry.value)) / 5) * 5 - 5);
  const max = Math.min(100, Math.ceil(Math.max(...entries.map((entry) => entry.value)) / 5) * 5 + 5);
  const scale = (value) => margin.left + ((value - min) / Math.max(1, max - min)) * innerW;

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="On-time arrival rate dot plot. Select a row to filter the dashboard.">
      <line class="axis-line" x1="${margin.left}" x2="${margin.left}" y1="0" y2="${height - margin.bottom}"></line>
      ${entries.map((entry, index) => {
        const y = margin.top + index * rowH;
        const selected = selectedValue === entry.key;
        const smallSample = entry.metrics.flights < MIN_RANKING_FLIGHTS;
        const rankLabel = entry.rank ? (entry.tied ? `Tied #${entry.rank} · ` : `#${entry.rank} · `) : "";
        const rowTitle = `${rankLabel}${titleFor(entry.key)}`;
        const rankDescription = entry.rank ? `${entry.tied ? "tied rank" : "rank"} ${entry.rank}; ` : "";
        const sampleDescription = smallSample ? `; small sample, fewer than ${MIN_RANKING_FLIGHTS} reported flights` : "";
        const pointX = scale(entry.value);
        const placeValueLeft = smallSample && pointX > width - margin.right - 90;
        const valueLabelX = pointX + (placeValueLeft ? -11 : 11);
        return `<g class="chart-target" tabindex="0" role="button" aria-label="${escapeHtml(titleFor(entry.key))}: ${rankDescription}${entry.value.toFixed(1)} percent on time${sampleDescription}" data-key="${escapeHtml(entry.key)}" data-index="${index}">
          <rect x="${margin.left}" y="${y}" width="${innerW}" height="${rowH - 2}" fill="transparent"></rect>
          <text x="${margin.left - 10}" y="${y + 15}" text-anchor="end" font-weight="${selected ? 800 : 600}" fill="${selected ? "#8d4109" : "#43576b"}">${escapeHtml(rowTitle)}</text>
          <line class="dot-row-guide" x1="${margin.left}" x2="${width - margin.right}" y1="${y + 10}" y2="${y + 10}"></line>
          <circle class="ranking-dot ${selected ? "selected-dot" : ""}" cx="${pointX}" cy="${y + 10}" r="${selected ? 7 : 6}" fill="${selected ? "#fff0e3" : "#2f80c9"}"></circle>
          <text x="${valueLabelX}" y="${y + 15}" text-anchor="${placeValueLeft ? "end" : "start"}" font-weight="700">${entry.value.toFixed(1)}%${smallSample ? '<tspan fill="#6b7d90" font-size="10.2" font-weight="600"> · small sample</tspan>' : ""}</text>
        </g>`;
      }).join("")}
      <text x="${margin.left}" y="${height - 4}">${min}%</text>
      <text x="${width - margin.right}" y="${height - 4}" text-anchor="end">${max}% on time</text>
    </svg>`;

  bindTargets(
    container,
    ({ key }) => toggleFilter(groupKey, key),
    ({ index }) => {
      const entry = entries[Number(index)];
      const averageDelay = entry.metrics.delayed15 ? entry.metrics.delayedArrivalDelayMinutes / entry.metrics.delayed15 : 0;
      const lines = [`${numberFormat.format(entry.metrics.flights)} reported flights`, `${entry.value.toFixed(1)}% on time`, `${averageDelay.toFixed(1)} avg delay min among delayed arrivals`];
      if (entry.metrics.flights < MIN_RANKING_FLIGHTS) {
        lines.push(`Below the ${MIN_RANKING_FLIGHTS}-flight ranking minimum`, "Shown for reference");
      }
      return {
        title: titleFor(entry.key),
        lines,
      };
    }
  );
}

function heatColor(value, min, max) {
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(0.001, max - min)));
  const a = [234, 244, 251];
  const b = [15, 91, 152];
  const rgb = a.map((start, index) => Math.round(start + (b[index] - start) * t));
  return `rgb(${rgb.join(",")})`;
}

function renderHeatmap() {
  const container = document.querySelector("#heatmap-chart");
  const rows = filteredRows("dayOfWeek", "departureWindow");
  const grouped = groupRows(rows, (row) => `${row[INDEX.dayOfWeek]}|${row[INDEX.departureWindow]}`);
  const windows = DEPARTURE_WINDOWS;
  const cells = [];
  for (let day = 1; day <= 7; day += 1) {
    for (const window of windows) {
      const metrics = grouped.get(`${day}|${window}`) || emptyMetrics();
      cells.push({
        day,
        window,
        metrics,
        hasData: metrics.flights > 0,
        hasRate: metrics.completed > 0,
        value: rate(metrics.delayed15, metrics.completed),
      });
    }
  }
  const values = cells.filter((cell) => cell.hasRate).map((cell) => cell.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const width = 760;
  const height = 268;
  const margin = { top: 54, right: 18, bottom: 12, left: 70 };
  const cellW = (width - margin.left - margin.right) / windows.length;
  const cellH = (height - margin.top - margin.bottom) / 7;
  const selectedDays = state.filters.dayOfWeek;
  const selectedWindows = state.filters.departureWindow;
  const hasTemporalSelection = selectedDays.length > 0 || selectedWindows.length > 0;
  const isSelected = (day, window) => (
    (!selectedDays.length || selectedDays.includes(day)) &&
    (!selectedWindows.length || selectedWindows.includes(window))
  );
  const maximumCandidates = cells.filter((cell) => (
    cell.hasRate && (!hasTemporalSelection || isSelected(cell.day, cell.window))
  ));
  const selectionMaximum = maximumCandidates.length
    ? Math.max(...maximumCandidates.map((cell) => cell.value))
    : null;
  const selectionMinimum = maximumCandidates.length
    ? Math.min(...maximumCandidates.map((cell) => cell.value))
    : null;
  const firstMaximumIndex = selectionMaximum === null
    ? -1
    : cells.findIndex((cell) => maximumCandidates.includes(cell) && Math.abs(cell.value - selectionMaximum) < 1e-9);
  const firstMinimumIndex = selectionMinimum === null
    ? -1
    : cells.findIndex((cell) => maximumCandidates.includes(cell) && Math.abs(cell.value - selectionMinimum) < 1e-9);
  const extremaAreEqual = selectionMinimum !== null && selectionMaximum !== null
    && Math.abs(selectionMinimum - selectionMaximum) < 1e-9;
  const extremeUsesDarkText = (value) => max === min || (value - min) / (max - min) < 0.55;

  document.querySelector("#heat-legend-min").textContent = "Lower delay rate";
  document.querySelector("#heat-legend-max").textContent = "Higher delay rate";
  const legendMarker = document.querySelector("#heat-legend-marker");
  legendMarker.hidden = true;

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Heatmap of delay rate by weekday and two-hour scheduled departure window.">
      <defs>
        <pattern id="no-data-pattern" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#f4f6f8"></rect>
          <line x1="0" y1="0" x2="0" y2="7" stroke="#a7b2bd" stroke-width="2"></line>
        </pattern>
      </defs>
      <text class="heat-axis-title" x="${margin.left + (width - margin.left - margin.right) / 2}" y="13" text-anchor="middle">Scheduled departure time (local)</text>
      ${windows.map((window, index) => {
        const active = selectedWindows.includes(window);
        return `<text x="${margin.left + index * cellW + cellW / 2}" y="${margin.top - 12}" text-anchor="middle" fill="${active ? "#a64b0a" : "#43576b"}" font-weight="${active ? 800 : 400}">${escapeHtml(windowLabel(window, true))}</text>`;
      }).join("")}
      ${DAYS.slice(1).map((day, index) => {
        const dayNumber = index + 1;
        const active = selectedDays.includes(dayNumber);
        return `<text x="${margin.left - 12}" y="${margin.top + index * cellH + cellH / 2 + 4}" text-anchor="end" fill="${active ? "#a64b0a" : "#43576b"}" font-weight="${active ? 800 : 400}">${day}</text>`;
      }).join("")}
      ${cells.map((cell, cellIndex) => {
        const x = margin.left + windows.indexOf(cell.window) * cellW;
        const y = margin.top + (cell.day - 1) * cellH;
        const selected = hasTemporalSelection && isSelected(cell.day, cell.window);
        const ariaValue = !cell.hasData
          ? "no reported flights"
          : cell.hasRate
            ? `${cell.value.toFixed(1)} percent delayed`
            : "no completed arrivals";
        const fill = cell.hasRate ? heatColor(cell.value, min, max) : "url(#no-data-pattern)";
        let extremeLabel = "";
        if (!hasTemporalSelection && extremaAreEqual && cellIndex === firstMinimumIndex) {
          extremeLabel = `Min/Max ${selectionMinimum.toFixed(1)}%`;
        } else if (!hasTemporalSelection && cellIndex === firstMinimumIndex) {
          extremeLabel = `Min ${selectionMinimum.toFixed(1)}%`;
        } else if (!hasTemporalSelection && cellIndex === firstMaximumIndex) {
          extremeLabel = `Max ${selectionMaximum.toFixed(1)}%`;
        }
        const labelUsesDarkText = extremeLabel && extremeUsesDarkText(cell.value);
        return `<rect class="chart-target ${selected ? "selected-mark" : ""} ${!cell.hasData ? "no-data-heat-cell" : ""}" tabindex="0" role="button" aria-label="${DAYS[cell.day]}, ${escapeHtml(windowLabel(cell.window))}: ${ariaValue}" data-day="${cell.day}" data-window="${escapeHtml(cell.window)}" data-value="${cell.hasRate ? cell.value.toFixed(2) : ""}" data-has-rate="${cell.hasRate}" data-flights="${cell.metrics.flights}" x="${x + 2}" y="${y + 2}" width="${Math.max(1, cellW - 4)}" height="${Math.max(1, cellH - 4)}" rx="4" fill="${fill}"></rect>${extremeLabel ? `<text class="extreme-heat-label ${labelUsesDarkText ? "on-light-cell" : ""}" x="${x + cellW / 2}" y="${y + cellH / 2 + 3}" text-anchor="middle">${extremeLabel}</text>` : ""}`;
      }).join("")}
    </svg>`;

  let suppressClick = false;
  bindTargets(
    container,
    ({ day, window }) => {
      if (suppressClick) return;
      const numericDay = Number(day);
      const alreadySelected = state.filters.dayOfWeek.length === 1 && state.filters.dayOfWeek[0] === numericDay && state.filters.departureWindow.length === 1 && state.filters.departureWindow[0] === window;
      state.filters.dayOfWeek = alreadySelected ? [] : [numericDay];
      state.filters.departureWindow = alreadySelected ? [] : [window];
      renderAll();
    },
    ({ day, window }) => {
      const cell = cells.find((entry) => entry.day === Number(day) && entry.window === window);
      if (!cell.hasData) {
        return {
          title: `${DAYS[Number(day)]} · ${windowLabel(window)}`,
          lines: ["No reported flights"],
        };
      }
      const averageDelay = cell.metrics.delayed15
        ? cell.metrics.delayedArrivalDelayMinutes / cell.metrics.delayed15
        : 0;
      const rateLines = cell.hasRate
        ? [`${onTimeRate(cell.metrics).toFixed(1)}% on time`, `${cell.value.toFixed(1)}% delayed ≥15 min`]
        : ["No completed arrivals"];
      return {
        title: `${DAYS[Number(day)]} · ${windowLabel(window)}`,
        lines: [
          `${numberFormat.format(cell.metrics.flights)} reported flights`,
          ...rateLines,
          ...(cell.hasRate ? [`${averageDelay.toFixed(1)} avg delay min among delayed arrivals`] : []),
        ],
      };
    }
  );

  container.querySelectorAll("rect.chart-target").forEach((target) => {
    const updateLegendMarker = () => {
      if (target.dataset.hasRate !== "true" || !values.length) {
        legendMarker.hidden = true;
        return;
      }
      const value = Number(target.dataset.value);
      const position = max === min ? 50 : 100 * (value - min) / (max - min);
      legendMarker.style.left = `${Math.max(0, Math.min(100, position))}%`;
      legendMarker.hidden = false;
    };
    target.addEventListener("pointerenter", updateLegendMarker);
    target.addEventListener("focus", updateLegendMarker);
    target.addEventListener("pointerleave", () => { legendMarker.hidden = true; });
    target.addEventListener("blur", () => { legendMarker.hidden = true; });
  });

  const svg = container.querySelector("svg");

  // Desktop brushing converts the dragged rectangle into contiguous weekday
  // and time-window arrays. A click still selects one cell on any input device.
  let brush = null;
  const cellFromPointer = (event) => {
    const bounds = svg.getBoundingClientRect();
    const localX = ((event.clientX - bounds.left) / bounds.width) * width;
    const localY = ((event.clientY - bounds.top) / bounds.height) * height;
    const column = Math.floor((localX - margin.left) / cellW);
    const row = Math.floor((localY - margin.top) / cellH);
    if (column < 0 || column >= windows.length || row < 0 || row >= 7) return null;
    return { day: row + 1, windowIndex: column };
  };
  const previewBrush = () => {
    const minDay = Math.min(brush.start.day, brush.end.day);
    const maxDay = Math.max(brush.start.day, brush.end.day);
    const minWindow = Math.min(brush.start.windowIndex, brush.end.windowIndex);
    const maxWindow = Math.max(brush.start.windowIndex, brush.end.windowIndex);
    container.querySelectorAll("rect.chart-target").forEach((target) => {
      const targetDay = Number(target.dataset.day);
      const targetWindow = windows.indexOf(target.dataset.window);
      const previewed = targetDay >= minDay && targetDay <= maxDay && targetWindow >= minWindow && targetWindow <= maxWindow;
      target.classList.toggle("brush-preview", previewed);
    });
  };

  svg.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !event.target.closest("rect.chart-target")) return;
    const cell = cellFromPointer(event);
    if (!cell) return;
    brush = { pointerId: event.pointerId, start: cell, end: cell, moved: false, captured: false };
    hideTooltip();
  });
  svg.addEventListener("pointermove", (event) => {
    if (!brush || event.pointerId !== brush.pointerId) return;
    const cell = cellFromPointer(event);
    if (!cell) return;
    if (cell.day !== brush.start.day || cell.windowIndex !== brush.start.windowIndex) {
      brush.moved = true;
      if (!brush.captured) {
        svg.setPointerCapture(event.pointerId);
        brush.captured = true;
      }
    }
    brush.end = cell;
    previewBrush();
    hideTooltip();
    event.preventDefault();
  });
  svg.addEventListener("pointerup", (event) => {
    if (!brush || event.pointerId !== brush.pointerId) return;
    const completedBrush = brush;
    brush = null;
    if (completedBrush.captured && svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!completedBrush.moved) return;
    const minDay = Math.min(completedBrush.start.day, completedBrush.end.day);
    const maxDay = Math.max(completedBrush.start.day, completedBrush.end.day);
    const minWindow = Math.min(completedBrush.start.windowIndex, completedBrush.end.windowIndex);
    const maxWindow = Math.max(completedBrush.start.windowIndex, completedBrush.end.windowIndex);
    suppressClick = true;
    state.filters.dayOfWeek = Array.from({ length: maxDay - minDay + 1 }, (_, index) => minDay + index);
    state.filters.departureWindow = windows.slice(minWindow, maxWindow + 1);
    renderAll();
  });
  svg.addEventListener("pointercancel", () => {
    brush = null;
    container.querySelectorAll(".brush-preview").forEach((target) => target.classList.remove("brush-preview"));
  });
}

function renderCauses() {
  const container = document.querySelector("#cause-chart");
  const metrics = summarize(filteredRows());
  const values = CAUSES.map(([label, minutesKey, flightsKey, description]) => ({
    label,
    value: metrics[minutesKey],
    flights: metrics[flightsKey],
    description,
  }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...values.map((item) => item.value));
  container.innerHTML = values.map((item, index) => {
    const minuteShare = total ? (100 * item.value) / total : 0;
    const delayedFlightShare = metrics.delayed15 ? (100 * item.flights) / metrics.delayed15 : 0;
    return `
    <div class="cause-row chart-target data-only-mark" tabindex="0" role="img" data-index="${index}" aria-label="${escapeHtml(item.label)}: ${affectedFlightsLabel(item.flights)}, ${delayedFlightShare.toFixed(1)} percent of delayed arrivals, ${numberFormat.format(Math.round(item.value))} attributed delay minutes, ${minuteShare.toFixed(1)} percent of reported delay-cause minutes">
      <span>${escapeHtml(item.label)}</span>
      <div class="cause-track" aria-hidden="true">
        <div class="cause-fill" style="width:${(100 * item.value) / max}%"></div>
      </div>
      <span class="cause-value"><strong>${compactFormat.format(Math.round(item.value))} min · ${minuteShare.toFixed(1)}%</strong></span>
    </div>`;
  }).join("");

  bindTargets(container, null, ({ index }) => {
    const item = values[Number(index)];
    const minuteShare = total ? (100 * item.value) / total : 0;
    const delayedFlightShare = metrics.delayed15 ? (100 * item.flights) / metrics.delayed15 : 0;
    return {
      title: item.label,
      meaning: item.description,
      lines: [
        affectedFlightsLabel(item.flights),
        `${delayedFlightShare.toFixed(1)}% of delayed arrivals`,
        `${numberFormat.format(Math.round(item.value))} attributed delay minutes`,
        `${minuteShare.toFixed(1)}% of reported delay-cause minutes`,
      ],
    };
  });
}

function renderAll() {
  // Re-render every coordinated view from the same filter state after a change.
  renderFilterControls();
  renderFilters();
  renderPanelScopes();
  renderKpis();
  renderTimeline();
  renderRanking({
    selector: "#airline-chart",
    groupKey: "airline",
    exclude: "airline",
    selectedValue: state.filters.airline,
    titleFor: (code) => `${code} · ${state.data.airlines[code] || code}`,
  });
  renderRanking({
    selector: "#airport-chart",
    groupKey: "origin",
    exclude: "origin",
    selectedValue: state.filters.origin,
    titleFor: (code) => code,
  });
  renderHeatmap();
  renderCauses();
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const validValues = {
    airline: new Set(state.data.rows.map((row) => row[INDEX.airline])),
    origin: new Set(state.data.rows.map((row) => row[INDEX.origin])),
    dayOfWeek: new Set([1, 2, 3, 4, 5, 6, 7]),
    departureWindow: new Set(state.data.rows.map((row) => row[INDEX.departureWindow])),
  };

  context.registerTool({
    name: "set_dashboard_filters",
    title: "Set dashboard filters",
    description: "Set one or more visible airline-delay dashboard filters and update every coordinated view.",
    inputSchema: {
      type: "object",
      properties: {
        airline: { type: ["string", "null"] },
        origin: { type: ["string", "null"] },
        dayOfWeek: {
          anyOf: [
            { type: "integer", minimum: 1, maximum: 7 },
            { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, uniqueItems: true },
            { type: "null" },
          ],
        },
        departureWindow: {
          anyOf: [
            { type: "string" },
            { type: "array", items: { type: "string" }, uniqueItems: true },
            { type: "null" },
          ],
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      for (const [key, value] of Object.entries(input || {})) {
        if (!(key in state.filters)) throw new Error(`Unknown filter: ${key}`);
        const values = Array.isArray(value) ? value : value === null ? [] : [value];
        if (values.some((item) => !validValues[key].has(item))) throw new Error(`Invalid ${key} value: ${value}`);
        if (key === "dayOfWeek" || key === "departureWindow") {
          const order = key === "dayOfWeek" ? [1, 2, 3, 4, 5, 6, 7] : DEPARTURE_WINDOWS;
          state.filters[key] = values.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        } else {
          state.filters[key] = value;
        }
      }
      renderAll();
      return { filters: { ...state.filters } };
    },
  });

  context.registerTool({
    name: "reset_dashboard_filters",
    title: "Reset dashboard filters",
    description: "Clear every filter and restore the full July 2026 dataset.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute() {
      resetFilters();
      return { filters: { ...state.filters } };
    },
  });
}

async function init() {
  try {
    const response = await fetch("data.json?v=20261101-cause-counts");
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    state.data = await response.json();
    document.querySelector("#period-label").textContent = state.data.meta.period;
    document.querySelector("#source-link").href = state.data.meta.sourceUrl;
    document.querySelector("#method-copy").innerHTML = `
      <p><strong>Dataset.</strong> ${escapeHtml(state.data.meta.period)} BTS Reporting Carrier On-Time Performance data: ${numberFormat.format(state.data.meta.reportedFlights)} reported flights from ${state.data.meta.reportingCarrierCount} reporting carriers and ${state.data.meta.originCount} origin airports.</p>
      <p><strong>Metrics.</strong> An arrival is on time if it is less than 15 minutes late. Average delay is calculated only for arrivals delayed by at least 15 minutes. Departure windows use scheduled local departure time.</p>
      <p><strong>Rankings.</strong> Carrier and airport rankings require at least ${MIN_RANKING_FLIGHTS} reported flights within the current selection. Items below the threshold are excluded from formal ranks but may be shown as small-sample references.</p>
    `;
    document.querySelector("#reset-button").addEventListener("click", resetFilters);
    initializeFilterControls();
    document.querySelector("#loading").remove();
    document.querySelector("#app").hidden = false;
    renderAll();
    registerWebMcp();
  } catch (error) {
    document.body.innerHTML = `<main class="error-state"><h1>Dashboard could not load</h1><p>${escapeHtml(error.message)}</p><p>Serve the dist directory with a local web server instead of opening the file directly.</p></main>`;
  }
}

init();
