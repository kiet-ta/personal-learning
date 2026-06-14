# NotebookLM-style Local RAG Review

Last updated: 2026-06-14

## Muc tieu

Tai lieu nay tom tat phien ban v1 cua luong NotebookLM-style cho ung dung
Learn Alone: nguoi dung co the upload nhieu file Markdown/text, dua chung vao
vault local, index bang SQLite FTS5, truy van theo prompt, va tao node draft tu
cac source chunk duoc retrieve.

Muc tieu v1 khong phai la clone day du NotebookLM. Muc tieu la tao nen tang
local-first co trace source ro rang, de sau nay co the them AI/embedding ma
khong pha vo data model.

## Trang thai hien tai

| Hang muc | Trang thai |
|---|---|
| Multi-file upload | Da co: `.md`, `.markdown`, `.txt`, toi da 40 file/batch |
| Gioi han file | 2 MB/file trong UI v1 |
| Vault assets | Da ghi source vao `vault/assets/` |
| SQLite metadata | Da co `source_assets`, `source_chunks` |
| FTS index | Da co `source_chunks_fts` bang SQLite FTS5 |
| Query/analyze | Da retrieve chunks bang FTS va tao node drafts |
| Source anchor | Da giu anchor dang `filename.md:start-end` |
| LLM/AI provider | Chua co |
| Embedding/vector search | Chua co |
| Persist final Markdown nodes | Chua co |
| PDF/image/audio/video | Chua nam trong slice nay |

## Luong nguoi dung

```mermaid
flowchart TD
  A["Nguoi dung upload nhieu Markdown/text"] --> B["React source library UI"]
  B --> C{"Dang chay trong Tauri?"}
  C -- "Co" --> D["Tauri command: ingest_sources"]
  D --> E["Rust core: validate + hash + chunk"]
  E --> F["Vault assets + SQLite FTS5"]
  C -- "Khong" --> G["Browser fallback in-memory"]
  F --> H["Nguoi dung nhap prompt/query"]
  G --> H
  H --> I["Tauri command: analyze_sources"]
  I --> J["FTS retrieve source chunks"]
  J --> K["Generate node drafts tu chunks"]
  K --> L["Review node cards + graph preview"]
```

## Kien truc hien tai

```mermaid
flowchart LR
  subgraph UI["apps/desktop React UI"]
    U1["Multi-source upload"]
    U2["Prompt / query composer"]
    U3["Source library"]
    U4["Retrieved chunks"]
    U5["Node drafts + graph"]
  end

  subgraph Tauri["apps/desktop/src-tauri"]
    C1["ingest_sources"]
    C2["analyze_sources"]
    C3["generate_knowledge_draft"]
  end

  subgraph Core["crates/core"]
    R1["rag.rs"]
    D1["draft.rs"]
    V1["vault.rs"]
  end

  subgraph Vault["Local vault"]
    A1["assets/<sha>-filename.md"]
    S1[".app/index.sqlite"]
  end

  U1 --> C1
  U2 --> C2
  C1 --> R1
  C2 --> R1
  R1 --> V1
  R1 --> A1
  R1 --> S1
  R1 --> D1
  D1 --> U5
```

## SQLite schema v1

```mermaid
erDiagram
  source_assets {
    TEXT source_id PK
    TEXT source_name
    TEXT sha256 UK
    INTEGER size_bytes
    TEXT vault_relative_path
    INTEGER created_at_unix_ms
  }

  source_chunks {
    TEXT chunk_id PK
    TEXT source_id FK
    TEXT source_name
    INTEGER chunk_index
    INTEGER start_line
    INTEGER end_line
    TEXT text
  }

  source_chunks_fts {
    TEXT chunk_id
    TEXT source_id
    TEXT source_name
    TEXT text
  }

  source_assets ||--o{ source_chunks : contains
  source_chunks ||--|| source_chunks_fts : indexed_as
```

Ghi chu:

- `source_assets` giu metadata file goc.
- `source_chunks` giu chunk co line anchor.
- `source_chunks_fts` la virtual table FTS5 de retrieve lexical.
- SQLite la index rebuildable; vault assets van la source local de audit.

## Sequence ingest

