#!/usr/bin/env python3
"""Convert NDJSON/JSONL exports into standard JSON files."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Convert JSON Lines / NDJSON files into standard JSON files. "
            "By default, writes <name>.fixed.json next to the input file."
        )
    )
    parser.add_argument("inputs", nargs="+", help="One or more input JSON/NDJSON files")
    parser.add_argument(
        "-o",
        "--output",
        help="Output path for a single input file. Cannot be used with multiple inputs.",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the source file with standard JSON output.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="Indent size for output JSON. Default: 2",
    )
    return parser


def default_output_path(source: Path) -> Path:
    return source.with_name(f"{source.stem}.fixed.json")


def load_as_standard_json(source: Path):
    text = source.read_text(encoding="utf-8")
    if not text.strip():
        raise ValueError(f"{source}: file is empty")

    try:
        return json.loads(text), "json"
    except json.JSONDecodeError:
        pass

    records = []
    with source.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, 1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"{source}: line {line_number} is not valid JSON: {exc.msg} "
                    f"(line {exc.lineno}, column {exc.colno})"
                ) from exc

    if not records:
        raise ValueError(f"{source}: no JSON records found")

    return records, "ndjson"


def write_json(target: Path, payload, indent: int) -> None:
    with target.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=indent)
        handle.write("\n")


def record_count(payload) -> int:
    if isinstance(payload, list):
        return len(payload)
    return 1


def convert_file(source: Path, output: Path | None, in_place: bool, indent: int) -> None:
    payload, source_type = load_as_standard_json(source)

    if in_place:
        target = source
    elif output is not None:
        target = output
    else:
        target = default_output_path(source)

    write_json(target, payload, indent)
    print(
        f"{source} -> {target} "
        f"({source_type}, {record_count(payload)} record{'s' if record_count(payload) != 1 else ''})"
    )


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.output and len(args.inputs) != 1:
        parser.error("--output can only be used with a single input file")

    if args.output and args.in_place:
        parser.error("--output and --in-place cannot be used together")

    output_path = Path(args.output).expanduser() if args.output else None

    try:
        for raw_source in args.inputs:
            source = Path(raw_source).expanduser()
            if not source.exists():
                raise ValueError(f"{source}: file does not exist")
            if not source.is_file():
                raise ValueError(f"{source}: not a file")

            convert_file(source, output_path, args.in_place, args.indent)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
