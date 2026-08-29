#!/usr/bin/env python3
"""A dependency-free MCP stdio server used to verify RainEye/OpenCode MCP setup."""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any


if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


TOOL_NAME = "raineye_test"


def write_message(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def result(request_id: Any, payload: dict[str, Any]) -> None:
    write_message({"jsonrpc": "2.0", "id": request_id, "result": payload})


def error(request_id: Any, code: int, message: str) -> None:
    write_message({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def handle(message: dict[str, Any]) -> None:
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") or {}

    if method == "initialize":
        result(
            request_id,
            {
                "protocolVersion": params.get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "raineye-python-test", "version": "1.0.0"},
            },
        )
        return
    if method == "ping":
        result(request_id, {})
        return
    if method == "tools/list":
        result(
            request_id,
            {
                "tools": [
                    {
                        "name": TOOL_NAME,
                        "description": "Return a fixed Chinese success message for MCP testing.",
                        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
                    }
                ]
            },
        )
        return
    if method == "tools/call":
        if params.get("name") != TOOL_NAME:
            error(request_id, -32602, f"Unknown tool: {params.get('name')}")
            return
        result(request_id, {"content": [{"type": "text", "text": "测试成功"}], "isError": False})
        return
    if method in {"notifications/initialized", "notifications/cancelled"}:
        return
    if request_id is not None:
        error(request_id, -32601, f"Method not found: {method}")


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("JSON-RPC message must be an object")
            handle(message)
        except json.JSONDecodeError as exc:
            error(None, -32700, f"Parse error: {exc.msg}")
        except Exception as exc:  # Keep the test server alive and surface a JSON-RPC error.
            traceback.print_exc(file=sys.stderr)
            error(message.get("id") if isinstance(message, dict) else None, -32603, str(exc))


if __name__ == "__main__":
    main()
