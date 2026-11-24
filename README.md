# U.S. Flight Delay Explorer

An interactive dashboard for exploring U.S. domestic flight performance reported by the Bureau of Transportation Statistics (BTS). The current dataset covers July 2026, with 631,970 reported flights from 12 reporting carriers and 352 origin airports.

**Hosted dashboard:** https://catherinez17.github.io/us-flight-delay-explorer/

## Dashboard overview

The dashboard combines summary metrics with five coordinated views:

- a daily on-time arrival trend with a reference line for the current selection;
- a reporting-carrier ranking;
- an origin-airport ranking;
- a weekday × scheduled-departure-time heatmap;
- reported delay-cause minutes and their share of total cause minutes.

Carrier, origin, weekday, and departure-time selections share one filter state. Selecting a carrier or airport updates the remaining views. A heatmap cell selects one weekday and time window; dragging across cells selects a continuous weekday–time range. Active filters are shown above the dashboard and can be removed individually or cleared with **Reset all**.

## Rankings and sample size

Carrier and origin rankings include categories with at least 20 reported flights in the current selection. This keeps very small samples from determining the formal order. When a selected carrier or origin falls below the threshold, it remains visible as a small-sample reference without a formal rank. Tooltips provide the reported-flight count, on-time rate, and average delay among delayed arrivals.

## Metric definitions

- **Reported flights:** all flights represented in the current BTS selection.
- **Completed flights:** flights that were not cancelled or diverted and have a reported arrival-delay outcome.
- **On-time arrival rate:** completed flights arriving less than 15 minutes late divided by completed flights.
- **Cancellation rate:** cancelled flights divided by reported flights.
- **Average delay:** mean arrival-delay minutes among completed arrivals delayed at least 15 minutes.
- **Delay-cause share:** minutes attributed to one BTS cause divided by all reported delay-cause minutes in the current selection. Cause categories may overlap on the same flight.

Delay-cause tooltips also show affected-flight counts and their share of delayed arrivals.

## Run locally

From the repository directory, start a static web server:

```bash
python3 -m http.server 4173
```

Then open http://127.0.0.1:4173/.

No build step or package installation is required.

## Project files

- `index.html` — page structure, controls, view containers, and definitions;
- `styles.css` — visual system, responsive layouts, focus states, and print styles;
- `app.js` — data aggregation, shared filtering, chart rendering, tooltips, rankings, and heatmap brushing;
- `data.json` — the aggregated July 2026 dashboard dataset.

The interface uses responsive layouts for wide, medium, and narrow screens. Interactive chart marks include accessible labels and support keyboard selection; reduced-motion preferences are respected.

## Data source

U.S. Department of Transportation, Bureau of Transportation Statistics, [Reporting Carrier On-Time Performance](https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ), July 2026 release. The flight-level records are aggregated by date, weekday, two-hour scheduled local departure window, reporting carrier, and origin airport.

## Development note

The dashboard is implemented in project-specific HTML, CSS, and vanilla JavaScript without a charting library. AI-assisted tools supported implementation, debugging, and wording refinement.