```mermaid
sequenceDiagram
  participant U as User
  participant UI as React UI
  participant TC as Tauri Commands
  participant Core as Rust Core
  participant Vault as Vault FS
  participant DB as SQLite FTS

  U->>UI: Chon nhieu .md/.txt files
  UI->>TC: ingest_sources(vaultRoot, sourcesJson)
  TC->>Core: ingest_markdown_sources(root, sources)
  Core->>Core: validate filename, extension, size
  Core->>Core: normalize, sha256, chunk
  Core->>Vault: write assets/<sha>-filename
  Core->>DB: upsert source_assets
  Core->>DB: replace source_chunks
  Core->>DB: insert source_chunks_fts
  Core-->>TC: SourceLibraryResponse
  TC-->>UI: JSON
  UI-->>U: Hien source library + chunk counts
```

## Sequence analyze

```mermaid
sequenceDiagram
  participant U as User
  participant UI as React UI
  participant TC as Tauri Commands
  participant Core as Rust Core
  participant DB as SQLite FTS
  participant Draft as Draft Generator

  U->>UI: Nhap prompt/query
  UI->>TC: analyze_sources(vaultRoot, query)
  TC->>Core: analyze_indexed_sources(root, query)
  Core->>DB: MATCH query voi source_chunks_fts
  DB-->>Core: RetrievedChunk[]
  Core->>Draft: generate_knowledge_draft_from_source_chunks(chunks)
  Draft-->>Core: KnowledgeDraft
  Core-->>TC: RagAnalysis
  TC-->>UI: JSON
  UI-->>U: Retrieved chunks, node drafts, graph preview
```

## Trade-off hien tai

| Lua chon | Scalability | Maintainability | Security | Performance | User experience |
|---|---|---|---|---|---|
| SQLite FTS5 truoc embeddings | Tot cho MVP, du voi 10k-100k chunks local | Don gian, it moving parts | Local-only, khong gui data ra ngoai | Nhanh, deterministic | Ket qua lexical, co the miss synonym |
| Vault assets + SQLite index | Tot vi index rebuildable | Ro ownership: vault la source of truth | De audit, de backup | Ghi/read local nhanh | Can UI quan ly reindex/delete sau |
| JSON string qua Tauri command | Du dung cho v1 | De debug, khong can phu thuoc TS codegen | Khong them attack surface lon | Payload lon can canh chung | UI wire nhanh |
| Browser fallback in-memory | Tot cho dev/test Vite | Tach ro runtime Tauri vs browser | Khong ghi disk khi browser | Nhanh voi file nho | Data mat khi reload |
| Chua them LLM | Giam complexity | Data model on dinh truoc | Tranh leak source | Khong phu thuoc network | Chua thong minh nhu NotebookLM |

## Gioi han can review

1. Chua co AI provider:
   - Node draft hien la deterministic tu retrieved chunks.
   - Muon giong NotebookLM hon thi can local LLM hoac cloud opt-in.

2. Chua co semantic search:
   - FTS phu thuoc lexical match.
   - Query synonym/cau hoi mo co the retrieve kem.

3. Chua persist final nodes:
   - Draft cards va graph preview chua ghi thanh Markdown nodes trong vault.

4. Chua co source management:
   - Chua co delete/reindex source UI.
   - Chua co duplicate handling UI, du core upsert theo hash.

5. Chua co encryption app-level:
   - Vault local hien nam trong thu muc user chon.
   - SQLCipher/encrypted vault la buoc sau.

6. Chua xu ly PDF/image:
   - Slice nay chi tap trung `.md`, `.markdown`, `.txt`.

## Acceptance criteria da dat

- Upload nhieu Markdown/text tu UI.
- Ingest vao vault + SQLite FTS trong Tauri runtime.
- Retrieve chunks theo query.
- Tao node drafts tu retrieved chunks.
- Node draft giu source anchor theo file goc.
- Co browser fallback de test UI trong Vite.
- Core va command adapter co unit tests.
- Desktop web build va Tauri `cargo check` pass.

## Buoc tiep theo de gan NotebookLM hon

```mermaid
flowchart TD
  A["V1: SQLite FTS lexical RAG"] --> B["Persist reviewed nodes to Markdown vault"]
  B --> C["Source management: delete/reindex/dedupe"]
  C --> D["Semantic embeddings local"]
  D --> E{"AI provider?"}
  E -- "Local" --> F["Ollama / local model adapter"]
  E -- "Cloud opt-in" --> G["Provider + secret storage + privacy gate"]
  F --> H["Notebook-style synthesis answer"]
  G --> H
  H --> I["Cited answer + graph expansion + review cards"]
```

De review tiep, can quyet dinh:

- Co uu tien persist final Markdown node truoc AI khong?
- Co chap nhan cloud AI opt-in hay chi local model?
- Vault root mac dinh nen la thu muc nao tren Windows?
- Can source delete/reindex trong v1.1 khong?
