from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from enrich_token_usage_report import (
    AssistantMessage,
    ResponseEvent,
    ThreadLog,
    ToolExecution,
    enrich_rows,
    extract_command,
    validate_output_paths,
)


def at(second: int) -> datetime:
    return datetime(2026, 9, 6, 0, 0, second, tzinfo=timezone.utc)


class EnrichTokenUsageReportTest(unittest.TestCase):
    def test_extracts_commands_from_json_and_programmatic_exec(self) -> None:
        self.assertEqual(
            extract_command("shell_command", '{"command":"git status --short"}'),
            "git status --short",
        )
        self.assertEqual(
            extract_command(
                "exec",
                "const result = await tools.exec_command({cmd: `rg -n token_count .`});",
            ),
            "rg -n token_count .",
        )

    def test_enriches_all_tools_in_previous_response_interval(self) -> None:
        thread_id = "thread-1"
        log = ThreadLog(
            responses=[ResponseEvent(at(10), 1_000), ResponseEvent(at(20), 7_500)],
            tools=[
                ToolExecution("a", at(11), "exec", "git status", 100),
                ToolExecution("b", at(20), "exec", "rg -n value src", 900),
                ToolExecution("c", at(21), "exec", "npm test", 5_000),
            ],
            messages=[AssistantMessage(at(19), "answer " * 50, True)],
        )
        rows = [
            {
                "timestamp_utc": "2026-09-06T00:00:20.000Z",
                "timestamp_jst": "2026-09-06 09:00:20.000",
                "thread_id": thread_id,
                "input_tokens": "7500",
                "task": "test",
            }
        ]

        enriched, tools = enrich_rows(rows, {thread_id: log})

        self.assertEqual(enriched[0]["delta_input_tokens"], 6_500)
        self.assertEqual(enriched[0]["tool_count_since_prev_response"], 2)
        self.assertEqual(enriched[0]["tool_names"], "exec | exec")
        self.assertEqual(enriched[0]["tool_output_chars_total"], 1_000)
        self.assertEqual(enriched[0]["tool_output_chars_max"], 900)
        self.assertEqual(enriched[0]["largest_tool_command"], "rg -n value src")
        self.assertLessEqual(len(enriched[0]["model_response_preview"]), 200)
        self.assertEqual(len(tools), 2)

    def test_rejects_conflicting_output_paths(self) -> None:
        input_path = Path("input.csv")
        with self.assertRaisesRegex(RuntimeError, "conflicts with input CSV"):
            validate_output_paths(input_path, [input_path], overwrite=True)

        output_path = Path("output.csv")
        with self.assertRaisesRegex(RuntimeError, "must be distinct"):
            validate_output_paths(input_path, [output_path, output_path], overwrite=True)

    def test_rejects_any_existing_output_before_generation(self) -> None:
        with patch.object(Path, "exists", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "outputs already exist"):
                validate_output_paths(
                    Path("input.csv"),
                    [Path("fresh.csv"), Path("existing.csv")],
                    overwrite=False,
                )


if __name__ == "__main__":
    unittest.main()
