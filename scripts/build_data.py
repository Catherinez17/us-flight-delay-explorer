#!/usr/bin/env python3
"""Build a compact, cross-filterable JSON cube from a BTS monthly ZIP."""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


AIRLINE_NAMES = {
    "AA": "American Airlines",
    "AS": "Alaska Airlines",
    "B6": "JetBlue Airways",
    "DL": "Delta Air Lines",
    "F9": "Frontier Airlines",
    "G4": "Allegiant Air",
    "MQ": "Envoy Air",
    "OH": "PSA Airlines",
    "OO": "SkyWest Airlines",
    "UA": "United Airlines",
    "WN": "Southwest Airlines",
    "YX": "Republic Airways",
}

CAUSE_FIELDS = [
    "CarrierDelay",
    "WeatherDelay",
    "NASDelay",
    "SecurityDelay",
    "LateAircraftDelay",
]


def number(value: str) -> float:
    try:
        return float(value) if value not in ("", None) else 0.0
    except ValueError:
        return 0.0


def is_one(value: str) -> bool:
    return number(value) == 1.0


def departure_window(value: str) -> str:
    """Convert a scheduled HHMM time into a two-hour local-time window."""
    if value in ("", None):
        return "Unknown"
    hhmm = int(number(value))
    hour = (hhmm // 100) % 24
    start = (hour // 2) * 2
    end = (start + 2) % 24
    return f"{start:02d}-{end:02d}"


def csv_member(archive: zipfile.ZipFile) -> str:
    return next(name for name in archive.namelist() if name.lower().endswith(".csv"))


def rows_from(archive: zipfile.ZipFile, member: str):
    with archive.open(member) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        yield from csv.DictReader(text)


def build(source: Path, output: Path, top_airports: int) -> None:
    with zipfile.ZipFile(source) as archive:
        member = csv_member(archive)
        origin_counts: Counter[str] = Counter()
        origin_names: dict[str, str] = {}
        total_rows = 0
        for row in rows_from(archive, member):
            total_rows += 1
            origin = row["Origin"]
            origin_counts[origin] += 1
            origin_names.setdefault(origin, row["OriginCityName"])

        retain_all_origins = top_airports <= 0 or top_airports >= len(origin_counts)
        keep_origins = (
            set(origin_counts)
            if retain_all_origins
            else {code for code, _ in origin_counts.most_common(top_airports)}
        )
        cube = defaultdict(lambda: [0.0] * 12)

        for row in rows_from(archive, member):
            origin = row["Origin"] if row["Origin"] in keep_origins else "Other"
            key = (
                row["FlightDate"],
                int(number(row["DayOfWeek"])),
                departure_window(row["CRSDepTime"]),
                row["Reporting_Airline"],
                origin,
            )
            metrics = cube[key]
            metrics[0] += 1  # reported flights

            cancelled = is_one(row["Cancelled"])
            diverted = is_one(row["Diverted"])
            completed = not cancelled and not diverted and row["ArrDelayMinutes"] != ""
            metrics[3] += 1 if cancelled else 0
            metrics[4] += 1 if diverted else 0

            if completed:
                metrics[1] += 1
                delayed_15 = is_one(row["ArrDel15"])
                metrics[2] += 1 if delayed_15 else 0
                if delayed_15:
                    metrics[5] += number(row["ArrDelayMinutes"])

            for index, field in enumerate(CAUSE_FIELDS, start=6):
                metrics[index] += number(row[field])

            metrics[11] += number(row["Distance"])

    schema = [
        "date",
        "dayOfWeek",
        "departureWindow",
        "airline",
        "origin",
        "flights",
        "completed",
        "delayed15",
        "cancelled",
        "diverted",
        "delayedArrivalDelayMinutes",
        "carrierDelayMinutes",
        "weatherDelayMinutes",
        "nasDelayMinutes",
        "securityDelayMinutes",
        "lateAircraftDelayMinutes",
        "distanceMiles",
    ]
    compact_rows = []
    for key, values in sorted(cube.items()):
        compact_rows.append(
            [*key, *[round(value, 2) for value in values]]
        )

    payload = {
        "meta": {
            "title": "BTS Reporting Carrier On-Time Performance",
            "period": "July 2026",
            "releaseDate": "2026-09-21",
            "sourceUrl": "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ",
            "downloadUrl": "https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_2026_7.zip",
            "reportedFlights": total_rows,
            "originCount": len(origin_counts),
            "retainedOriginCount": len(keep_origins),
            "reportingCarrierCount": len(AIRLINE_NAMES),
            "aggregation": "Flight-level records aggregated by date, day of week, two-hour scheduled departure window, reporting carrier, and origin airport.",
            "metricDefinitions": {
                "onTimeRate": "1 - delayed arrivals (ArrDel15 = 1) / completed flights",
                "averageDelayMinutes": "Arrival delay minutes / delayed arrivals, limited to completed flights with ArrDel15 = 1",
                "cancellationRate": "Cancelled flights / reported flights",
            },
            "preparationNotes": [
                "Cancelled and diverted flights are excluded from arrival-performance denominators.",
                "Blank delay-cause values are treated as zero because BTS reports causes only when applicable.",
                "All origin airports are retained as individually selectable categories.",
                "Scheduled departure times are grouped into twelve two-hour local-time windows.",
            ],
        },
        "schema": schema,
        "airlines": AIRLINE_NAMES,
        "origins": {code: origin_names.get(code, code) for code in sorted(keep_origins)},
        "rows": compact_rows,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(compact_rows):,} aggregate rows to {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--top-airports",
        type=int,
        default=0,
        help="Number of busiest origins to retain; 0 keeps every origin (default).",
    )
    args = parser.parse_args()
    build(args.source, args.output, args.top_airports)


if __name__ == "__main__":
    main()
