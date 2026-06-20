import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";

type Locale = "en" | "vi";

type LocalizedText = Record<Locale, string>;

type PromptExample = {
  id: string;
  label: LocalizedText;
  template: LocalizedText;
};

type PipelineStep = {
  id: string;
  label: string;
  status: "Done" | "Active" | "Queued" | "Blocked";
  description: string;
};

type DraftRunState = "idle" | "processing" | "ready" | "error";

type DraftRelationType = "Source" | "Prerequisite" | "Supports" | "Contrasts";

type DraftNodeResponse = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
  relationType: DraftRelationType;
  source: string;
};

type DraftNode = DraftNodeResponse & {
  graphSlot: string;
};

type GraphEdgeResponse = {
  id: string;
  from: string;
  to: string;
  label: string;
};

type GraphEdge = GraphEdgeResponse;

type GraphPoint = {
  x: number;
  y: number;
  z: number;
};

type GraphEdgeView = {
  id: string;
  label?: string;
  from: GraphPoint;
  to: GraphPoint;
  depth: number;
  tone: "constellation" | "vault" | "focus";
};

type GraphDotTone = "blue" | "green" | "amber" | "pink" | "gray" | "source" | "hub";

type GraphDotSize = "pin" | "sm" | "md" | "lg" | "hub";

type GraphDotNode = GraphPoint & {
  id: string;
  cluster: string;
  size: GraphDotSize;
  title: LocalizedText;
  tone: GraphDotTone;
};

type GraphClusterSpec = {
  id: string;
  origin: GraphPoint;
  tone: GraphDotTone;
  offsets: readonly (readonly [number, number, number, GraphDotSize?])[];
};

type KnowledgeDraftResponse = {
  sourceName: string;
  nodes: DraftNodeResponse[];
  edges: GraphEdgeResponse[];
};

type SourceUploadPayload = {
  sourceName: string;
  content: string;
};

type SourceLibraryItem = {
  sourceId: string;
  sourceName: string;
  sha256: string;
  sizeBytes: number;
  chunkCount: number;
  vaultRelativePath: string;
};

type SourceLibraryResponse = {
  sources: SourceLibraryItem[];
};

type RetrievedChunk = {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
};

type RagAnalysisResponse = KnowledgeDraftResponse & {
  query: string;
  sources: SourceLibraryItem[];
  chunks: RetrievedChunk[];
};

type KnowledgeFilter = {
  id: string;
  label: string;
  count: number;
  state: "Active" | "Muted";
};

type VaultGraphNode = {
  id: string;
  title: string;
  meta: string;
  slot: string;
  tone: "core" | "source" | "muted";
};

type ViewMetric = {
  label: string;
  value: string;
  note: string;
};

const promptDraftSourceName = "prompt-draft.md";
const maxUploadBytes = 2 * 1024 * 1024;
const maxUploadFiles = 40;
const supportedUploadExtensions = [".txt", ".md", ".markdown"];

const initialPromptByLocale: Record<Locale, string> = {
  en: "Spaced repetition works better when a note is split into a precise question, a source-backed answer, and a relation to existing concepts. The main risk is keeping vague notes that feel useful but cannot be reviewed.",
  vi: "Lặp lại ngắt quãng hiệu quả hơn khi một ghi chú được tách thành câu hỏi rõ ràng, câu trả lời có nguồn và quan hệ với khái niệm cũ. Rủi ro chính là giữ các ghi chú mơ hồ, nhìn có vẻ hữu ích nhưng không thể ôn tập."
};

const promptExamples: PromptExample[] = [
  {
    id: "lecture",
    label: {
      en: "Lecture recap",
      vi: "Tóm tắt bài học"
    },
    template: {
      en: "Today I learned these lecture ideas: [topic]. Main claim: [claim]. Example: [example]. Confusing part: [question].",
      vi: "Hôm nay tôi học các ý trong bài giảng: [chủ đề]. Luận điểm chính: [luận điểm]. Ví dụ: [ví dụ]. Phần còn khó hiểu: [câu hỏi]."
    }
  },
  {
    id: "book",
    label: {
      en: "Book chapter",
      vi: "Chương sách"
    },
    template: {
      en: "This chapter argues that [claim]. Important concepts are [concepts]. It connects to [older idea] because [reason].",
      vi: "Chương này lập luận rằng [luận điểm]. Các khái niệm quan trọng là [khái niệm]. Nó liên hệ với [ý cũ] vì [lý do]."
    }
  },
  {
    id: "code",
    label: {
      en: "Code concept",
      vi: "Khái niệm code"
    },
    template: {
      en: "I learned the code concept [name]. It solves [problem]. The key rule is [rule]. The common mistake is [mistake].",
      vi: "Tôi học khái niệm code [tên]. Nó giải quyết [vấn đề]. Quy tắc chính là [quy tắc]. Lỗi thường gặp là [lỗi]."
    }
  },
  {
    id: "exam",
    label: {
      en: "Exam prep",
      vi: "Ôn thi"
    },
    template: {
      en: "For exam prep, I need to remember [fact], understand [concept], and practice [problem type]. Weak spot: [gap].",
      vi: "Để ôn thi, tôi cần nhớ [sự kiện], hiểu [khái niệm], và luyện [dạng bài]. Điểm yếu: [lỗ hổng]."
    }
  }
];

const nodeSlots = ["graph-node-a", "graph-node-b", "graph-node-c", "graph-node-d"];

const vaultNodePoints: Record<string, GraphPoint> = {
  "vault-node-a": { x: 49, y: 48, z: 24 },
  "vault-node-b": { x: 25, y: 28, z: -54 },
  "vault-node-c": { x: 24, y: 70, z: -28 },
  "vault-node-d": { x: 71, y: 27, z: -46 },
  "vault-node-e": { x: 74, y: 68, z: -18 },
  "vault-node-f": { x: 49, y: 81, z: -72 },
  "vault-node-g": { x: 14, y: 48, z: -110 },
  "vault-node-h": { x: 84, y: 47, z: -96 },
  "vault-node-i": { x: 38, y: 19, z: -134 },
  "vault-node-j": { x: 62, y: 84, z: -88 },
  "vault-node-k": { x: 87, y: 76, z: -122 }
};

const focusNodePoints: Record<string, GraphPoint> = {
  "graph-node-a": { x: 48, y: 43, z: 96 },
  "graph-node-b": { x: 31, y: 33, z: 62 },
  "graph-node-c": { x: 61, y: 63, z: 74 },
  "graph-node-d": { x: 73, y: 40, z: 48 }
};

const graphKnowledgeTitles: Record<string, readonly LocalizedText[]> = {
  capture: [
    { en: "Daily capture", vi: "Ghi nhanh hằng ngày" },
    { en: "Lecture notes", vi: "Ghi chú bài giảng" },
    { en: "Book chapter", vi: "Chương sách" },
    { en: "Code concept", vi: "Khái niệm code" },
    { en: "Exam prep", vi: "Ôn thi" },
    { en: "Question backlog", vi: "Câu hỏi tồn đọng" },
    { en: "Flash idea", vi: "Ý tưởng nhanh" },
    { en: "Reading note", vi: "Ghi chú đọc" },
    { en: "Inbox clip", vi: "Clip inbox" }
  ],
  source: [
    { en: "Source anchors", vi: "Neo nguồn" },
    { en: "Markdown AST", vi: "AST Markdown" },
    { en: "PDF parser", vi: "Parser PDF" },
    { en: "Line ranges", vi: "Khoảng dòng" },
    { en: "Original file", vi: "File gốc" },
    { en: "Hash trace", vi: "Truy vết hash" },
    { en: "Quote block", vi: "Khối trích dẫn" },
    { en: "Image OCR", vi: "OCR hình ảnh" }
  ],
  retrieval: [
    { en: "SQLite FTS", vi: "SQLite FTS" },
    { en: "Chunk ranking", vi: "Xếp hạng chunk" },
    { en: "Evidence", vi: "Evidence" },
    { en: "Rerank", vi: "Xếp lại" },
    { en: "Query focus", vi: "Focus truy vấn" },
    { en: "Graph hop", vi: "Bước nhảy graph" },
    { en: "Keyword match", vi: "Khớp từ khóa" },
    { en: "Source filter", vi: "Lọc nguồn" }
  ],
  links: [
    { en: "Link graph", vi: "Graph liên kết" },
    { en: "Backlinks", vi: "Backlink" },
    { en: "Prerequisite", vi: "Tiền đề" },
    { en: "Same source", vi: "Cùng nguồn" },
    { en: "Supports", vi: "Hỗ trợ" },
    { en: "Contrasts", vi: "Đối lập" },
    { en: "Next idea", vi: "Ý tiếp theo" },
    { en: "Bridge node", vi: "Node cầu nối" }
  ],
  review: [
    { en: "Review queue", vi: "Hàng đợi ôn tập" },
    { en: "FSRS card", vi: "Thẻ FSRS" },
    { en: "Recall prompt", vi: "Prompt nhớ lại" },
    { en: "Weak spot", vi: "Điểm yếu" },
    { en: "Due today", vi: "Đến hạn hôm nay" },
    { en: "Memory trace", vi: "Dấu vết trí nhớ" },
    { en: "Answer check", vi: "Kiểm tra đáp án" },
    { en: "Review event", vi: "Sự kiện ôn tập" }
  ],
  drafts: [
    { en: "Draft nodes", vi: "Draft node" },
    { en: "Filter noise", vi: "Lọc nhiễu" },
    { en: "Split ideas", vi: "Tách ý" },
    { en: "Atomic note", vi: "Ghi chú nguyên tử" },
    { en: "Confidence", vi: "Độ tin cậy" },
    { en: "Tag suggestion", vi: "Gợi ý tag" },
    { en: "Merge candidate", vi: "Ứng viên gộp" },
    { en: "Review draft", vi: "Review draft" }
  ],
  hub: [
    { en: "Vault map", vi: "Bản đồ vault" },
    { en: "Inbox", vi: "Inbox" },
    { en: "Learning graph", vi: "Graph học tập" },
    { en: "Knowledge base", vi: "Kho tri thức" },
    { en: "Current focus", vi: "Focus hiện tại" },
    { en: "Node index", vi: "Index node" },
    { en: "Local brain", vi: "Bộ não local" }
  ]
};

