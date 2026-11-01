# U.S. Flight Delay Explorer

Interactive dashboard for NYU Information Visualization Mini-Project 2 using the U.S. Bureau of Transportation Statistics Reporting Carrier On-Time Performance data for July 2026.

## Dashboard

The dashboard contains five coordinated views for comparing daily performance, reporting carriers, origin airports, weekday and departure-time patterns, and reported delay-cause minutes. Carrier, origin, weekday, and departure-time selections update the other views. Tooltips provide exact values and flight counts.

## Run locally

From the repository directory, start a local web server:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

## Data preparation

The deployed `data.json` contains aggregated statistics rather than the raw flight-level file. To audit the cleaning and aggregation, open `notebooks/bts_data_cleaning_audit.ipynb` and run it from top to bottom. Notebook dependencies are listed in `requirements-notebook.txt`.

To rebuild the dashboard data from an official monthly BTS ZIP file:

```bash
python3 scripts/build_data.py /path/to/month.zip data.json --top-airports 0
```

## Metric definitions

- **Completed flight:** not cancelled or diverted, with a reported arrival-delay outcome.
- **On-time arrival rate:** `1 - ArrDel15 / completed flights`.
- **Average delay:** arrival-delay minutes divided by delayed arrivals, limited to completed flights with `ArrDel15 = 1`.
- **Cancellation rate:** cancelled flights divided by reported flights.
- **Delay-cause share:** category minutes divided by all reported delay-cause minutes in the current selection.

## Source

U.S. Department of Transportation, Bureau of Transportation Statistics, Reporting Carrier On-Time Performance (1987-present), July 2026 release.

## Development note

AI-assisted tools were used for coding support and debugging. Final design decisions and validation were completed by the author.
