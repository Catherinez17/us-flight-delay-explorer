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
  distanceMiles: 16,
};

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CAUSES = [
  ["Carrier", "carrierDelayMinutes"],
  ["Late aircraft", "lateAircraftDelayMinutes"],
  ["National aviation system", "nasDelayMinutes"],
  ["Weather", "weatherDelayMinutes"],
  ["Security", "securityDelayMinutes"],
];

const FILTER_NAMES = {
  airline: "Carrier",
  origin: "Origin",
  dayOfWeek: "Weekday",
  departureWindow: "Departure",
};

const state = {
  data: null,
  filters: {
    airline: null,
    origin: null,
    dayOfWeek: null,
    departureWindow: null,
  },
  originLabelToCode: new Map(),
};

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

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

function matches(row, excluded = new Set()) {
  const f = state.filters;
  return (
    (excluded.has("airline") || !f.airline || row[INDEX.airline] === f.airline) &&
    (excluded.has("origin") || !f.origin || row[INDEX.origin] === f.origin) &&
    (excluded.has("dayOfWeek") || !f.dayOfWeek || row[INDEX.dayOfWeek] === f.dayOfWeek) &&
    (excluded.has("departureWindow") || !f.departureWindow || row[INDEX.departureWindow] === f.departureWindow)
  );
}

function filteredRows(...exclude) {
  const excluded = new Set(exclude);
  return state.data.rows.filter((row) => matches(row, excluded));
}

function hasFilters() {
  return Object.values(state.filters).some(Boolean);
}

function toggleFilter(key, value) {
  state.filters[key] = state.filters[key] === value ? null : value;
  renderAll();
}

function setFilter(key, value) {
  state.filters[key] = value;
  renderAll();
}

function resetFilters() {
  for (const key of Object.keys(state.filters)) state.filters[key] = null;
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
  if (key === "dayOfWeek") return DAYS[value];
  if (key === "departureWindow") return windowLabel(value);
  return value;
}