const constellationClusterSpecs: GraphClusterSpec[] = [
  {
    id: "capture",
    origin: { x: 16, y: 51, z: -132 },
    tone: "blue",
    offsets: [
      [0, 0, 0, "md"],
      [-7, -8, -18],
      [-11, 2, -26],
      [-8, 12, -36],
      [-2, 8, -16],
      [5, -5, -28],
      [9, 4, -42],
      [4, 14, -32],
      [-14, -5, -58, "pin"]
    ]
  },
  {
    id: "source",
    origin: { x: 27, y: 25, z: -96 },
    tone: "green",
    offsets: [
      [0, 0, 0, "lg"],
      [-7, -7, -18],
      [-3, -12, -36],
      [5, -9, -30],
      [9, -1, -24],
      [3, 8, -12],
      [-5, 9, -28],
      [11, 9, -52, "pin"]
    ]
  },
  {
    id: "retrieval",
    origin: { x: 70, y: 25, z: -88 },
    tone: "blue",
    offsets: [
      [0, 0, 0, "lg"],
      [-8, -8, -24],
      [-2, -13, -38],
      [7, -10, -22],
      [12, -1, -34],
      [9, 8, -44],
      [1, 11, -18],
      [-9, 5, -28]
    ]
  },
  {
    id: "links",
    origin: { x: 80, y: 61, z: -76 },
    tone: "green",
    offsets: [
      [0, 0, 0, "lg"],
      [-6, -7, -20],
      [4, -10, -32],
      [10, -4, -38],
      [8, 8, -24],
      [0, 12, -18],
      [-9, 7, -34],
      [-14, -1, -48, "pin"]
    ]
  },
  {
    id: "review",
    origin: { x: 27, y: 75, z: -82 },
    tone: "amber",
    offsets: [
      [0, 0, 0, "md"],
      [-7, -8, -24],
      [-12, 0, -44],
      [-8, 10, -28],
      [0, 13, -36],
      [7, 8, -18],
      [11, -2, -30],
      [4, -11, -52, "pin"]
    ]
  },
  {
    id: "drafts",
    origin: { x: 58, y: 72, z: -42 },
    tone: "pink",
    offsets: [
      [0, 0, 0, "md"],
      [-8, -5, -12],
      [-5, 8, -18],
      [4, 11, -20],
      [10, 4, -8],
      [8, -8, -28],
      [1, -13, -32],
      [-12, 2, -36, "pin"]
    ]
  },
  {
    id: "hub",
    origin: { x: 49, y: 48, z: 18 },
    tone: "hub",
    offsets: [
      [0, 0, 0, "hub"],
      [-8, -8, -14, "sm"],
      [9, -7, -16, "sm"],
      [10, 8, -18, "sm"],
      [-9, 9, -20, "sm"],
      [0, -14, -24, "pin"],
      [0, 15, -28, "pin"]
    ]
  }
];

const graphConstellationNodes = buildConstellationNodes(constellationClusterSpecs);
const graphConstellationEdges = buildConstellationGraphEdges(graphConstellationNodes);

const baseVaultGraphLinks = [
  ["vault-node-b", "vault-node-a"],
  ["vault-node-d", "vault-node-a"],
  ["vault-node-a", "vault-node-c"],
  ["vault-node-a", "vault-node-e"],
  ["vault-node-f", "vault-node-a"],
  ["vault-node-c", "vault-node-e"]
] as const;

