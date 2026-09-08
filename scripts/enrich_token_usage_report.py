#!/usr/bin/env python3
"""Enrich a Codex token-usage CSV from matching local JSONL rollouts.

The parser streams only rollout files whose names contain a thread_id present in
the input CSV. Tool outputs are measured and discarded; their full text is
never retained in the generated reports.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import json
import os
import re
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Iterable, TypeVar


DEFAULT_INPUT = Path("reports/token-usage-2026-09-06-calls.csv")
DEFAULT_ENRICHED = Path("reports/token-usage-2026-09-06-calls-enriched.csv")
DEFAULT_GROWTH = Path("reports/token-usage-2026-09-06-context-growth.csv")
DEFAULT_ANALYSIS = Path("reports/token-usage-2026-09-06-analysis.json")
COMMAND_LIMIT = 300
PREVIEW_LIMIT = 200
T = TypeVar("T")


@dataclass(frozen=True)
class ResponseEvent:
    timestamp: datetime
    input_tokens: int


@dataclass(frozen=True)
class AssistantMessage:
    timestamp: datetime
    text: str
    canonical: bool


@dataclass(frozen=True)
class ToolCall:
    call_id: str
    timestamp: datetime
    name: str
    command_full: str


@dataclass(frozen=True)
class ToolExecution:
    call_id: str
    timestamp: datetime
    name: str
    command_full: str
    output_chars: int

    @property
    def command(self) -> str:
        return shorten(self.command_full, COMMAND_LIMIT)


@dataclass
class ThreadLog:
    responses: list[ResponseEvent]
    tools: list[ToolExecution]
    messages: list[AssistantMessage]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_ENRICHED)
    parser.add_argument("--context-growth-output", type=Path, default=DEFAULT_GROWTH)
    parser.add_argument("--analysis-output", type=Path, default=DEFAULT_ANALYSIS)
    parser.add_argument(
        "--codex-home",
        type=Path,
        default=Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")),
    )
    parser.add_argument("--probe-schema", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp has no timezone: {value}")
    return parsed.astimezone(timezone.utc)


def timestamp_key(value: datetime) -> int:
    return int(value.timestamp() * 1_000_000)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def shorten(value: str, limit: int) -> str:
    normalized = normalize_text(value)
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1] + "…"


def read_usage_rows(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        required = {"timestamp_utc", "thread_id", "input_tokens", "task"}
        missing = sorted(required - set(fieldnames))
        if missing:
            raise RuntimeError(f"input CSV is missing columns: {', '.join(missing)}")
        rows = list(reader)
    if not rows:
        raise RuntimeError("input CSV has no data rows")
    keys = [(row["thread_id"], row["timestamp_utc"]) for row in rows]
    if len(keys) != len(set(keys)):
        raise RuntimeError("input CSV contains duplicate thread_id/timestamp_utc rows")
    return rows, fieldnames


def find_rollouts(codex_home: Path, thread_ids: Iterable[str]) -> dict[str, Path]:
    roots = [codex_home / "sessions", codex_home / "archived_sessions"]
    matches: dict[str, Path] = {}
    for thread_id in sorted(set(thread_ids)):
        candidates = [
            path
            for root in roots
            if root.exists()
            for path in root.rglob(f"*{thread_id}*.jsonl")
        ]
        if len(candidates) != 1:
            raise RuntimeError(
                f"expected exactly one rollout for {thread_id}, found {len(candidates)}"
            )
        matches[thread_id] = candidates[0]
    return matches


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"invalid JSONL at {path}:{line_number}") from error
            if isinstance(record, dict):
                yield record


def payload_type(record: dict[str, Any]) -> str:
    payload = record.get("payload")
    if isinstance(payload, dict) and payload.get("type"):
        return str(payload["type"])
    return ""


def schema_probe(rollouts: dict[str, Path]) -> dict[str, Any]:
    outer_types: Counter[str] = Counter()
    subtypes: Counter[str] = Counter()
    signatures: dict[str, Counter[tuple[str, ...]]] = defaultdict(Counter)
    samples: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for thread_id, path in rollouts.items():
        for record in iter_jsonl(path):
            outer = str(record.get("type", ""))
            subtype = payload_type(record)
            label = f"{outer}/{subtype}" if subtype else outer
            outer_types[outer] += 1
            subtypes[label] += 1
            payload = record.get("payload")
            if isinstance(payload, dict):
                signatures[label][tuple(sorted(payload.keys()))] += 1
            if len(samples[label]) < 3:
                sample: dict[str, Any] = {
                    "thread_id": thread_id,
                    "timestamp": record.get("timestamp"),
                    "outer_type": outer,
                    "payload_type": subtype,
                }
                if isinstance(payload, dict):
                    sample["payload_keys"] = sorted(payload.keys())
                    for key in ("role", "name", "call_id"):
                        if key in payload:
                            sample[key] = payload[key]
                    for key in ("arguments", "input", "output", "content", "message"):
                        value = payload.get(key)
                        if isinstance(value, str):
                            sample[f"{key}_chars"] = len(value)
                        elif isinstance(value, list):
                            sample[f"{key}_items"] = len(value)
                samples[label].append(sample)

    relevant = {
        label: samples[label]
        for label in sorted(samples)
        if any(
            needle in label.lower()
            for needle in ("function", "tool", "message", "token", "command")
        )
    }
    return {
        "rollout_count": len(rollouts),
        "outer_types": dict(outer_types.most_common()),
        "payload_subtypes": dict(subtypes.most_common()),
        "payload_key_signatures": {
            label: [
                {"keys": list(keys), "count": count}
                for keys, count in counter.most_common()
            ]
            for label, counter in sorted(signatures.items())
            if label in relevant
        },
        "relevant_samples": relevant,
    }


def stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def command_values(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in {"cmd", "command", "commands"}:
                if isinstance(child, list):
                    found.extend(stringify(item) for item in child)
                else:
                    found.append(stringify(child))
            else:
                found.extend(command_values(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(command_values(child))
    return [item for item in found if item]


QUOTED_COMMAND_RE = re.compile(
    r"(?:cmd|command)\s*:\s*(?P<quote>[\"'`])(?P<value>(?:\\.|(?!\1).)*?)(?P=quote)",
    re.DOTALL,
)


def extract_command(tool_name: str, raw_arguments: Any) -> str:
    parsed: Any = raw_arguments
    if isinstance(raw_arguments, str):
        try:
            parsed = json.loads(raw_arguments)
        except json.JSONDecodeError:
            parsed = raw_arguments

    values = command_values(parsed)
    raw_text = stringify(raw_arguments)
    if not values and any(part in tool_name.lower() for part in ("exec", "shell", "command")):
        values = [match.group("value") for match in QUOTED_COMMAND_RE.finditer(raw_text)]
    if not values and any(
        part in tool_name.lower() for part in ("exec", "shell", "command")
    ):
        values = [raw_text]
    return " || ".join(normalize_text(value) for value in values if value)


def message_text(payload: dict[str, Any]) -> str:
    content = payload.get("content")
    if isinstance(content, str):
        return content
    parts: list[str] = []
    if isinstance(content, list):
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                for key in ("text", "content"):
                    value = item.get(key)
                    if isinstance(value, str):
                        parts.append(value)
                        break
    return " ".join(parts)


def output_chars(value: Any) -> int:
    return len(stringify(value))


def read_thread_log(path: Path) -> ThreadLog:
    responses: list[ResponseEvent] = []
    messages: list[AssistantMessage] = []
    calls: dict[str, ToolCall] = {}
    completed_ids: set[str] = set()
    tools: list[ToolExecution] = []

    for sequence, record in enumerate(iter_jsonl(path), start=1):
        raw_timestamp = record.get("timestamp")
        if not isinstance(raw_timestamp, str):
            continue
        timestamp = parse_timestamp(raw_timestamp)
        outer = record.get("type")
        payload = record.get("payload")
        if not isinstance(payload, dict):
            continue
        subtype = payload.get("type")

        if outer == "event_msg" and subtype == "token_count":
            info = payload.get("info")
            usage = info.get("last_token_usage") if isinstance(info, dict) else None
            if isinstance(usage, dict):
                input_tokens = int(usage.get("input_tokens") or 0)
                if input_tokens > 0:
                    responses.append(ResponseEvent(timestamp, input_tokens))
            continue

        if outer == "event_msg" and subtype == "agent_message":
            text = payload.get("message")
            if isinstance(text, str) and text:
                messages.append(AssistantMessage(timestamp, text, False))
            continue

        if outer != "response_item":
            continue

        if subtype == "message" and payload.get("role") == "assistant":
            text = message_text(payload)
            if text:
                messages.append(AssistantMessage(timestamp, text, True))
            continue

        if subtype in {"function_call", "custom_tool_call"}:
            call_id = str(payload.get("call_id") or payload.get("id") or f"call:{sequence}")
            namespace = payload.get("namespace")
            name = str(payload.get("name") or "unknown")
            if namespace:
                name = f"{namespace}.{name}"
            raw_arguments = payload.get("arguments", payload.get("input"))
            calls[call_id] = ToolCall(
                call_id=call_id,
                timestamp=timestamp,
                name=name,
                command_full=extract_command(name, raw_arguments),
            )
            continue

        if subtype in {"function_call_output", "custom_tool_call_output"}:
            call_id = str(payload.get("call_id") or payload.get("id") or f"output:{sequence}")
            call = calls.get(call_id)
            namespace = payload.get("namespace")
            fallback_name = str(payload.get("name") or "unknown")
            if namespace:
                fallback_name = f"{namespace}.{fallback_name}"
            tools.append(
                ToolExecution(
                    call_id=call_id,
                    timestamp=timestamp,
                    name=call.name if call else fallback_name,
                    command_full=call.command_full if call else "",
                    output_chars=output_chars(payload.get("output")),
                )
            )
            completed_ids.add(call_id)

    for call_id, call in calls.items():
        if call_id not in completed_ids:
            tools.append(
                ToolExecution(
                    call_id=call_id,
                    timestamp=call.timestamp,
                    name=call.name,
                    command_full=call.command_full,
                    output_chars=0,
                )
            )

    responses.sort(key=lambda item: item.timestamp)
    tools.sort(key=lambda item: item.timestamp)
    messages.sort(key=lambda item: item.timestamp)
    return ThreadLog(responses=responses, tools=tools, messages=messages)


def interval_items(
    items: list[T], timestamps: list[datetime], start: datetime | None, end: datetime
) -> list[T]:
    left = bisect.bisect_right(timestamps, start) if start else 0
    right = bisect.bisect_right(timestamps, end)
    return items[left:right]


def select_preview(messages: list[AssistantMessage]) -> str:
    if not messages:
        return ""
    canonical = [message for message in messages if message.canonical]
    selected = canonical[-1] if canonical else messages[-1]
    return shorten(selected.text, PREVIEW_LIMIT)


def classify_interval(tools: list[ToolExecution]) -> set[str]:
    joined = "\n".join(f"{tool.name}\n{tool.command_full}" for tool in tools).lower()
    categories: set[str] = set()
    patterns = {
        "git_diff": r"\bgit\s+diff\b",
        "git_status": r"\bgit\s+status\b",
        "rg": r"(?:^|[\s;&|])rg(?:\.exe)?(?:\s|$)",
        "test": r"\b(?:npm\s+(?:run\s+)?test|vitest|jest|pytest|unittest|verify:local-complete|verify:phase\w*)\b",
        "lint": r"\b(?:npm\s+run\s+lint|eslint|ruff|pylint|verify:local-complete)\b",
        "typecheck": r"\b(?:npm\s+run\s+typecheck|tsc|mypy|pyright|verify:local-complete)\b",
    }
    for category, pattern in patterns.items():
        if re.search(pattern, joined, flags=re.IGNORECASE):
            categories.add(category)
    if re.search(
        r"\b(?:get-content|readalltext|readlines|read_text|read-file|read_file|head|tail|type)\b",
        joined,
        flags=re.IGNORECASE,
    ):
        categories.add("file_read")
    return categories


def enrich_rows(
    rows: list[dict[str, str]], logs: dict[str, ThreadLog]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    enriched: list[dict[str, Any]] = []
    assigned_tools: list[dict[str, Any]] = []
    response_indexes = {
        thread_id: {
            timestamp_key(response.timestamp): index
            for index, response in enumerate(log.responses)
        }
        for thread_id, log in logs.items()
    }
    tool_timestamps = {
        thread_id: [tool.timestamp for tool in log.tools]
        for thread_id, log in logs.items()
    }
    message_timestamps = {
        thread_id: [message.timestamp for message in log.messages]
        for thread_id, log in logs.items()
    }

    for row in rows:
        thread_id = row["thread_id"]
        current_timestamp = parse_timestamp(row["timestamp_utc"])
        log = logs[thread_id]
        response_index = response_indexes[thread_id].get(timestamp_key(current_timestamp))
        if response_index is None:
            raise RuntimeError(
                f"no matching token_count event for {thread_id} at {row['timestamp_utc']}"
            )
        response = log.responses[response_index]
        expected_input = int(row["input_tokens"])
        if response.input_tokens != expected_input:
            raise RuntimeError(
                f"input token mismatch for {thread_id} at {row['timestamp_utc']}: "
                f"CSV={expected_input}, JSONL={response.input_tokens}"
            )
        previous = log.responses[response_index - 1] if response_index else None
        previous_timestamp = previous.timestamp if previous else None
        delta = response.input_tokens - previous.input_tokens if previous else None

        tools = interval_items(
            log.tools,
            tool_timestamps[thread_id],
            previous_timestamp,
            current_timestamp,
        )
        messages = interval_items(
            log.messages,
            message_timestamps[thread_id],
            previous_timestamp,
            current_timestamp,
        )
        largest = max(tools, key=lambda tool: tool.output_chars, default=None)
        commands = [tool.command for tool in tools if tool.command]

        output_row: dict[str, Any] = dict(row)
        output_row.update(
            {
                "delta_input_tokens": "" if delta is None else delta,
                "tool_count_since_prev_response": len(tools),
                "tool_names": " | ".join(tool.name for tool in tools),
                "commands": " || ".join(commands),
                "tool_output_chars_total": sum(tool.output_chars for tool in tools),
                "tool_output_chars_max": largest.output_chars if largest else 0,
                "largest_tool_name": largest.name if largest else "",
                "largest_tool_command": largest.command if largest else "",
                "model_response_preview": select_preview(messages),
            }
        )
        enriched.append(output_row)

        categories = classify_interval(tools)
        for tool in tools:
            assigned_tools.append(
                {
                    "tool_timestamp_utc": tool.timestamp.isoformat().replace("+00:00", "Z"),
                    "response_timestamp_jst": row["timestamp_jst"],
                    "task": row["task"],
                    "thread_id": thread_id,
                    "call_id": tool.call_id,
                    "tool_name": tool.name,
                    "command": tool.command,
                    "output_chars": tool.output_chars,
                    "delta_input_tokens": delta,
                    "categories": sorted(categories),
                }
            )
    return enriched, assigned_tools


ADDED_COLUMNS = [
    "delta_input_tokens",
    "tool_count_since_prev_response",
    "tool_names",
    "commands",
    "tool_output_chars_total",
    "tool_output_chars_max",
    "largest_tool_name",
    "largest_tool_command",
    "model_response_preview",
]

GROWTH_COLUMNS = [
    "timestamp_jst",
    "task",
    "thread_id",
    "input_tokens",
    "delta_input_tokens",
    "tool_count",
    "tool_names",
    "tool_output_chars_total",
    "tool_output_chars_max",
    "largest_tool_name",
    "largest_tool_command",
]


def write_csv_atomic(
    path: Path, rows: list[dict[str, Any]], fieldnames: list[str], overwrite: bool
) -> None:
    if path.exists() and not overwrite:
        raise RuntimeError(f"output already exists (use --overwrite): {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8-sig", newline="", dir=path.parent, delete=False
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def write_json_atomic(path: Path, value: Any, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise RuntimeError(f"output already exists (use --overwrite): {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def validate_output_paths(
    input_path: Path, output_paths: list[Path], overwrite: bool
) -> None:
    resolved_input = input_path.resolve()
    resolved_outputs: dict[Path, Path] = {}
    for path in output_paths:
        resolved = path.resolve()
        if resolved == resolved_input:
            raise RuntimeError(f"output path conflicts with input CSV: {path}")
        if resolved in resolved_outputs:
            raise RuntimeError(
                f"output paths must be distinct: {resolved_outputs[resolved]} and {path}"
            )
        resolved_outputs[resolved] = path

    existing = [path for path in output_paths if path.exists()]
    if existing and not overwrite:
        joined = ", ".join(str(path) for path in existing)
        raise RuntimeError(f"outputs already exist (use --overwrite): {joined}")


def numeric_delta(row: dict[str, Any]) -> int | None:
    value = row.get("delta_input_tokens")
    return int(value) if value not in (None, "") else None


def build_growth_rows(enriched: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for row in enriched:
        output = {key: row.get(key, "") for key in GROWTH_COLUMNS}
        output["tool_count"] = row["tool_count_since_prev_response"]
        rows.append(output)
    return sorted(
        rows,
        key=lambda row: (
            -(numeric_delta(row) if numeric_delta(row) is not None else -10**30),
            row["timestamp_jst"],
        ),
    )


def build_analysis(
    enriched: list[dict[str, Any]], assigned_tools: list[dict[str, Any]]
) -> dict[str, Any]:
    delta_rows = [row for row in enriched if (numeric_delta(row) or 0) >= 5_000]
    delta_rows.sort(key=lambda row: numeric_delta(row) or 0, reverse=True)
    delta_keys = [
        "timestamp_jst",
        "task",
        "thread_id",
        "input_tokens",
        "delta_input_tokens",
        "tool_count_since_prev_response",
        "tool_names",
        "tool_output_chars_total",
        "tool_output_chars_max",
        "largest_tool_name",
        "largest_tool_command",
    ]
    top_tools = sorted(assigned_tools, key=lambda row: row["output_chars"], reverse=True)[:30]

    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_command: dict[str, list[dict[str, Any]]] = defaultdict(list)
    category_by_response: dict[tuple[str, str], set[str]] = defaultdict(set)
    for tool in assigned_tools:
        by_name[tool["tool_name"]].append(tool)
        if tool["command"]:
            by_command[tool["command"]].append(tool)
        category_by_response[(tool["thread_id"], tool["response_timestamp_jst"])].update(
            tool["categories"]
        )

    def tool_stats(
        grouped: dict[str, list[dict[str, Any]]], key_name: str
    ) -> list[dict[str, Any]]:
        result = []
        for key, tools in grouped.items():
            values = [int(tool["output_chars"]) for tool in tools]
            result.append(
                {
                    key_name: key,
                    "execution_count": len(tools),
                    "output_chars_total": sum(values),
                    "output_chars_average": round(mean(values), 2),
                    "output_chars_max": max(values),
                }
            )
        return sorted(result, key=lambda row: row["output_chars_total"], reverse=True)

    category_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in enriched:
        key = (row["thread_id"], row["timestamp_jst"])
        for category in category_by_response.get(key, set()):
            category_rows[category].append(row)

    category_summary = []
    for category in (
        "git_diff",
        "git_status",
        "rg",
        "file_read",
        "test",
        "lint",
        "typecheck",
    ):
        rows = category_rows.get(category, [])
        known = [delta for row in rows if (delta := numeric_delta(row)) is not None]
        category_summary.append(
            {
                "category": category,
                "response_events": len(rows),
                "tool_executions": sum(
                    int(row["tool_count_since_prev_response"]) for row in rows
                ),
                "tool_output_chars_total": sum(
                    int(row["tool_output_chars_total"]) for row in rows
                ),
                "positive_delta_input_tokens_total": sum(max(delta, 0) for delta in known),
                "delta_input_tokens_average": round(mean(known), 2) if known else None,
                "delta_input_tokens_max": max(known) if known else None,
                "events_delta_ge_5000": sum(delta >= 5_000 for delta in known),
            }
        )

    task_summary = []
    grouped_tasks: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in enriched:
        grouped_tasks[str(row["task"])].append(row)
    for task, rows in grouped_tasks.items():
        known = [delta for row in rows if (delta := numeric_delta(row)) is not None]
        task_summary.append(
            {
                "task": task,
                "response_events": len(rows),
                "input_tokens": sum(int(row["input_tokens"]) for row in rows),
                "positive_delta_input_tokens_total": sum(max(delta, 0) for delta in known),
                "events_delta_ge_5000": sum(delta >= 5_000 for delta in known),
                "tool_executions": sum(
                    int(row["tool_count_since_prev_response"]) for row in rows
                ),
                "tool_output_chars_total": sum(
                    int(row["tool_output_chars_total"]) for row in rows
                ),
            }
        )
    task_summary.sort(key=lambda row: row["input_tokens"], reverse=True)

    return {
        "metadata": {
            "response_event_count": len(enriched),
            "tool_execution_count": len(assigned_tools),
            "association_rule": "tool output timestamp > previous response timestamp and <= current response timestamp",
            "command_limit_chars": COMMAND_LIMIT,
            "response_preview_limit_chars": PREVIEW_LIMIT,
            "category_rows_overlap": True,
        },
        "top_30_delta_input_tokens_ge_5000": [
            {key: row.get(key, "") for key in delta_keys} for row in delta_rows[:30]
        ],
        "top_30_tool_outputs": top_tools,
        "tool_name_summary": tool_stats(by_name, "tool_name"),
        "top_30_commands_by_output_chars": tool_stats(by_command, "command")[:30],
        "task_summary": task_summary,
        "context_category_summary": category_summary,
    }


def main() -> None:
    args = parse_args()
    rows, input_fieldnames = read_usage_rows(args.input)
    thread_ids = [row["thread_id"] for row in rows]
    rollouts = find_rollouts(args.codex_home, thread_ids)
    if args.probe_schema:
        print(json.dumps(schema_probe(rollouts), ensure_ascii=False, indent=2))
        return

    validate_output_paths(
        args.input,
        [args.output, args.context_growth_output, args.analysis_output],
        args.overwrite,
    )
    logs = {thread_id: read_thread_log(path) for thread_id, path in rollouts.items()}
    enriched, assigned_tools = enrich_rows(rows, logs)
    growth = build_growth_rows(enriched)
    analysis = build_analysis(enriched, assigned_tools)

    enriched_fields = input_fieldnames + [
        column for column in ADDED_COLUMNS if column not in input_fieldnames
    ]
    write_csv_atomic(args.output, enriched, enriched_fields, args.overwrite)
    write_csv_atomic(
        args.context_growth_output, growth, GROWTH_COLUMNS, args.overwrite
    )
    write_json_atomic(args.analysis_output, analysis, args.overwrite)

    print(
        json.dumps(
            {
                "input_rows": len(rows),
                "rollouts": len(rollouts),
                "tool_executions": len(assigned_tools),
                "delta_ge_5000": len(
                    [row for row in enriched if (numeric_delta(row) or 0) >= 5_000]
                ),
                "outputs": [
                    str(args.output),
                    str(args.context_growth_output),
                    str(args.analysis_output),
                ],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