function initializeFilterControls() {
  const unique = (index) => [...new Set(state.data.rows.map((row) => row[index]))];
  const airlines = unique(INDEX.airline).sort();
  const origins = unique(INDEX.origin).sort();
  const windows = unique(INDEX.departureWindow).filter((value) => value !== "Unknown").sort();

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

  const configs = [
    ["#airline-filter", "airline", airlines, (value) => `${value} · ${state.data.airlines[value] || value}`],
    ["#weekday-filter", "dayOfWeek", [1, 2, 3, 4, 5, 6, 7], (value) => DAYS[value]],
    ["#window-filter", "departureWindow", windows, (value) => windowLabel(value)],
  ];

  for (const [selector, key, values, labelFor] of configs) {
    const select = document.querySelector(selector);
    const allLabel = key === "airline" ? "All reporting carriers" : key === "dayOfWeek" ? "All weekdays" : "All times";
    select.innerHTML = `<option value="">${allLabel}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelFor(value))}</option>`).join("")}`;
    select.addEventListener("change", () => {
      const value = select.value || null;
      setFilter(key, key === "dayOfWeek" && value ? Number(value) : value);
    });
  }

  document.querySelector("#carrier-count").textContent = `(${airlines.length} in BTS)`;
  document.querySelector("#origin-count").textContent = `(${origins.length})`;
  originInput.placeholder = `All ${origins.length} origins`;
}

function renderFilterControls() {
  const controls = {
    airline: "#airline-filter",
    dayOfWeek: "#weekday-filter",
    departureWindow: "#window-filter",
  };
  for (const [key, selector] of Object.entries(controls)) {
    const select = document.querySelector(selector);
    select.value = state.filters[key] ?? "";
    select.classList.toggle("active-filter", Boolean(state.filters[key]));
  }

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
    if (state.filters[key]) active.push([key, filterLabel(key, state.filters[key])]);
  }
  container.innerHTML = active.length
    ? active.map(([key, value]) => `<button class="filter-chip" type="button" data-key="${key}" aria-label="Remove ${FILTER_NAMES[key]} filter: ${escapeHtml(value)}"><strong>${FILTER_NAMES[key]}:</strong>&nbsp;${escapeHtml(value)}</button>`).join("")
    : "";
  container.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => setFilter(chip.dataset.key, null));
  });
  document.querySelector("#reset-button").disabled = active.length === 0;
}

function scopeItems(excluded = new Set()) {
  const items = [];
  if (!excluded.has("airline") && state.filters.airline) items.push(`Carrier ${state.filters.airline}`);
  if (!excluded.has("origin") && state.filters.origin) items.push(`Origin ${state.filters.origin}`);
  if (!excluded.has("dayOfWeek") && state.filters.dayOfWeek) items.push(DAYS[state.filters.dayOfWeek]);
  if (!excluded.has("departureWindow") && state.filters.departureWindow) items.push(windowLabel(state.filters.departureWindow));
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
  setScope("#heatmap-scope", ["dayOfWeek", "departureWindow"]);
  setScope("#cause-scope");

  const heatmapSelections = [];
  if (state.filters.dayOfWeek) heatmapSelections.push(DAYS[state.filters.dayOfWeek]);
  if (state.filters.departureWindow) heatmapSelections.push(windowLabel(state.filters.departureWindow));
  if (heatmapSelections.length) {
    const scope = document.querySelector("#heatmap-scope");
    scope.textContent += ` · Selection: ${heatmapSelections.join(" · ")}`;
  }
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

function showTooltip(event, title, lines) {
  const tooltip = document.querySelector("#tooltip");
  tooltip.innerHTML = `<strong>${escapeHtml(title)}</strong>${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}`;
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
      showTooltip(event, tip.title, tip.lines);
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
  const x = (i) => margin.left + (entries.length === 1 ? innerW / 2 : (i * innerW) / (entries.length - 1));
  const y = (value) => margin.top + innerH - ((value - minY) / Math.max(1, maxY - minY)) * innerH;
  const points = entries.map(([date, metrics], index) => ({ date, metrics, value: onTimeRate(metrics), x: x(index), y: y(onTimeRate(metrics)) }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const ticks = [minY, (minY + maxY) / 2, maxY];

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily on-time arrival rate for July 2026.">
      ${ticks.map((tick) => `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"></line><text x="${margin.left - 9}" y="${y(tick) + 4}" text-anchor="end">${tick.toFixed(0)}%</text>`).join("")}
      <path d="${path}" fill="none" stroke="#1261a0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      ${points.map((point, index) => `<circle class="chart-target data-only-mark" tabindex="0" role="img" aria-label="${escapeHtml(dateFormat.format(new Date(`${point.date}T00:00:00Z`)))}: ${point.value.toFixed(1)} percent on time" data-date="${point.date}" data-index="${index}" cx="${point.x}" cy="${point.y}" r="4" fill="#2f80c9"></circle>`).join("")}
      ${points.filter((_, index) => index % 5 === 0 || index === points.length - 1).map((point) => `<text x="${point.x}" y="${height - 8}" text-anchor="middle">${dateFormat.format(new Date(`${point.date}T00:00:00Z`))}</text>`).join("")}
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
  if (groupKey === "origin") {
    const sorted = entries.sort(
      (a, b) => b.value - a.value || b.metrics.flights - a.metrics.flights || a.key.localeCompare(b.key)
    );
    const tieCounts = new Map();
    for (const entry of sorted) {
      const rateKey = entry.value.toFixed(10);
      tieCounts.set(rateKey, (tieCounts.get(rateKey) || 0) + 1);
    }
    let previousValue = null;
    let currentRank = 0;
    const ranked = sorted.map((entry, index) => {
      if (previousValue === null || Math.abs(entry.value - previousValue) > 1e-9) currentRank = index + 1;
      previousValue = entry.value;
      return {
        ...entry,
        rank: currentRank,
        tied: tieCounts.get(entry.value.toFixed(10)) > 1,
      };
    });
    if (selectedValue && grouped.has(selectedValue)) {
      const selectedIndex = ranked.findIndex((entry) => entry.key === selectedValue);
      const selectedEntry = ranked[selectedIndex];
      const start = Math.max(0, Math.min(selectedIndex - Math.floor((maxRows - 1) / 2), ranked.length - maxRows));
      entries = ranked.slice(start, start + maxRows);
      document.querySelector("#airport-note").textContent = selectedEntry.tied
        ? `Selected origin is tied #${selectedEntry.rank} among ${ranked.length} origins; nearby origins shown`
        : `Selected origin ranks #${selectedEntry.rank} among ${ranked.length} origins; nearby origins shown`;
    } else {
      entries = ranked.slice(0, maxRows);
      document.querySelector("#airport-note").textContent = selectedValue
        ? `Selected origin has no flights under current filters; top ${Math.min(maxRows, ranked.length)} shown`
        : `Top ${Math.min(maxRows, ranked.length)} of ${ranked.length} origins by on-time rate`;
    }
  } else {
    entries.sort((a, b) => b.value - a.value || b.metrics.flights - a.metrics.flights);
  }
  if (!entries.length) {
    container.innerHTML = '<p class="filter-empty">No flights match this selection.</p>';
    return;
  }

  const width = groupKey === "origin" ? 720 : 660;
  const rowH = 25;
  const margin = {
    top: 18,
    right: groupKey === "origin" ? 124 : 74,
    bottom: 24,
    left: groupKey === "origin" ? 120 : 155,
  };
  const height = margin.top + margin.bottom + entries.length * rowH;
  const innerW = width - margin.left - margin.right;
  const min = Math.max(0, Math.floor(Math.min(...entries.map((entry) => entry.value)) / 5) * 5 - 5);
  const max = Math.min(100, Math.ceil(Math.max(...entries.map((entry) => entry.value)) / 5) * 5 + 5);
  const scale = (value) => ((value - min) / Math.max(1, max - min)) * innerW;

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="On-time arrival rate ranking. Select a row to filter the dashboard.">
      <line class="axis-line" x1="${margin.left}" x2="${margin.left}" y1="0" y2="${height - margin.bottom}"></line>
      ${entries.map((entry, index) => {
        const y = margin.top + index * rowH;
        const selected = selectedValue === entry.key;
        const smallSample = groupKey === "origin" && entry.metrics.flights < 10;
        const rankLabel = entry.rank ? (entry.tied ? `Tied #${entry.rank} · ` : `#${entry.rank} · `) : "";
        const rowTitle = `${rankLabel}${titleFor(entry.key)}`;
        const rankDescription = entry.rank ? `${entry.tied ? "tied rank" : "rank"} ${entry.rank}; ` : "";
        const sampleDescription = smallSample ? "; small sample, fewer than 10 reported flights" : "";
        return `<g class="chart-target" tabindex="0" role="button" aria-label="${escapeHtml(titleFor(entry.key))}: ${rankDescription}${entry.value.toFixed(1)} percent on time${sampleDescription}" data-key="${escapeHtml(entry.key)}" data-index="${index}">
          <text x="${margin.left - 10}" y="${y + 13}" text-anchor="end" font-weight="${selected ? 800 : 600}" fill="${selected ? "#8d4109" : "#43576b"}">${escapeHtml(rowTitle)}</text>
          <rect class="${selected ? "selected-mark" : ""}" x="${margin.left}" y="${y + 2}" width="${Math.max(1, scale(entry.value))}" height="15" rx="4" fill="${selected ? "#fff0e3" : "#2f80c9"}"></rect>
          <text x="${margin.left + scale(entry.value) + 8}" y="${y + 14}" font-weight="700">${entry.value.toFixed(1)}%${smallSample ? '<tspan fill="#6b7d90" font-size="9.5" font-weight="600"> · small sample</tspan>' : ""}</text>
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
      const lines = [`${entry.value.toFixed(1)}% on time`, `${numberFormat.format(entry.metrics.flights)} reported flights`, `${averageDelay.toFixed(1)} avg delay min among delayed arrivals`];
      if (groupKey === "origin" && entry.metrics.flights < 10) lines.push("Small sample: fewer than 10 reported flights");
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
  const windows = [...new Set(rows.map((row) => row[INDEX.departureWindow]).filter((value) => value !== "Unknown"))].sort();
  const cells = [];
  for (let day = 1; day <= 7; day += 1) {
    for (const window of windows) {
      const metrics = grouped.get(`${day}|${window}`) || emptyMetrics();
      cells.push({ day, window, metrics, value: rate(metrics.delayed15, metrics.completed) });
    }
  }
  const values = cells.filter((cell) => cell.metrics.completed).map((cell) => cell.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const width = 760;
  const height = 286;
  const margin = { top: 40, right: 8, bottom: 44, left: 70 };
  const cellW = (width - margin.left - margin.right) / Math.max(1, windows.length);
  const cellH = (height - margin.top - margin.bottom) / 7;

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Heatmap of delay rate by weekday and two-hour scheduled departure window. Select a cell to filter the dashboard.">
      ${windows.map((window, index) => {
        const muted = state.filters.departureWindow && state.filters.departureWindow !== window;
        const active = state.filters.departureWindow === window;
        return `<text x="${margin.left + index * cellW + cellW / 2}" y="${margin.top - 12}" text-anchor="middle" fill="${muted ? "#aeb8c2" : active ? "#8d4109" : "#43576b"}" font-weight="${active ? 800 : 400}">${escapeHtml(windowLabel(window, true))}</text>`;
      }).join("")}
      ${DAYS.slice(1).map((day, index) => {
        const dayNumber = index + 1;
        const muted = state.filters.dayOfWeek && state.filters.dayOfWeek !== dayNumber;
        const active = state.filters.dayOfWeek === dayNumber;
        return `<text x="${margin.left - 12}" y="${margin.top + index * cellH + cellH / 2 + 4}" text-anchor="end" fill="${muted ? "#aeb8c2" : active ? "#8d4109" : "#43576b"}" font-weight="${active ? 800 : 400}">${day}</text>`;
      }).join("")}
      ${cells.map((cell) => {
        const x = margin.left + windows.indexOf(cell.window) * cellW;
        const y = margin.top + (cell.day - 1) * cellH;
        const selected = state.filters.dayOfWeek === cell.day && state.filters.departureWindow === cell.window;
        const mutedDay = state.filters.dayOfWeek && state.filters.dayOfWeek !== cell.day;
        const mutedWindow = state.filters.departureWindow && state.filters.departureWindow !== cell.window;
        const muted = mutedDay || mutedWindow;
        return `<rect class="chart-target ${selected ? "selected-mark" : ""} ${muted ? "muted-heat-cell" : ""}" tabindex="0" role="button" aria-label="${DAYS[cell.day]}, ${escapeHtml(windowLabel(cell.window))}: ${cell.value.toFixed(1)} percent delayed" data-day="${cell.day}" data-window="${escapeHtml(cell.window)}" data-value="${cell.value.toFixed(2)}" data-flights="${cell.metrics.flights}" x="${x + 2}" y="${y + 2}" width="${Math.max(1, cellW - 4)}" height="${Math.max(1, cellH - 4)}" rx="4" fill="${muted ? "#edf1f5" : heatColor(cell.value, min, max)}"></rect>`;
      }).join("")}
      <text x="${margin.left + (width - margin.left - margin.right) / 2}" y="${height - 8}" text-anchor="middle">Scheduled departure time (local)</text>
    </svg>`;

  bindTargets(
    container,
    ({ day, window }) => {
      const numericDay = Number(day);
      const alreadySelected = state.filters.dayOfWeek === numericDay && state.filters.departureWindow === window;
      state.filters.dayOfWeek = alreadySelected ? null : numericDay;
      state.filters.departureWindow = alreadySelected ? null : window;
      renderAll();
    },
    ({ day, window, value, flights }) => ({
      title: `${DAYS[Number(day)]} · ${windowLabel(window)}`,
      lines: [`${Number(value).toFixed(1)}% delayed ≥15 min`, `${numberFormat.format(Number(flights))} reported flights`],
    })
  );
}

function renderCauses() {
  const metrics = summarize(filteredRows());
  const values = CAUSES.map(([label, key]) => ({ label, value: metrics[key] }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(1, ...values.map((item) => item.value));
  document.querySelector("#cause-chart").innerHTML = values.map((item) => `
    <div class="cause-row">
      <span>${escapeHtml(item.label)}</span>
      <div class="cause-track" role="img" aria-label="${escapeHtml(item.label)}: ${numberFormat.format(Math.round(item.value))} minutes, ${total ? ((100 * item.value) / total).toFixed(1) : "0.0"} percent of reported cause minutes">
        <div class="cause-fill" style="width:${(100 * item.value) / max}%"></div>
      </div>
      <strong class="cause-value">${compactFormat.format(Math.round(item.value))} min · ${total ? ((100 * item.value) / total).toFixed(1) : "0.0"}%</strong>
    </div>`).join("");
}

function renderAll() {
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
        dayOfWeek: { type: ["integer", "null"], minimum: 1, maximum: 7 },
        departureWindow: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      for (const [key, value] of Object.entries(input || {})) {
        if (!(key in state.filters)) throw new Error(`Unknown filter: ${key}`);
        if (value !== null && !validValues[key].has(value)) throw new Error(`Invalid ${key} value: ${value}`);
        state.filters[key] = value;
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
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    state.data = await response.json();
    document.querySelector("#period-label").textContent = state.data.meta.period;
    document.querySelector("#source-link").href = state.data.meta.sourceUrl;
    document.querySelector("#method-copy").textContent = `${numberFormat.format(state.data.meta.reportedFlights)} BTS-reported flights from ${state.data.meta.reportingCarrierCount} carriers and ${state.data.meta.originCount} origins. On time means arriving less than 15 minutes late; average delay covers arrivals delayed at least 15 minutes. Departure windows use scheduled local time.`;
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