const appCopy = {
  en: {
    brandSub: "Hybrid vault graph",
    vaultLabel: "Vault",
    chunksLabel: "chunks",
    activeItems: "active items",
    language: "Language",
    searchLabel: "Search",
    searchPlaceholder: "Search vault or stage a prompt",
    actions: {
      import: "Import",
      templates: "Templates",
      clearFocus: "Clear focus",
      addSources: "Add sources",
      resetView: "Reset view",
      localGraph: "Local graph",
      showBacklinks: "Show backlinks",
      fitView: "Fit view",
      rerank: "Rerank",
      saveSourceOnly: "Save source only",
      analyzeSources: "Analyze sources",
      generateDraft: "Generate draft",
      analyzing: "Analyzing",
      acceptLater: "Accept later",
      editLater: "Edit later"
    },
    source: {
      aria: "Source library",
      label: "Source library",
      title: "Indexed material",
      dropTitle: "Drop-in source set",
      dropDescription: "Markdown and text files stay local. Desktop runtime writes them to the vault index.",
      vaultRoot: "Vault root",
      filtersAria: "Source filters",
      all: "All",
      markdown: "Markdown",
      text: "Text",
      listAria: "Uploaded sources",
      emptyTitle: "No uploaded sources",
      emptyText: "The graph uses seed nodes until files are indexed."
    },
    graph: {
      workspaceAria: "Graph-first canvas",
      label: "Graph-first workspace",
      title: "Vault map with RAG focus layer",
      modeFocus: "Focus layer active",
      modeVault: "Vault background",
      modeSeed: "Seed graph",
      metricsAria: "Vault metrics",
      previewAria: "Vault graph preview",
      draftGhost: "Draft",
      processingTitle: "Analyzing sources",
      processingText: "Retrieval, filtering and draft linking are running locally.",
      nodeMeta: {
        vaultMap: "canonical graph",
        sourceAnchors: "traceable notes",
        reviewQueue: "spaced recall",
        retrieval: "FTS focus",
        linkGraph: "node relations",
        inbox: "new sources"
      },
      nodeTitle: {
        vaultMap: "Vault map",
        sourceAnchors: "Source anchors",
        reviewQueue: "Review queue",
        retrieval: "Retrieval",
        linkGraph: "Link graph",
        inbox: "Inbox"
      }
    },
    prompt: {
      aria: "Prompt and RAG controls",
      label: "Prompt what you learned",
      title: "Ask the vault or capture a new concept",
      promptLabel: "Prompt",
      templatesAria: "Prompt templates",
      context: "Context",
      model: "Model",
      vaultSources: "Vault sources",
      promptOnly: "Prompt only"
    },
    panels: {
      reviewAria: "Evidence and node review",
      pipelineLabel: "Pipeline",
      pipelineTitle: "RAG to node draft",
      evidenceLabel: "Retrieved evidence",
      evidenceTitle: "Top source chunks",
      evidenceEmptyTitle: "No retrieved chunks",
      evidenceEmptyText: "Upload markdown or text files, then analyze a prompt.",
      draftLabel: "Node drafts",
      draftTitle: "Review queue",
      draftFiltersAria: "Draft filters",
      draftEmptyTitle: "No draft nodes yet",
      draftEmptyText: "Run analysis to create ghost nodes on the graph.",
      inspectorAria: "Selection inspector",
      inspectorLabel: "Inspector",
      inspectorVaultOverview: "Vault overview",
      inspectorVaultText: "The default view keeps the full vault map visible. Prompt analysis will highlight a focused neighborhood."
    },
    states: {
      idle: "Idle",
      processing: "Processing",
      ready: "Review ready",
      error: "Error"
    },
    statuses: {
      Done: "Done",
      Active: "Active",
      Queued: "Queued",
      Blocked: "Blocked"
    },
    relations: {
      Source: "Source",
      Prerequisite: "Prerequisite",
      Supports: "Supports",
      Contrasts: "Contrasts"
    },
    inspector: {
      source: "Source",
      relation: "Relation",
      confidence: "Confidence",
      chunks: "Chunks",
      size: "Size",
      hash: "Hash",
      draft: "Draft",
      vault: "Vault"
    },
    filters: {
      core: "Core",
      supports: "Supports",
      prereq: "Prereq",
      contrast: "Contrast"
    },
    metrics: {
      sources: "Sources",
      sourcesWithData: "Uploaded files indexed for local retrieval.",
      sourcesEmpty: "Seed graph until sources are uploaded.",
      evidence: "Evidence",
      evidenceWithData: "Retrieved chunks are highlighted in review.",
      evidenceEmpty: "FTS context will appear after analysis.",
      drafts: "Drafts",
      draftsWithLinks: (count: number) => `${count} proposed graph links.`,
      draftsEmpty: "Ghost nodes stay separate from the vault."
    },
    pipeline: {
      error: [
        ["Summarize", "Generation did not complete. Review the message in the composer."],
        ["Filter", "Waiting for a valid prompt and command response."],
        ["Split nodes", "No draft nodes were accepted."],
        ["Link graph", "Graph links need generated node IDs."]
      ],
      ready: [
        ["Summarize", "Condense source chunks into source-backed claims."],
        ["Filter", "Remove low-signal text and duplicate ideas."],
        ["Split nodes", "Create atomic node drafts with tags and confidence."],
        ["Link graph", "Project draft nodes onto the vault neighborhood."]
      ]
    },
    messages: {
      promptEmpty: "Prompt is empty.",
      queryStaged: "Query staged in the prompt dock. Run analysis when ready.",
      sourceOnlyNotWired: "Source-only save is not wired to the vault yet.",
      uploadLimit: (limit: number) => `Upload at most ${limit} Markdown/text sources per batch.`,
      indexedSources: (count: number) => `Indexed ${count} source${count === 1 ? "" : "s"}. Ask a question, then analyze sources.`,
      promptMode: "Switched back to prompt draft mode.",
      unsupportedFile: "Only .txt, .md, and .markdown sources are supported.",
      fileTooLarge: (name: string, limit: string) => `${name} is larger than the ${limit} limit.`,
      fileEmpty: (name: string) => `${name} is empty.`
    },
    formatScoreMatch: "match"
  },
  vi: {
    brandSub: "Đồ thị vault lai",
    vaultLabel: "Vault",
    chunksLabel: "đoạn",
    activeItems: "mục đang hoạt động",
    language: "Ngôn ngữ",
    searchLabel: "Tìm",
    searchPlaceholder: "Tìm trong vault hoặc chuẩn bị prompt",
    actions: {
      import: "Nhập",
      templates: "Mẫu",
      clearFocus: "Xóa focus",
      addSources: "Thêm nguồn",
      resetView: "Đặt lại",
      localGraph: "Graph local",
      showBacklinks: "Hiện backlink",
      fitView: "Vừa khung",
      rerank: "Xếp lại",
      saveSourceOnly: "Chỉ lưu nguồn",
      analyzeSources: "Phân tích nguồn",
      generateDraft: "Tạo draft",
      analyzing: "Đang phân tích",
      acceptLater: "Duyệt sau",
      editLater: "Sửa sau"
    },
    source: {
      aria: "Thư viện nguồn",
      label: "Thư viện nguồn",
      title: "Tài liệu đã index",
      dropTitle: "Thả bộ nguồn vào đây",
      dropDescription: "Markdown và text ở lại máy local. Desktop runtime ghi vào vault index.",
      vaultRoot: "Vault root",
      filtersAria: "Bộ lọc nguồn",
      all: "Tất cả",
      markdown: "Markdown",
      text: "Text",
      listAria: "Nguồn đã tải lên",
      emptyTitle: "Chưa có nguồn",
      emptyText: "Graph dùng node mẫu cho đến khi file được index."
    },
    graph: {
      workspaceAria: "Canvas graph-first",
      label: "Không gian graph-first",
      title: "Bản đồ vault với lớp focus RAG",
      modeFocus: "Lớp focus đang bật",
      modeVault: "Nền vault",
      modeSeed: "Graph mẫu",
      metricsAria: "Chỉ số vault",
      previewAria: "Xem trước graph vault",
      draftGhost: "Draft",
      processingTitle: "Đang phân tích nguồn",
      processingText: "Truy xuất, lọc và nối draft đang chạy local.",
      nodeMeta: {
        vaultMap: "graph canonical",
        sourceAnchors: "ghi chú có truy vết",
        reviewQueue: "ôn tập ngắt quãng",
        retrieval: "focus FTS",
        linkGraph: "quan hệ node",
        inbox: "nguồn mới"
      },
      nodeTitle: {
        vaultMap: "Bản đồ vault",
        sourceAnchors: "Neo nguồn",
        reviewQueue: "Hàng đợi ôn tập",
        retrieval: "Truy xuất",
        linkGraph: "Graph liên kết",
        inbox: "Inbox"
      }
    },
    prompt: {
      aria: "Điều khiển prompt và RAG",
      label: "Prompt điều bạn đã học",
      title: "Hỏi vault hoặc ghi lại khái niệm mới",
      promptLabel: "Prompt",
      templatesAria: "Mẫu prompt",
      context: "Ngữ cảnh",
      model: "Model",
      vaultSources: "Nguồn trong vault",
      promptOnly: "Chỉ prompt"
    },
    panels: {
      reviewAria: "Evidence và review node",
      pipelineLabel: "Pipeline",
      pipelineTitle: "RAG sang draft node",
      evidenceLabel: "Evidence truy xuất",
      evidenceTitle: "Đoạn nguồn liên quan",
      evidenceEmptyTitle: "Chưa có evidence",
      evidenceEmptyText: "Tải markdown hoặc text lên, rồi phân tích prompt.",
      draftLabel: "Draft node",
      draftTitle: "Hàng đợi review",
      draftFiltersAria: "Bộ lọc draft",
      draftEmptyTitle: "Chưa có draft node",
      draftEmptyText: "Chạy phân tích để tạo ghost node trên graph.",
      inspectorAria: "Inspector vùng chọn",
      inspectorLabel: "Inspector",
      inspectorVaultOverview: "Tổng quan vault",
      inspectorVaultText: "Mặc định luôn giữ bản đồ vault đầy đủ. Phân tích prompt sẽ highlight vùng liên quan."
    },
    states: {
      idle: "Chờ",
      processing: "Đang chạy",
      ready: "Sẵn sàng review",
      error: "Lỗi"
    },
    statuses: {
      Done: "Xong",
      Active: "Đang chạy",
      Queued: "Chờ",
      Blocked: "Kẹt"
    },
    relations: {
      Source: "Nguồn",
      Prerequisite: "Tiền đề",
      Supports: "Hỗ trợ",
      Contrasts: "Đối lập"
    },
    inspector: {
      source: "Nguồn",
      relation: "Quan hệ",
      confidence: "Độ tin cậy",
      chunks: "Đoạn",
      size: "Dung lượng",
      hash: "Hash",
      draft: "Draft",
      vault: "Vault"
    },
    filters: {
      core: "Lõi",
      supports: "Hỗ trợ",
      prereq: "Tiền đề",
      contrast: "Đối lập"
    },
    metrics: {
      sources: "Nguồn",
      sourcesWithData: "File đã tải lên được index để truy xuất local.",
      sourcesEmpty: "Dùng graph mẫu cho đến khi có nguồn.",
      evidence: "Evidence",
      evidenceWithData: "Đoạn truy xuất được highlight trong review.",
      evidenceEmpty: "Ngữ cảnh FTS sẽ xuất hiện sau khi phân tích.",
      drafts: "Draft",
      draftsWithLinks: (count: number) => `${count} link graph được đề xuất.`,
      draftsEmpty: "Ghost node tách biệt với vault."
    },
    pipeline: {
      error: [
        ["Tóm tắt", "Generation chưa hoàn tất. Xem lại thông báo trong composer."],
        ["Lọc", "Đang chờ prompt hợp lệ và phản hồi command."],
        ["Tách node", "Chưa có draft node được duyệt."],
        ["Nối graph", "Graph link cần ID node đã tạo."]
      ],
      ready: [
        ["Tóm tắt", "Cô đọng đoạn nguồn thành các claim có truy vết."],
        ["Lọc", "Loại bỏ nội dung nhiễu và ý trùng lặp."],
        ["Tách node", "Tạo draft node nguyên tử với tag và độ tin cậy."],
        ["Nối graph", "Chiếu draft node lên vùng lân cận của vault."]
      ]
    },
    messages: {
      promptEmpty: "Prompt đang trống.",
      queryStaged: "Query đã được đưa vào prompt dock. Chạy phân tích khi sẵn sàng.",
      sourceOnlyNotWired: "Chế độ chỉ lưu nguồn chưa được nối vào vault.",
      uploadLimit: (limit: number) => `Mỗi lần chỉ tải tối đa ${limit} nguồn Markdown/text.`,
      indexedSources: (count: number) => `Đã index ${count} nguồn. Hãy đặt câu hỏi rồi phân tích nguồn.`,
      promptMode: "Đã chuyển về chế độ prompt draft.",
      unsupportedFile: "Chỉ hỗ trợ nguồn .txt, .md và .markdown.",
      fileTooLarge: (name: string, limit: string) => `${name} lớn hơn giới hạn ${limit}.`,
      fileEmpty: (name: string) => `${name} đang trống.`
    },
    formatScoreMatch: "khớp"
  }
} as const;

