from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class SourceAsset:
    asset_id: str
    sha256: str
    filename: str
    mime_type: str
    modality: str
    size_bytes: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SourceAnchor:
    source_file: str
    start_line: int
    end_line: int
    start_offset: int
    end_offset: int
    section_path: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class KnowledgeNode:
    node_id: str
    title: str
    body: str
    summary: str
    source_anchor: SourceAnchor
    node_reason: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["source_anchor"] = self.source_anchor.to_dict()
        return data


@dataclass(frozen=True)
class ParseResult:
    source_asset: SourceAsset
    nodes: list[KnowledgeNode]
    conversion_tool: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_asset": self.source_asset.to_dict(),
            "nodes": [node.to_dict() for node in self.nodes],
            "conversion_tool": self.conversion_tool,
        }
