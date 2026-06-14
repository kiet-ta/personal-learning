from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from document_worker.parser import parse_document


class ParseDocumentTests(unittest.TestCase):
    def test_parse_markdown_into_heading_nodes_with_source_anchors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lesson.md"
            path.write_text(
                "# Databases\n\n"
                "A database stores structured facts.\n\n"
                "## Normalization\n\n"
                "Normalization reduces duplication and update anomalies.\n",
                encoding="utf-8",
            )

            result = parse_document(path)

        self.assertEqual(result.source_asset.modality, "markdown")
        self.assertEqual(len(result.nodes), 2)
        self.assertEqual(result.nodes[0].title, "Databases")
        self.assertEqual(result.nodes[0].source_anchor.start_line, 3)
        self.assertEqual(result.nodes[1].title, "Normalization")
        self.assertEqual(result.nodes[1].source_anchor.section_path, ["Databases", "Normalization"])
        self.assertIn("duplication", result.nodes[1].summary)

    def test_parse_plain_text_into_single_untitled_node(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "note.txt"
            path.write_text("First line.\n\nSecond line.", encoding="utf-8")

            result = parse_document(path)

        self.assertEqual(result.source_asset.modality, "text")
        self.assertEqual(len(result.nodes), 1)
        self.assertEqual(result.nodes[0].title, "Untitled")
        self.assertEqual(result.nodes[0].source_anchor.section_path, ["Untitled"])

    def test_node_ids_are_stable_for_same_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stable.md"
            path.write_text("# Topic\n\nSame content.", encoding="utf-8")

            first = parse_document(path)
            second = parse_document(path)

        self.assertEqual(first.nodes[0].node_id, second.nodes[0].node_id)
        self.assertEqual(first.source_asset.asset_id, second.source_asset.asset_id)

    def test_unsupported_suffix_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "audio.mp3"
            path.write_bytes(b"not supported")

            with self.assertRaises(ValueError):
                parse_document(path)


if __name__ == "__main__":
    unittest.main()