type DeepWiden<T> = T extends (...args: infer Args) => infer Return
  ? (...args: Args) => Return
  : T extends string
    ? string
    : T extends readonly (infer Item)[]
      ? readonly DeepWiden<Item>[]
      : { readonly [Key in keyof T]: DeepWiden<T[Key]> };

type AppCopy = DeepWiden<(typeof appCopy)["en"]>;

export function App() {
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
  const copy = appCopy[locale];
  const [promptText, setPromptText] = useState(() => initialPromptByLocale[getInitialLocale()]);
  const [quickQuery, setQuickQuery] = useState("");
  const [draftNodes, setDraftNodes] = useState<DraftNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [sourceName, setSourceName] = useState(promptDraftSourceName);
  const [vaultRoot, setVaultRoot] = useState("vault");
  const [sourceLibrary, setSourceLibrary] = useState<SourceLibraryItem[]>([]);
  const [retrievedChunks, setRetrievedChunks] = useState<RetrievedChunk[]>([]);
  const [browserSources, setBrowserSources] = useState<SourceUploadPayload[]>([]);
  const [draftState, setDraftState] = useState<DraftRunState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<"SQLite FTS" | "Rust command" | "Browser preview">(
    hasTauriRuntime() ? "SQLite FTS" : "Browser preview"
  );

  const canGenerate = promptText.trim().length > 0 && draftState !== "processing";
  const pipelineSteps = useMemo(() => buildPipelineSteps(draftState, copy), [copy, draftState]);
  const knowledgeFilters = useMemo(() => buildKnowledgeFilters(draftNodes, copy), [copy, draftNodes]);
  const vaultGraphNodes = useMemo(() => buildVaultGraphNodes(sourceLibrary, copy), [copy, sourceLibrary]);
  const vaultGraphEdges = useMemo(() => buildVaultGraphEdges(vaultGraphNodes), [vaultGraphNodes]);
  const focusGraphEdges = useMemo(() => buildFocusGraphEdges(graphEdges, draftNodes), [draftNodes, graphEdges]);
  const viewMetrics = useMemo(
    () => buildViewMetrics(sourceLibrary, retrievedChunks, draftNodes, graphEdges, copy),
    [copy, draftNodes, graphEdges, retrievedChunks, sourceLibrary]
  );

  const indexedChunkCount = sourceLibrary.reduce((total, source) => total + source.chunkCount, 0);
  const selectedDraft = draftNodes[0] ?? null;
  const selectedSource = sourceLibrary[0] ?? null;
  const focusModeLabel = draftState === "ready" ? copy.graph.modeFocus : sourceLibrary.length > 0 ? copy.graph.modeVault : copy.graph.modeSeed;

  function handleLocaleChange(nextLocale: Locale) {
    setLocale(nextLocale);
    try {
      window.localStorage.setItem("learn-alone.locale", nextLocale);
    } catch {
      // Ignore storage failures; the current session still switches language.
    }
  }

  async function handleGenerateDraft() {
    const prompt = promptText.trim();
    if (!prompt) {
      setDraftState("error");
      setErrorMessage(copy.messages.promptEmpty);
      return;
    }

    setDraftState("processing");
    setErrorMessage(null);

    try {
      const draft =
        sourceLibrary.length > 0
          ? await analyzeSourceLibrary({
              browserSources,
              query: prompt,
              vaultRoot
            })
          : hasTauriRuntime()
            ? await generateDraftViaTauri(sourceName, prompt)
            : generateBrowserPreviewDraft(prompt, sourceName);

      setRuntimeMode(sourceLibrary.length > 0 && hasTauriRuntime() ? "SQLite FTS" : hasTauriRuntime() ? "Rust command" : "Browser preview");
      setSourceName(draft.sourceName);
      if (isRagAnalysisResponse(draft)) {
        setRetrievedChunks(draft.chunks);
        setSourceLibrary(draft.sources);
      } else {
        setRetrievedChunks([]);
      }
      setDraftNodes(
        draft.nodes.map((node, index) => ({
          ...node,
          graphSlot: nodeSlots[index % nodeSlots.length]
        }))
      );
      setGraphEdges(draft.edges);
      setDraftState("ready");
    } catch (error) {
      setDraftState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleQuickSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = quickQuery.trim();
    if (!query) {
      return;
    }
    setPromptText(query);
    setErrorMessage(copy.messages.queryStaged);
    setDraftState("idle");
  }

  function handleSaveSourceOnly() {
    setDraftNodes([]);
    setGraphEdges([]);
    setRetrievedChunks([]);
    setDraftState("idle");
    setErrorMessage(copy.messages.sourceOnlyNotWired);
  }

  async function handleSourceUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    if (fileList.length > maxUploadFiles) {
      setDraftState("error");
      setErrorMessage(copy.messages.uploadLimit(maxUploadFiles));
      return;
    }

    try {
      const uploads = await readSourceFiles(fileList, copy);
      const library = hasTauriRuntime()
        ? parseSourceLibrary(
            await invoke<string>("ingest_sources", {
              vaultRoot,
              sourcesJson: JSON.stringify(uploads)
            })
          ).sources
        : indexBrowserSources(uploads);

      if (!hasTauriRuntime()) {
        setBrowserSources((current) => mergeBrowserSources(current, uploads));
      }
      setSourceLibrary((current) => mergeSourceLibrary(current, library));
      setRuntimeMode(hasTauriRuntime() ? "SQLite FTS" : "Browser preview");
      setSourceName("rag-analysis.md");
      setDraftNodes([]);
      setGraphEdges([]);
      setRetrievedChunks([]);
      setDraftState("idle");
      setErrorMessage(copy.messages.indexedSources(uploads.length));
    } catch (error) {
      setDraftState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleUsePromptDraft() {
    setSourceName(promptDraftSourceName);
    setSourceLibrary([]);
    setRetrievedChunks([]);
    setBrowserSources([]);
    setDraftNodes([]);
    setGraphEdges([]);
    setDraftState("idle");
    setErrorMessage(copy.messages.promptMode);
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup" aria-label="LocalMind">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>LocalMind</strong>
            <span>{copy.brandSub}</span>
          </div>
        </div>

        <div className="vault-strip" aria-label="Vault status">
          <span>
            {copy.vaultLabel}: {vaultRoot || "vault"}
          </span>
          <span>{runtimeMode}</span>
          <span>
            {indexedChunkCount} {copy.chunksLabel}
          </span>
        </div>

        <form className="top-search" onSubmit={handleQuickSearchSubmit}>
          <label>
            <span>{copy.searchLabel}</span>
            <input
              onChange={(event) => setQuickQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              value={quickQuery}
            />
          </label>
        </form>

        <div className="top-actions">
          <div className="language-switch" aria-label={copy.language}>
            <button className={locale === "en" ? "active" : ""} onClick={() => handleLocaleChange("en")} type="button">
              EN
            </button>
            <button className={locale === "vi" ? "active" : ""} onClick={() => handleLocaleChange("vi")} type="button">
              VI
            </button>
          </div>
          <label className="top-action">
            <input
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              multiple
              onChange={(event) => handleSourceUpload(event.target.files)}
              type="file"
            />
            {copy.actions.import}
          </label>
          <button onClick={() => setPromptText(promptExamples[0].template[locale])} type="button">
            {copy.actions.templates}
          </button>
          <button onClick={handleUsePromptDraft} type="button">
            {copy.actions.clearFocus}
          </button>
        </div>
      </header>

      <section className="workbench-grid" aria-label={copy.graph.title}>
        <aside className="source-rail" aria-label={copy.source.aria}>
          <div className="rail-heading">
            <div>
              <span className="small-label">{copy.source.label}</span>
              <h2>{copy.source.title}</h2>
            </div>
            <span className="rail-count">{sourceLibrary.length}</span>
          </div>

          <div className="dropzone">
            <span className="upload-glyph" aria-hidden="true" />
            <strong>{copy.source.dropTitle}</strong>
            <p>{copy.source.dropDescription}</p>
            <label className="primary-action file-action">
              <input
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                multiple
                onChange={(event) => handleSourceUpload(event.target.files)}
                type="file"
              />
              {copy.actions.addSources}
            </label>
          </div>

          <label className="vault-root-control">
            <span>{copy.source.vaultRoot}</span>
            <input onChange={(event) => setVaultRoot(event.target.value)} value={vaultRoot} />
          </label>

          <div className="source-filters" aria-label={copy.source.filtersAria}>
            <span>
              {copy.source.all} {sourceLibrary.length}
            </span>
            <span>
              {copy.source.markdown} {countMarkdownSources(sourceLibrary)}
            </span>
            <span>
              {copy.source.text} {countSourcesByExtension(sourceLibrary, ".txt")}
            </span>
          </div>

          <div className="source-list" aria-label={copy.source.listAria}>
            {sourceLibrary.length > 0 ? (
              sourceLibrary.map((source) => (
                <article className="source-row" key={source.sourceId}>
                  <div className="source-file-icon" aria-hidden="true" />
                  <div>
                    <strong>{source.sourceName}</strong>
                    <span>{source.vaultRelativePath}</span>
                  </div>
                  <small>{source.chunkCount}</small>
                </article>
              ))
            ) : (
              <div className="rail-empty">
                <strong>{copy.source.emptyTitle}</strong>
                <span>{copy.source.emptyText}</span>
              </div>
            )}
          </div>

          <div className="rail-footer">
            <span>{formatBytes(sourceLibrary.reduce((total, source) => total + source.sizeBytes, 0))}</span>
            <button onClick={handleUsePromptDraft} type="button">
              {copy.actions.resetView}
            </button>
          </div>
        </aside>

        <section className="graph-workspace" aria-label={copy.graph.workspaceAria}>
          <div className="graph-header">
            <div>
              <span className="small-label">{copy.graph.label}</span>
              <h1>{copy.graph.title}</h1>
            </div>
            <div className="graph-mode">
              <span>{focusModeLabel}</span>
              <strong>
                {draftNodes.length || retrievedChunks.length || vaultGraphNodes.length} {copy.activeItems}
              </strong>
            </div>
          </div>

          <div className="metric-row" aria-label={copy.graph.metricsAria}>
            {viewMetrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <p>{metric.note}</p>
              </article>
            ))}
          </div>

          <section className={`graph-stage ${draftState}`} id="graph" aria-label={copy.graph.previewAria}>
            <div className="graph-toolbar">
              <div>
                <button className="tool-button active" type="button">
                  {copy.actions.localGraph}
                </button>
                <button className="tool-button" onClick={handleUsePromptDraft} type="button">
                  {copy.actions.clearFocus}
                </button>
              </div>
              <div>
                <span>{copy.actions.showBacklinks}</span>
                <span>{copy.actions.fitView}</span>
              </div>
            </div>

            <div className="graph-surface">
              <div className="graph-depth-plane" aria-hidden="true" />
              <div className="graph-depth-haze" aria-hidden="true" />
              <GraphEdgeLayer edges={[...graphConstellationEdges, ...vaultGraphEdges, ...focusGraphEdges]} />
              {graphConstellationNodes.map((node, index) => (
                <span
                  aria-label={node.title[locale]}
                  className={`graph-dot ${node.tone} ${node.size}`}
                  key={node.id}
                  style={graphDotStyle(node, index)}
                  tabIndex={node.size === "pin" ? -1 : 0}
                  title={node.title[locale]}
                >
                  <span className="graph-dot-orb" aria-hidden="true" />
                  <span className="graph-dot-title">{node.title[locale]}</span>
                </span>
              ))}
              {focusGraphEdges.map((edge) =>
                edge.label ? (
                  <span className="graph-edge-label" key={`label-${edge.id}`} style={edgeLabelStyle(edge)}>
                    {edge.label}
                  </span>
                ) : null
              )}

              {vaultGraphNodes.map((node, index) => (
                <article className={`vault-node ${node.tone} ${node.slot}`} key={node.id} style={graphNodeStyle(vaultNodePoints[node.slot], index)}>
                  <strong>{node.title}</strong>
                  <span>{node.meta}</span>
                </article>
              ))}

              {draftNodes.map((node, index) => (
                <article className="focus-node" key={node.id} style={graphNodeStyle(focusNodePoints[node.graphSlot], index)}>
                  <span className="ghost-label">{copy.graph.draftGhost}</span>
                  <strong>{node.title}</strong>
                  <span>{relationLabel(node.relationType, copy)}</span>
                </article>
              ))}

              {draftState === "processing" ? (
                <div className="graph-processing" role="status">
                  <strong>{copy.graph.processingTitle}</strong>
                  <span>{copy.graph.processingText}</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="prompt-dock" id="prompt" aria-label={copy.prompt.aria}>
            <div className="dock-main">
              <div className="dock-heading">
                <div>
                  <span className="small-label">{copy.prompt.label}</span>
                  <h2>{copy.prompt.title}</h2>
                </div>
                <span className="state-pill">{stateLabel(draftState, copy)}</span>
              </div>

              <label className="prompt-composer">
                <span>{copy.prompt.promptLabel}</span>
                <textarea onChange={(event) => setPromptText(event.target.value)} value={promptText} />
              </label>

              <div className="prompt-chip-row" aria-label={copy.prompt.templatesAria}>
                {promptExamples.map((example) => (
                  <button key={example.id} onClick={() => setPromptText(example.template[locale])} type="button">
                    {example.label[locale]}
                  </button>
                ))}
              </div>
            </div>

            <div className="dock-side">
              <div className="context-control">
                <label>
                  <span>{copy.prompt.context}</span>
                  <select value={sourceLibrary.length > 0 ? "vault" : "prompt"} onChange={() => undefined}>
                    <option value="vault">{copy.prompt.vaultSources}</option>
                    <option value="prompt">{copy.prompt.promptOnly}</option>
                  </select>
                </label>
                <label>
                  <span>{copy.prompt.model}</span>
                  <select value={runtimeMode} onChange={() => undefined}>
                    <option>SQLite FTS</option>
                    <option>Rust command</option>
                    <option>Browser preview</option>
                  </select>
                </label>
              </div>

              {errorMessage ? (
                <div className={draftState === "error" ? "error-banner" : "notice-banner"} role="status">
                  {errorMessage}
                </div>
              ) : null}

              <div className="dock-actions">
                <button className="secondary-action" onClick={handleSaveSourceOnly} type="button">
                  {copy.actions.saveSourceOnly}
                </button>
                <button className="primary-action" disabled={!canGenerate} onClick={handleGenerateDraft} type="button">
                  {draftState === "processing" ? copy.actions.analyzing : sourceLibrary.length > 0 ? copy.actions.analyzeSources : copy.actions.generateDraft}
                </button>
              </div>
            </div>
          </section>
        </section>

        <aside className="review-rail" aria-label={copy.panels.reviewAria}>
          <section className="pipeline-panel" id="pipeline" aria-labelledby="pipeline-title">
            <div className="panel-heading">
              <div>
                <span className="small-label">{copy.panels.pipelineLabel}</span>
                <h2 id="pipeline-title">{copy.panels.pipelineTitle}</h2>
              </div>
              <span>{runtimeMode}</span>
            </div>
            <ol className="pipeline-list">
              {pipelineSteps.map((step, index) => (
                <li className={`pipeline-step ${step.status.toLowerCase()}`} key={step.id}>
                  <span className="pipeline-index">{index + 1}</span>
                  <div>
                    <div>
                      <strong>{step.label}</strong>
                      <span>{statusLabel(step.status, copy)}</span>
                    </div>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="evidence-panel" aria-labelledby="evidence-title">
            <div className="panel-heading">
              <div>
                <span className="small-label">{copy.panels.evidenceLabel}</span>
                <h2 id="evidence-title">{copy.panels.evidenceTitle}</h2>
              </div>
              <button disabled={!canGenerate} onClick={handleGenerateDraft} type="button">
                {copy.actions.rerank}
              </button>
            </div>

            <div className="evidence-list">
              {retrievedChunks.length > 0 ? (
                retrievedChunks.slice(0, 5).map((chunk, index) => (
                  <article className="evidence-row" key={chunk.chunkId}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>
                        {chunk.sourceName}:{chunk.startLine}-{chunk.endLine}
                      </strong>
                      <p>{compactPreviewText(chunk.text, 130)}</p>
                    </div>
                    <small>{formatScore(chunk.score, copy)}</small>
                  </article>
                ))
              ) : (
                <div className="panel-empty">
                  <strong>{copy.panels.evidenceEmptyTitle}</strong>
                  <span>{copy.panels.evidenceEmptyText}</span>
                </div>
              )}
            </div>
          </section>

          <section className="draft-panel" id="drafts" aria-labelledby="draft-title">
            <div className="panel-heading">
              <div>
                <span className="small-label">{copy.panels.draftLabel}</span>
                <h2 id="draft-title">{copy.panels.draftTitle}</h2>
              </div>
              <span>{draftNodes.length}</span>
            </div>

            <div className="filter-row" aria-label={copy.panels.draftFiltersAria}>
              {knowledgeFilters.map((filter) => (
                <button className={filter.state === "Active" ? "active" : ""} key={filter.id} type="button">
                  <span>{filter.label}</span>
                  <strong>{filter.count}</strong>
                </button>
              ))}
            </div>

            <div className="draft-list">
              {draftNodes.length > 0 ? (
                draftNodes.map((node) => (
                  <article className="draft-card" key={node.id}>
                    <div className="draft-card-header">
                      <span>{relationLabel(node.relationType, copy)}</span>
                      <strong>{node.confidence}%</strong>
                    </div>
                    <h3>{node.title}</h3>
                    <p>{node.summary}</p>
                    <div className="tag-row">
                      {node.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className="draft-actions">
                      <button disabled type="button">
                        {copy.actions.acceptLater}
                      </button>
                      <button disabled type="button">
                        {copy.actions.editLater}
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="panel-empty tall">
                  <strong>{copy.panels.draftEmptyTitle}</strong>
                  <span>{copy.panels.draftEmptyText}</span>
                </div>
              )}
            </div>
          </section>

          <section className="inspector-panel" aria-label={copy.panels.inspectorAria}>
            <div className="panel-heading">
              <div>
                <span className="small-label">{copy.panels.inspectorLabel}</span>
                <h2>{selectedDraft ? selectedDraft.title : selectedSource ? selectedSource.sourceName : copy.panels.inspectorVaultOverview}</h2>
              </div>
              <span>{selectedDraft ? copy.inspector.draft : selectedSource ? copy.inspector.source : copy.inspector.vault}</span>
            </div>
            {selectedDraft ? (
              <div className="inspector-body">
                <p>{selectedDraft.summary}</p>
                <dl>
                  <div>
                    <dt>{copy.inspector.source}</dt>
                    <dd>{selectedDraft.source}</dd>
                  </div>
                  <div>
                    <dt>{copy.inspector.relation}</dt>
                    <dd>{relationLabel(selectedDraft.relationType, copy)}</dd>
                  </div>
                  <div>
                    <dt>{copy.inspector.confidence}</dt>
                    <dd>{selectedDraft.confidence}%</dd>
                  </div>
                </dl>
              </div>
            ) : selectedSource ? (
              <div className="inspector-body">
                <p>{selectedSource.vaultRelativePath}</p>
                <dl>
                  <div>
                    <dt>{copy.inspector.chunks}</dt>
                    <dd>{selectedSource.chunkCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.inspector.size}</dt>
                    <dd>{formatBytes(selectedSource.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>{copy.inspector.hash}</dt>
                    <dd>{selectedSource.sha256.slice(0, 12)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="inspector-body">
                <p>{copy.panels.inspectorVaultText}</p>
              </div>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function buildConstellationNodes(clusters: GraphClusterSpec[]): GraphDotNode[] {
  return clusters.flatMap((cluster) =>
    cluster.offsets.map(([dx, dy, dz, size = "sm"], index) => ({
      id: `dot-${cluster.id}-${index}`,
      cluster: cluster.id,
      tone: cluster.tone,
      size,
      title: graphKnowledgeTitle(cluster.id, index),
      x: cluster.origin.x + dx,
      y: cluster.origin.y + dy,
      z: cluster.origin.z + dz
    }))
  );
}

function graphKnowledgeTitle(cluster: string, index: number): LocalizedText {
  const titles = graphKnowledgeTitles[cluster];
  if (!titles || titles.length === 0) {
    return { en: "Knowledge node", vi: "Node kiến thức" };
  }
  return titles[index % titles.length];
}

function buildConstellationGraphEdges(nodes: GraphDotNode[]): GraphEdgeView[] {
  const groupedNodes = new Map<string, GraphDotNode[]>();
  for (const node of nodes) {
    groupedNodes.set(node.cluster, [...(groupedNodes.get(node.cluster) ?? []), node]);
  }

  const hub = groupedNodes.get("hub")?.[0];
  const edges: GraphEdgeView[] = [];

  for (const [cluster, clusterNodes] of groupedNodes) {
    const anchor = clusterNodes[0];
    if (!anchor) {
      continue;
    }

    for (let index = 1; index < clusterNodes.length; index += 1) {
      const node = clusterNodes[index];
      edges.push({
        id: `dot-edge-${cluster}-${index}`,
        from: index % 3 === 0 ? clusterNodes[index - 1] : anchor,
        to: node,
        depth: edgeDepth(index % 3 === 0 ? clusterNodes[index - 1] : anchor, node),
        tone: "constellation"
      });
    }

    if (hub && cluster !== "hub") {
      edges.push({
        id: `dot-edge-hub-${cluster}`,
        from: hub,
        to: anchor,
        depth: edgeDepth(hub, anchor),
        tone: "constellation"
      });
    }
  }

  return edges;
}

function GraphEdgeLayer({ edges }: { edges: GraphEdgeView[] }) {
  return (
    <svg aria-hidden="true" className="graph-edge-layer" preserveAspectRatio="none" viewBox="0 0 100 100">
      {edges.map((edge) => (
        <line
          className={`graph-edge-line ${edge.tone}`}
          key={edge.id}
          pathLength={1}
          style={edgeLineStyle(edge)}
          x1={edge.from.x}
          x2={edge.to.x}
          y1={edge.from.y}
          y2={edge.to.y}
        />
      ))}
    </svg>
  );
}

function buildVaultGraphEdges(nodes: VaultGraphNode[]): GraphEdgeView[] {
  const availableSlots = new Set(nodes.map((node) => node.slot));
  const baseEdges = baseVaultGraphLinks
    .filter(([from, to]) => availableSlots.has(from) && availableSlots.has(to))
    .map(([from, to], index): GraphEdgeView => ({
      id: `vault-edge-${index + 1}`,
      from: vaultNodePoints[from],
      to: vaultNodePoints[to],
      depth: edgeDepth(vaultNodePoints[from], vaultNodePoints[to]),
      tone: "vault"
    }));

  const sourceEdges = nodes
    .filter((node) => node.tone === "source" && node.slot in vaultNodePoints && node.slot !== "vault-node-f")
    .map((node, index): GraphEdgeView => ({
      id: `source-edge-${node.id}-${index}`,
      from: vaultNodePoints["vault-node-f"],
      to: vaultNodePoints[node.slot],
      depth: edgeDepth(vaultNodePoints["vault-node-f"], vaultNodePoints[node.slot]),
      tone: "vault"
    }));

  return [...baseEdges, ...sourceEdges];
}

function buildFocusGraphEdges(edges: GraphEdge[], nodes: DraftNode[]): GraphEdgeView[] {
  const byId = new Map(nodes.map((node) => [node.id, focusNodePoints[node.graphSlot]]));
  const directEdges = edges.flatMap((edge): GraphEdgeView[] => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      return [];
    }

    return [
      {
        id: edge.id,
        label: edge.label,
        from,
        to,
        depth: edgeDepth(from, to),
        tone: "focus"
      }
    ];
  });

  if (directEdges.length > 0) {
    return directEdges;
  }

  return nodes.map((node, index): GraphEdgeView => ({
    id: `focus-anchor-${node.id}`,
    label: index === 0 ? node.relationType.toLowerCase() : undefined,
    from: vaultNodePoints["vault-node-a"],
    to: focusNodePoints[node.graphSlot],
    depth: edgeDepth(vaultNodePoints["vault-node-a"], focusNodePoints[node.graphSlot]),
    tone: "focus"
  }));
}

function graphNodeStyle(point: GraphPoint, index: number): CSSProperties {
  const scale = depthScale(point.z);
  return {
    left: `${point.x}%`,
    top: `${point.y}%`,
    "--node-depth": `${point.z}px`,
    "--node-index": index,
    "--node-hover-scale": (scale * 1.035).toFixed(3),
    "--node-layer": Math.round(220 + point.z),
    "--node-rise-scale": (scale * 0.9).toFixed(3),
    "--node-scale": scale.toFixed(3),
    "--node-shadow": `${Math.max(8, 22 + point.z / 6)}px`
  } as CSSProperties;
}

function graphDotStyle(node: GraphDotNode, index: number): CSSProperties {
  const scale = depthScale(node.z);
  const hoverScale = node.size === "pin" ? 1.8 : node.size === "hub" ? 1.42 : 2.15;
  return {
    left: `${node.x}%`,
    top: `${node.y}%`,
    "--dot-index": index,
    "--dot-layer": Math.round(100 + node.z),
    "--dot-hover-scale": hoverScale.toFixed(3),
    "--dot-scale": scale.toFixed(3)
  } as CSSProperties;
}

function edgeLabelStyle(edge: GraphEdgeView): CSSProperties {
  return {
    left: `${(edge.from.x + edge.to.x) / 2}%`,
    top: `${(edge.from.y + edge.to.y) / 2}%`,
    "--edge-depth": `${edge.depth}px`,
    "--edge-label-scale": depthScale(edge.depth).toFixed(3)
  } as CSSProperties;
}

function edgeLineStyle(edge: GraphEdgeView): CSSProperties {
  const normalizedDepth = Math.max(-140, Math.min(110, edge.depth));
  const edgeWeight = edge.tone === "focus" ? 0.36 : edge.tone === "constellation" ? 0.16 : 0.24;
  const edgeOpacity = edge.tone === "constellation" ? 0.16 + (normalizedDepth + 140) / 1100 : 0.52 + (normalizedDepth + 140) / 520;
  return {
    "--edge-opacity": edgeOpacity.toFixed(3),
    "--edge-width": (edgeWeight + (normalizedDepth + 140) / 1100).toFixed(3),
    "--edge-blur": normalizedDepth < -70 ? "0.25px" : "0px"
  } as CSSProperties;
}

function edgeDepth(from: GraphPoint, to: GraphPoint) {
  return (from.z + to.z) / 2;
}

function depthScale(depth: number) {
  return Math.max(0.86, Math.min(1.14, 1 + depth / 520));
}

function parseKnowledgeDraft(payload: string): KnowledgeDraftResponse {
  const parsed = JSON.parse(payload) as KnowledgeDraftResponse;
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error("Draft command returned an invalid payload.");
  }
  return parsed;
}

async function generateDraftViaTauri(sourceName: string, content: string): Promise<KnowledgeDraftResponse> {
  const payload =
    sourceName === promptDraftSourceName
      ? await invoke<string>("generate_knowledge_draft", { prompt: content })
      : await invoke<string>("generate_knowledge_draft_from_source", {
          sourceName,
          content
        });

  return parseKnowledgeDraft(payload);
}

async function analyzeSourceLibrary({
  browserSources,
  query,
  vaultRoot
}: {
  browserSources: SourceUploadPayload[];
  query: string;
  vaultRoot: string;
}): Promise<RagAnalysisResponse> {
  if (hasTauriRuntime()) {
    return parseRagAnalysis(await invoke<string>("analyze_sources", { vaultRoot, query }));
  }

  return analyzeBrowserSources(browserSources, query);
}

function parseSourceLibrary(payload: string): SourceLibraryResponse {
  const parsed = JSON.parse(payload) as SourceLibraryResponse;
  if (!Array.isArray(parsed.sources)) {
    throw new Error("Source ingest command returned an invalid payload.");
  }
  return parsed;
}

function parseRagAnalysis(payload: string): RagAnalysisResponse {
  const parsed = JSON.parse(payload) as RagAnalysisResponse;
  if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.chunks) || !Array.isArray(parsed.nodes)) {
    throw new Error("RAG analysis command returned an invalid payload.");
  }
  return parsed;
}

function isRagAnalysisResponse(draft: KnowledgeDraftResponse | RagAnalysisResponse): draft is RagAnalysisResponse {
  return "chunks" in draft && Array.isArray(draft.chunks);
}

function buildPipelineSteps(state: DraftRunState, copy: AppCopy): PipelineStep[] {
  const ids = ["summarize", "filter", "split", "link"];
  const stepCopy = state === "error" ? copy.pipeline.error : copy.pipeline.ready;

  if (state === "error") {
    return stepCopy.map(([label, description], index) => ({
      id: ids[index],
      label,
      status: index === 0 ? "Blocked" : "Queued",
      description
    }));
  }

  const statuses: PipelineStep["status"][] = [
    state === "idle" ? "Queued" : "Done",
    state === "idle" ? "Queued" : state === "processing" ? "Active" : "Done",
    state === "ready" ? "Done" : state === "processing" ? "Active" : "Queued",
    state === "ready" ? "Done" : "Queued"
  ];

  return stepCopy.map(([label, description], index) => ({
    id: ids[index],
    label,
    status: statuses[index],
    description
  }));
}

function buildKnowledgeFilters(nodes: DraftNode[], copy: AppCopy): KnowledgeFilter[] {
  const relationCounts = nodes.reduce<Record<DraftRelationType, number>>(
    (counts, node) => ({
      ...counts,
      [node.relationType]: counts[node.relationType] + 1
    }),
    { Source: 0, Prerequisite: 0, Supports: 0, Contrasts: 0 }
  );

  return [
    filter("core", copy.filters.core, nodes.length),
    filter("support", copy.filters.supports, relationCounts.Supports),
    filter("prereq", copy.filters.prereq, relationCounts.Prerequisite),
    filter("contrast", copy.filters.contrast, relationCounts.Contrasts)
  ];
}

function filter(id: string, label: string, count: number): KnowledgeFilter {
  return {
    id,
    label,
    count,
    state: count > 0 ? "Active" : "Muted"
  };
}

function buildVaultGraphNodes(sources: SourceLibraryItem[], copy: AppCopy): VaultGraphNode[] {
  const baseVaultNodes: VaultGraphNode[] = [
    {
      id: "vault-core",
      title: copy.graph.nodeTitle.vaultMap,
      meta: copy.graph.nodeMeta.vaultMap,
      slot: "vault-node-a",
      tone: "core"
    },
    {
      id: "vault-anchors",
      title: copy.graph.nodeTitle.sourceAnchors,
      meta: copy.graph.nodeMeta.sourceAnchors,
      slot: "vault-node-b",
      tone: "muted"
    },
    {
      id: "vault-review",
      title: copy.graph.nodeTitle.reviewQueue,
      meta: copy.graph.nodeMeta.reviewQueue,
      slot: "vault-node-c",
      tone: "muted"
    },
    {
      id: "vault-retrieval",
      title: copy.graph.nodeTitle.retrieval,
      meta: copy.graph.nodeMeta.retrieval,
      slot: "vault-node-d",
      tone: "muted"
    },
    {
      id: "vault-links",
      title: copy.graph.nodeTitle.linkGraph,
      meta: copy.graph.nodeMeta.linkGraph,
      slot: "vault-node-e",
      tone: "core"
    },
    {
      id: "vault-inbox",
      title: copy.graph.nodeTitle.inbox,
      meta: copy.graph.nodeMeta.inbox,
      slot: "vault-node-f",
      tone: "source"
    }
  ];

  const sourceNodes = sources.slice(0, 5).map((source, index): VaultGraphNode => {
    const slots = ["vault-node-g", "vault-node-h", "vault-node-i", "vault-node-j", "vault-node-k"];
    return {
      id: source.sourceId,
      title: compactPreviewText(stripExtension(source.sourceName), 28),
      meta: `${source.chunkCount} ${copy.chunksLabel}`,
      slot: slots[index % slots.length],
      tone: "source"
    };
  });

  return [...baseVaultNodes, ...sourceNodes];
}

function buildViewMetrics(
  sources: SourceLibraryItem[],
  chunks: RetrievedChunk[],
  nodes: DraftNode[],
  edges: GraphEdge[],
  copy: AppCopy
): ViewMetric[] {
  const chunkCount = sources.reduce((total, source) => total + source.chunkCount, 0);
  return [
    {
      label: copy.metrics.sources,
      value: String(sources.length),
      note: sources.length ? copy.metrics.sourcesWithData : copy.metrics.sourcesEmpty
    },
    {
      label: copy.metrics.evidence,
      value: String(chunks.length || chunkCount),
      note: chunks.length ? copy.metrics.evidenceWithData : copy.metrics.evidenceEmpty
    },
    {
      label: copy.metrics.drafts,
      value: String(nodes.length),
      note: edges.length ? copy.metrics.draftsWithLinks(edges.length) : copy.metrics.draftsEmpty
    }
  ];
}

function generateBrowserPreviewDraft(prompt: string, sourceName = promptDraftSourceName): KnowledgeDraftResponse {
  const sentences = prompt
    .split(/[.!?\n;]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 4);
  const parts = sentences.length ? sentences : [prompt];
  const nodes = parts.map((part, index): DraftNodeResponse => {
    const words = part.split(/\s+/).filter(Boolean);
    const title = words.slice(0, 6).join(" ") || `Knowledge node ${index + 1}`;
    const relationType: DraftRelationType =
      index === 0 ? "Source" : /risk|but|however|unless/i.test(part) ? "Contrasts" : "Supports";

    return {
      id: `browser-draft-${index + 1}`,
      title: title[0] ? `${title[0].toUpperCase()}${title.slice(1)}` : `Knowledge node ${index + 1}`,
      summary: compactPreviewText(part, 190),
      tags: buildPreviewTags(part),
      confidence: Math.max(70, 90 - index * 3),
      relationType,
      source: `${sourceName}:${index + 1}-${index + 1}`
    };
  });

  const edges = nodes.slice(1).map((node, index): GraphEdgeResponse => {
    const previous = nodes[index];
    return {
      id: `browser-edge-${index + 1}`,
      from: previous.id,
      to: node.id,
      label: node.relationType === "Contrasts" ? "contrasts" : "supports"
    };
  });

  if (nodes.length > 2) {
    edges.push({
      id: `browser-edge-${edges.length + 1}`,
      from: nodes[0].id,
      to: nodes[nodes.length - 1].id,
      label: "frames"
    });
  }

  return {
    sourceName,
    nodes,
    edges
  };
}

function isSupportedUploadName(fileName: string) {
  const normalized = fileName.toLowerCase();
  return supportedUploadExtensions.some((extension) => normalized.endsWith(extension));
}

async function readSourceFiles(fileList: FileList, copy: AppCopy): Promise<SourceUploadPayload[]> {
  const files = Array.from(fileList);
  const uploads: SourceUploadPayload[] = [];

  for (const file of files) {
    if (!isSupportedUploadName(file.name)) {
      throw new Error(copy.messages.unsupportedFile);
    }
    if (file.size > maxUploadBytes) {
      throw new Error(copy.messages.fileTooLarge(file.name, formatBytes(maxUploadBytes)));
    }

    const content = await file.text();
    if (!content.trim()) {
      throw new Error(copy.messages.fileEmpty(file.name));
    }

    uploads.push({
      sourceName: file.name,
      content
    });
  }

  return uploads;
}

function indexBrowserSources(uploads: SourceUploadPayload[]): SourceLibraryItem[] {
  return uploads.map((upload) => {
    const sourceId = `browser_${stableHash(`${upload.sourceName}\n${upload.content}`)}`;
    return {
      sourceId,
      sourceName: upload.sourceName,
      sha256: stableHash(upload.content),
      sizeBytes: new Blob([upload.content]).size,
      chunkCount: chunkBrowserSource(sourceId, upload).length,
      vaultRelativePath: `browser-memory/${upload.sourceName}`
    };
  });
}

function analyzeBrowserSources(sources: SourceUploadPayload[], query: string): RagAnalysisResponse {
  const library = indexBrowserSources(sources);
  const chunks = sources.flatMap((source) => {
    const sourceId = `browser_${stableHash(`${source.sourceName}\n${source.content}`)}`;
    return chunkBrowserSource(sourceId, source);
  });
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
  const ranked = chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(chunk.text, terms)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  const selected = ranked.length ? ranked : chunks.slice(0, 8);
  const nodes = selected.slice(0, 4).map((chunk, index): DraftNodeResponse => {
    const title = chunk.text
      .replace(/^#+\s*/, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .join(" ");
    const relationType: DraftRelationType =
      index === 0 ? "Source" : /risk|but|however|unless|contrast/i.test(chunk.text) ? "Contrasts" : "Supports";

    return {
      id: `browser-rag-node-${index + 1}`,
      title: title ? `${title[0].toUpperCase()}${title.slice(1)}` : `Retrieved node ${index + 1}`,
      summary: compactPreviewText(chunk.text, 190),
      tags: buildPreviewTags(chunk.text),
      confidence: Math.max(72, 92 - index * 4),
      relationType,
      source: `${chunk.sourceName}:${chunk.startLine}-${chunk.endLine}`
    };
  });
  const edges = nodes.slice(1).map((node, index): GraphEdgeResponse => ({
    id: `browser-rag-edge-${index + 1}`,
    from: nodes[index].id,
    to: node.id,
    label: node.relationType === "Contrasts" ? "contrasts" : "supports"
  }));

  return {
    query,
    sourceName: "rag-analysis.md",
    sources: library,
    chunks: selected,
    nodes,
    edges
  };
}

function chunkBrowserSource(sourceId: string, source: SourceUploadPayload): RetrievedChunk[] {
  const chunks: RetrievedChunk[] = [];
  let current = "";
  let startLine = 1;
  let endLine = 1;

  source.content.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (!current) {
      startLine = lineNumber;
    }
    current = current ? `${current}\n${line}` : line;
    endLine = lineNumber;

    const boundary = line.trim() === "" || line.startsWith("#") || current.length >= 1400;
    if (current.length >= 420 && boundary) {
      chunks.push({
        chunkId: `${sourceId}_chunk_${chunks.length + 1}`,
        sourceId,
        sourceName: source.sourceName,
        startLine,
        endLine,
        text: current.trim(),
        score: 0
      });
      current = "";
    }
  });

  if (current.trim()) {
    chunks.push({
      chunkId: `${sourceId}_chunk_${chunks.length + 1}`,
      sourceId,
      sourceName: source.sourceName,
      startLine,
      endLine,
      text: current.trim(),
      score: 0
    });
  }

  return chunks;
}

function mergeBrowserSources(current: SourceUploadPayload[], incoming: SourceUploadPayload[]) {
  const byName = new Map(current.map((source) => [source.sourceName, source]));
  incoming.forEach((source) => byName.set(source.sourceName, source));
  return Array.from(byName.values());
}

function mergeSourceLibrary(current: SourceLibraryItem[], incoming: SourceLibraryItem[]) {
  const byId = new Map(current.map((source) => [source.sourceId, source]));
  incoming.forEach((source) => byId.set(source.sourceId, source));
  return Array.from(byId.values()).sort((left, right) => left.sourceName.localeCompare(right.sourceName));
}

function scoreChunk(text: string, terms: string[]) {
  if (!terms.length) {
    return 0;
  }
  const lowered = text.toLowerCase();
  return terms.reduce((score, term) => score + (lowered.includes(term) ? 1 : 0), 0);
}

function compactPreviewText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function buildPreviewTags(text: string) {
  const stopWords = new Set(["and", "the", "that", "this", "with", "into", "when", "note", "notes"]);
  const tags = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !stopWords.has(word))
    .slice(0, 3);
  return tags.length ? tags : ["learning"];
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatScore(score: number, copy: AppCopy) {
  return score > 0 ? score.toFixed(2) : copy.formatScoreMatch;
}

function countSourcesByExtension(sources: SourceLibraryItem[], extension: string) {
  return sources.filter((source) => source.sourceName.toLowerCase().endsWith(extension)).length;
}

function countMarkdownSources(sources: SourceLibraryItem[]) {
  return sources.filter((source) => {
    const name = source.sourceName.toLowerCase();
    return name.endsWith(".md") || name.endsWith(".markdown");
  }).length;
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function getInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem("learn-alone.locale");
    if (stored === "en" || stored === "vi") {
      return stored;
    }
  } catch {
    // Fall back to browser language below.
  }

  return window.navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function stateLabel(state: DraftRunState, copy: AppCopy) {
  return copy.states[state];
}

function statusLabel(status: PipelineStep["status"], copy: AppCopy) {
  return copy.statuses[status];
}

function relationLabel(relation: DraftRelationType, copy: AppCopy) {
  return copy.relations[relation];
}
