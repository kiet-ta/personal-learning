# Core Entity Schema Draft

Status: draft for Phase 1 implementation.

This schema follows the context rule: the vault is canonical and the database is
a rebuildable index/metadata store.

## source_asset

| Column | Type | Notes |
|---|---|---|
| `asset_id` | text primary key | Stable ID derived from content hash or generated UUID. |
| `sha256` | text not null unique | Hash of original imported bytes. |
| `filename` | text not null | Original basename only. |
| `mime_type` | text not null | Detected MIME type. |
| `modality` | text not null | `pdf`, `text`, `markdown`, or `image`. |
| `size_bytes` | integer not null | Original file size. |
| `vault_relative_path` | text not null | Safe relative path inside vault. |
| `created_at` | integer not null | Unix milliseconds. |

## node

| Column | Type | Notes |
|---|---|---|
| `node_id` | text primary key | Stable generated ID. |
| `source_asset_id` | text not null | References `source_asset`. |
| `current_version_id` | text not null | References latest `node_version`. |
| `title` | text not null | Human-readable title. |
| `created_at` | integer not null | Unix milliseconds. |

## node_version

| Column | Type | Notes |
|---|---|---|
| `version_id` | text primary key | Version ID. |
| `node_id` | text not null | References `node`. |
| `body_markdown` | text not null | Node body. |
| `summary` | text not null | Short retrieval/review summary. |
| `source_anchor_json` | text not null | File/page/line/offset/section path. |
| `node_reason` | text not null | Why this boundary exists. |
| `created_at` | integer not null | Unix milliseconds. |

## edge

| Column | Type | Notes |
|---|---|---|
| `edge_id` | text primary key | Edge ID. |
| `from_node_id` | text not null | Source node. |
| `to_node_id` | text not null | Target node. |
| `kind` | text not null | `parent_child`, `next`, `same_source`, `mentions`, `semantic_near`, `prerequisite`. |
| `confidence_basis` | text not null | Deterministic reason or model/ranker metadata. |

## review_item

| Column | Type | Notes |
|---|---|---|
| `review_item_id` | text primary key | Review item ID. |
| `node_id` | text not null | References `node`. |
| `prompt` | text not null | User-facing review prompt. |
| `due_at` | integer not null | Unix milliseconds. |

## review_event

| Column | Type | Notes |
|---|---|---|
| `review_event_id` | text primary key | Review event ID. |
| `review_item_id` | text not null | References `review_item`. |
| `grade` | text not null | `again`, `hard`, `good`, or `easy`. |
| `latency_ms` | integer not null | Time spent reviewing. |
| `reviewed_at` | integer not null | Unix milliseconds. |
| `device_id` | text not null | Desktop or paired mobile device. |
