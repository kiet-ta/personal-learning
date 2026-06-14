from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .parser import parse_document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Parse a text or Markdown file into source-anchored nodes.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(argv)

    try:
        result = parse_document(args.path)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "type": exc.__class__.__name__}), file=sys.stderr)
        return 1

    indent = 2 if args.pretty else None
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=indent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
