import { invoke } from "@tauri-apps/api/core";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

type WorkspacePage = "projects" | "note" | "graph" | "review" | "pet" | "settings";
type WorkspaceMainPage = Exclude<WorkspacePage, "settings">;
type SettingsView = "account" | "llm";
type DraftRelationType = "Source" | "Prerequisite" | "Supports" | "Contrasts";
type SuggestionStatus = "pending" | "approved" | "rejected";
type LlmProvider = "OpenAI" | "Anthropic" | "Azure OpenAI" | "Google Gemini" | "OpenRouter" | "Ollama" | "Local API" | "Custom";

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

type EvidenceLocatorResponse = {
  schemaVersion: number;
  sourceVersionId: string;
  sourceId: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  excerpt: string;
};

type EvidenceDrawerState = {
  versionId: string;
  sourceId: string;
  locator: EvidenceLocatorResponse | null;
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

type DraftNodeResponse = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
  relationType: DraftRelationType;
  source: string;
};

type GraphEdgeResponse = {
  id: string;
  from: string;
  to: string;
  label: string;
};

type KnowledgeDraftResponse = {
  sourceName: string;
  nodes: DraftNodeResponse[];
  edges: GraphEdgeResponse[];
};

type RagAnalysisResponse = KnowledgeDraftResponse & {
  query: string;
  sources: SourceLibraryItem[];
  chunks: RetrievedChunk[];
};

type LearningNoteResponse = {
  noteId: string;
  title: string;
  bodyMarkdown: string;
  updatedAtUnixMs: number;
};

type LearningNoteListResponse = {
  notes: LearningNoteResponse[];
};

type LearningNote = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  sourceCount: number;
};

type RelationSuggestion = {
  suggestionId: string;
  fromNodeId: string;
  toNodeId: string;
  fromTitle: string;
  toTitle: string;
  relationKind: string;
  rationale: string;
  confidence: number;
  status: SuggestionStatus;
};

type RoadmapNode = {
  id: string;
  title: string;
  summary: string;
  x: number;
  y: number;
  depth: number;
  tone: "primary" | "source" | "draft" | "review" | "muted" | "reference";
  meta: string;
  reference?: boolean;
};

type RoadmapEdge = {
  id: string;
  from: string;
  to: string;
  status: "fixed" | SuggestionStatus;
};

type NodePoint = { x: number; y: number };

type GraphViewTransform = { x: number; y: number; k: number };

type GraphFocusRequest = { nodeId: string; token: number };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: string[];
};

type SlashCommand = {
  id: string;
  label: string;
  description: string;
  insert: string;
};

type ProjectTone = "paper" | "sage" | "clay" | "blue" | "rose" | "amber";

type ProjectManifest = {
  schemaVersion: number;
  projectId: string;
  title: string;
  slug: string;
  defaultNoteId: string;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
};

type ProjectNote = {
  schemaVersion: number;
  projectId: string;
  noteId: string;
  title: string;
  slug: string;
  tags: string[];
  bodyMarkdown: string;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  legacyNoteId: string | null;
  vaultRelativePath: string;
};

type ProjectNoteListResponse = {
  notes: ProjectNote[];
};

type ProjectListResponse = {
  projects: ProjectManifest[];
};

type ProjectSnapshotResponse = {
  project: ProjectManifest;
  defaultNote: ProjectNote;
};

type LegacyMigrationResponse = {
  status: "migrated" | "alreadyCompleted" | "noLegacyNotes";
  migratedNoteCount: number;
  importedProjectId: string | null;
  backupVaultRelativePath: string | null;
  contentSha256: string | null;
};

type ReviewRun = {
  schemaVersion: number;
  runId: string;
  projectId: string;
  noteFilter: string[];
  citedSourceVersionIds: string[];
  prompt: string;
  dueCount: number;
  createdAtUnixMs: number;
  vaultRelativePath: string;
};

type ReviewRunListResponse = {
  runs: ReviewRun[];
};

type ProjectMetric = {
  projectId: string;
  runCount: number;
  dueCountTotal: number;
  dueCountMax: number;
  lastRunUnixMs: number;
  citedSourceVersionTotal: number;
  isActiveLearner: boolean;
  recentRunCount: number;
};

type MetricsThresholds = {
  activeLearnerMinRuns: number;
  consistencyWindowMs: number;
};

type LearningMetrics = {
  schemaVersion: number;
  thresholds: MetricsThresholds;
  totalRuns: number;
  totalCitedSourceVersions: number;
  projects: ProjectMetric[];
  firstEventUnixMs: number;
  lastEventUnixMs: number;
};

// Slice 5 — PET companion types.
type ActionCard = {
  id: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  anchorType: string | null;
  anchorId: string | null;
};

type PetCompanion = {
  schemaVersion: number;
  projectId: string;
  asOfUnixMs: number;
  cards: ActionCard[];
  categoryCounts: Record<string, number>;
};

type NodeSourceCard = {
  id: string;
  label: string;
  detail: string;
  excerpt: string;
};

const maxUploadBytes = 2 * 1024 * 1024;
const maxUploadFiles = 40;
const promptDraftSourceName = "note-draft.md";
const supportedUploadExtensions = [".txt", ".md", ".markdown"];
const workspaceTabs: { id: WorkspaceMainPage; label: string; shortLabel: string }[] = [
  { id: "projects", label: "Projects", shortLabel: "P" },
  { id: "note", label: "Note", shortLabel: "N" },
  { id: "graph", label: "Graph", shortLabel: "G" },
  { id: "review", label: "Review", shortLabel: "R" },
  { id: "pet", label: "Companion", shortLabel: "C" }
];

const projectTones: ProjectTone[] = ["paper", "sage", "clay", "blue", "rose", "amber"];

const llmProviders: LlmProvider[] = ["OpenAI", "Anthropic", "Azure OpenAI", "Google Gemini", "OpenRouter", "Ollama", "Local API", "Custom"];
const llmModels: Record<LlmProvider, string[]> = {
  OpenAI: ["GPT-5.5", "GPT-5 mini", "GPT-4.1"],
  Anthropic: ["Claude Opus", "Claude Sonnet", "Claude Haiku"],
  "Azure OpenAI": ["gpt-5.5-deployment", "gpt-5-mini-deployment"],
  "Google Gemini": ["Gemini 2.5 Pro", "Gemini 2.5 Flash"],
  OpenRouter: ["openrouter/auto", "anthropic/claude-sonnet", "openai/gpt-5-mini"],
  Ollama: [],
  "Local API": ["local-default", "llama.cpp", "ollama"],
  Custom: []
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

// The graph canvas maps the legacy percent-based node coordinates onto a
// fixed world plane (px). Node drag offsets and the pan/zoom transform all
// live in this world space, so edges stay glued to nodes at any zoom level.
const GRAPH_WORLD_WIDTH = 1400;
const GRAPH_WORLD_HEIGHT = 900;
const GRAPH_MIN_ZOOM = 0.35;
const GRAPH_MAX_ZOOM = 2.6;
const GRAPH_FIT_PADDING = 90;

const slashCommands: SlashCommand[] = [
  {
    id: "h1",
    label: "Heading 1",
    description: "Top-level learning topic",
    insert: "# "
  },
  {
    id: "h2",
    label: "Heading 2",
    description: "Important section",
    insert: "## "
  },
  {
    id: "citation",
    label: "Citation",
    description: "Quote or source excerpt",
    insert: "> "
  },
  {
    id: "checklist",
    label: "Checklist",
    description: "Turn ideas into review tasks",
    insert: "- [ ] "
  },
  {
    id: "question",
    label: "Recall question",
    description: "Prepare a future review prompt",
    insert: "Q: \nA: "
  }
];

const seedNotes: LearningNote[] = [
  {
    id: "note_study_personal",
    title: "Study-Personal",
    body:
      "This desktop app should run on Windows and macOS.\n\n/ Use sources, notes, graph approvals, and review prompts as one local-first workflow.",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sourceCount: 0
  }
];

const emptyLearningNote: LearningNote = {
  id: "",
  title: "No note selected",
  body: "",
  createdAt: 0,
  updatedAt: 0,
  sourceCount: 0
};

const seedNodes: RoadmapNode[] = [
  {
    id: "capture",
    title: "Capture",
    summary: "Upload source files and take fast notes in the same workspace.",
    x: 18,
    y: 18,
    depth: 16,
    tone: "reference",
    meta: "note",
    reference: true
  },
  {
    id: "source-index",
    title: "Source index",
    summary: "Markdown and text sources are chunked, hashed, and indexed with SQLite FTS.",
    x: 18,
    y: 44,
    depth: -8,
    tone: "reference",
    meta: "FTS",
    reference: true
  },
  {
    id: "draft-nodes",
    title: "AI draft nodes",
    summary: "AI or deterministic generators create candidate knowledge nodes.",
    x: 50,
    y: 34,
    depth: 40,
    tone: "reference",
    meta: "pending",
    reference: true
  },
  {
    id: "approval",
    title: "Approval gate",
    summary: "Suggested edges remain pending until the user approves or rejects them.",
    x: 50,
    y: 62,
    depth: 18,
    tone: "reference",
    meta: "human",
    reference: true
  },
  {
    id: "graph-review",
    title: "Review prompt",
    summary: "Approved notes feed NotebookLM-style review answers with citations.",
    x: 82,
    y: 48,
    depth: 4,
    tone: "reference",
    meta: "review",
    reference: true
  }
];

const seedEdges: RoadmapEdge[] = [
  { id: "edge-capture-source", from: "capture", to: "source-index", status: "fixed" },
  { id: "edge-source-draft", from: "source-index", to: "draft-nodes", status: "fixed" },
  { id: "edge-draft-approval", from: "draft-nodes", to: "approval", status: "fixed" },
  { id: "edge-approval-review", from: "approval", to: "graph-review", status: "fixed" }
];

const studioActions = [
  ["Briefing Doc", "Source-grounded study guide"],
  ["Flashcards", "Generate recall cards"],
  ["Quiz", "Check weak concepts"],
  ["Mind Map", "Cluster related nodes"],
  ["Data Table", "Compare source chunks"],
  ["Report", "Summarize approval gaps"]
] as const;

function createReviewWelcomeMessages(): ChatMessage[] {
  return [
    {
      id: "assistant_welcome",
      role: "assistant",
      text:
        "Ask a question about the approved graph or uploaded sources. Answers should be checked against citations before review.",
      citations: []
    }
  ];
}

export function App() {
  const [activePage, setActivePage] = useState<WorkspacePage>("projects");
  const [lastWorkspacePage, setLastWorkspacePage] = useState<WorkspaceMainPage>("projects");
  const [settingsView, setSettingsView] = useState<SettingsView>("llm");
  const [vaultRoot, setVaultRoot] = useState("vault");
  const [notes, setNotes] = useState<LearningNote[]>(seedNotes);
  const [activeNoteId, setActiveNoteId] = useState(seedNotes[0].id);
  const [sourceLibrary, setSourceLibrary] = useState<SourceLibraryItem[]>([]);
  const [browserSources, setBrowserSources] = useState<SourceUploadPayload[]>([]);
  const [projectSourceVersions, setProjectSourceVersions] = useState<
    {
      schemaVersion: number;
      projectId: string;
      sourceId: string;
      versionId: string;
      sourceName: string;
      sha256: string;
      modality: string;
      sizeBytes: number;
      createdAtUnixMs: number;
      versionKind: string;
      vaultRelativePath: string;
    }[]
  >([]);
  const [selectedSourceVersionId, setSelectedSourceVersionId] = useState<string | null>(null);
  const [evidenceDrawer, setEvidenceDrawer] = useState<EvidenceDrawerState | null>(null);
  const [evidenceLocatorsByVersionId, setEvidenceLocatorsByVersionId] = useState<
    Record<string, EvidenceLocatorResponse>
  >({});
  const [retrievedChunks, setRetrievedChunks] = useState<RetrievedChunk[]>([]);
  const [draftNodes, setDraftNodes] = useState<DraftNodeResponse[]>([]);
  const [draftEdges, setDraftEdges] = useState<GraphEdgeResponse[]>([]);
  const [suggestions, setSuggestions] = useState<RelationSuggestion[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [graphSearchQuery, setGraphSearchQuery] = useState("");
  const [graphNodeLayout, setGraphNodeLayout] = useState<Record<string, NodePoint>>({});
  const [graphFocusRequest, setGraphFocusRequest] = useState<GraphFocusRequest | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("OpenAI");
  const [llmModel, setLlmModel] = useState(llmModels.OpenAI[0]);
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [sessionApiKey, setSessionApiKey] = useState("");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isFetchingOllamaModels, setIsFetchingOllamaModels] = useState(false);
  const [accountName, setAccountName] = useState("Local user");
  const [accountEmail, setAccountEmail] = useState("local-user@example.com");
  const [newEmail, setNewEmail] = useState("");
  const [consultationBannerEnabled, setConsultationBannerEnabled] = useState(true);
  // StudyNote Slice 1/2 — project state
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const projectScopeTokenRef = useRef(0);
  const dirtyNoteIdsRef = useRef<Set<string>>(new Set());
  const noteRevisionByIdRef = useRef<Map<string, number>>(new Map());
  const dirtyGenerationRef = useRef(0);
  const noteWriteInFlightRef = useRef<Set<string>>(new Set());
  const [activeProjectTitle, setActiveProjectTitle] = useState("");
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([]);
  const [activeProjectNoteId, setActiveProjectNoteId] = useState<string | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<LegacyMigrationResponse["status"] | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [isProjectComposerOpen, setIsProjectComposerOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingProjectTitle, setRenamingProjectTitle] = useState("");
  const [reviewPrompt, setReviewPrompt] = useState("");
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const [reviewNoteFilter, setReviewNoteFilter] = useState<string[]>([]);
  const [reviewSelectedSourceVersions, setReviewSelectedSourceVersions] = useState<string[]>([]);
  const [isSourceRailCollapsed, setIsSourceRailCollapsed] = useState(false);
  const [isStudioPanelCollapsed, setIsStudioPanelCollapsed] = useState(false);
  const [reviewRuns, setReviewRuns] = useState<ReviewRun[]>([]);
  const [learningMetrics, setLearningMetrics] = useState<LearningMetrics | null>(null);
  const [petCompanion, setPetCompanion] = useState<PetCompanion | null>(null);
  const [petError, setPetError] = useState<string | null>(null);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(createReviewWelcomeMessages);

  const activeNote = notes.find((note) => note.id === activeNoteId) ?? emptyLearningNote;
  const projectCards = useMemo(
    () =>
      buildProjectCards(
        projects,
        activeProjectId,
        projectNotes,
        projectSourceVersions,
        projectSearchQuery
      ),
    [activeProjectId, projectNotes, projectSearchQuery, projectSourceVersions, projects]
  );
  const roadmapNodes = useMemo(
    () => buildRoadmapNodes(sourceLibrary, draftNodes, projectSourceVersions, activeProjectId),
    [draftNodes, sourceLibrary, projectSourceVersions, activeProjectId]
  );
  const roadmapEdges = useMemo(
    () => buildRoadmapEdges(roadmapNodes, suggestions, draftEdges),
    [draftEdges, roadmapNodes, suggestions]
  );
  const graphSearchMatches = useMemo(
    () => searchRoadmapNodes(roadmapNodes, graphSearchQuery),
    [graphSearchQuery, roadmapNodes]
  );
  const selectedNode = selectedNodeId ? roadmapNodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const selectedNodeSources = selectedNode
    ? buildNodeSourceCards(selectedNode, activeNote, draftNodes, retrievedChunks, sourceLibrary)
    : [];
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const approvedSuggestions = suggestions.filter((suggestion) => suggestion.status === "approved");
  const hasActiveProject = activeProjectId !== null;
  const hasProjectGraphData =
    hasActiveProject &&
    (projectSourceVersions.length > 0 || draftNodes.length > 0 || suggestions.length > 0);
  const selectedNodeSuggestions = selectedNode
    ? pendingSuggestions.filter(
        (suggestion) =>
          suggestion.fromNodeId === selectedNode.id ||
          suggestion.toNodeId === selectedNode.id
      )
    : [];
  const activeProjectNote = projectNotes.find((n) => n.noteId === activeProjectNoteId) ?? projectNotes[0];
  const sourceCount = sourceLibrary.length;
  const indexedChunkCount = sourceLibrary.reduce((total, source) => total + source.chunkCount, 0);
  const apiKeyState = sessionApiKey.trim()
    ? "Session key active"
    : llmProvider === "Ollama"
      ? "No key required for local Ollama"
      : llmProvider === "Custom"
        ? "No key stored — optional, depends on the endpoint"
        : "No key stored";
  const isLlmConfigured = llmProvider === "Ollama"
    ? Boolean(llmModel.trim())
    : llmProvider === "Custom"
      ? Boolean(llmModel.trim() && llmBaseUrl.trim())
      : Boolean(sessionApiKey.trim());

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let cancelled = false;

    async function initializeProjects() {
      // Step 1: run legacy migration once (idempotent). The project list
      // must be read after this settles so a newly imported Project is not
      // omitted from the first render.
      try {
        const payload = await invoke<string>("migrate_legacy_workspace", { vaultRoot });
        if (cancelled) return;
        try {
          const parsed = JSON.parse(payload) as LegacyMigrationResponse;
          setMigrationStatus(parsed.status);
        } catch {
          // tolerate legacy response variations
        }
      } catch {
        // migration is idempotent — a failure here is non-fatal
      }

      if (cancelled) return;

      // Step 2: load the real project list only after migration settles.
      try {
        const payload = await invoke<string>("list_projects", { vaultRoot });
        if (cancelled) return;
        const parsed = JSON.parse(payload) as ProjectListResponse;
        setProjects(parsed.projects);
        if (parsed.projects.length === 1) {
          const only = parsed.projects[0];
          activateProject(only.projectId, only.title);
        }
      } catch {
        // first-run vaults may not yet have any project — leave UI in "create" state
      }
    }

    void initializeProjects();

    return () => {
      cancelled = true;
    };
  }, [vaultRoot]);

  // Step 3: when the active project changes, load project-scoped notes.
  useEffect(() => {
    if (!hasTauriRuntime() || !activeProjectId) {
      setProjectNotes([]);
      setActiveProjectNoteId(null);
      // Defense against the diagnose finding "stale editor content
      // saveable into the newly selected Project": if we are no longer
      // in a valid project, do not keep the previous Project's note
      // content visible.
      setNotes([]);
      setActiveNoteId("");
      return;
    }

    // Clear both selection sources before loading the next Project. This
    // prevents the previous Project's editor buffer from being saveable
    // while the canonical note list is in flight.
    setProjectNotes([]);
    setActiveProjectNoteId(null);
    setNotes([]);
    setActiveNoteId("");

    let cancelled = false;
    invoke<string>("list_project_notes", { vaultRoot, projectId: activeProjectId })
      .then((payload) => {
        if (cancelled) return;
        const parsed = JSON.parse(payload) as ProjectNoteListResponse;
        setProjectNotes(parsed.notes);
        const nextNoteId = parsed.notes[0]?.noteId ?? null;
        setActiveProjectNoteId(nextNoteId);
        setNotes(parsed.notes.map((note) => mapProjectNoteToLearningNote(note)));
        setActiveNoteId(nextNoteId ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setProjectNotes([]);
        setActiveProjectNoteId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [vaultRoot, activeProjectId]);

  // Review state is Project-owned. Clear filters, selected citations and
  // source-derived answers at the scope boundary so a Review can never
  // silently cite material from the previously active Project.
  useEffect(() => {
    setReviewNoteFilter([]);
    setReviewSelectedSourceVersions([]);
    setReviewPrompt("");
    setIsReviewSubmitting(false);
    setIsProcessing(false);
    setChatMessages(createReviewWelcomeMessages());
    setRetrievedChunks([]);
    setSourceLibrary([]);
    setBrowserSources([]);
    setDraftNodes([]);
    setDraftEdges([]);
    setSuggestions([]);
    setSelectedNodeId(null);
  }, [activeProjectId]);

  // Slice 3 — when the active project changes, list project-scoped
  // source versions and keep one selected so the Evidence drawer has
  // a target.
  useEffect(() => {
    if (!hasTauriRuntime() || !activeProjectId) {
      setProjectSourceVersions([]);
      setSelectedSourceVersionId(null);
      setEvidenceDrawer(null);
      setEvidenceLocatorsByVersionId({});
      return;
    }

    setProjectSourceVersions([]);
    setSelectedSourceVersionId(null);
    setEvidenceDrawer(null);
    setEvidenceLocatorsByVersionId({});
    let cancelled = false;
    invoke<string>("list_project_source_versions", {
      vaultRoot,
      projectId: activeProjectId
    })
      .then((payload) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(payload) as {
            versions: typeof projectSourceVersions;
          };
          setProjectSourceVersions(parsed.versions);
          setSelectedSourceVersionId(parsed.versions[0]?.versionId ?? null);
        } catch {
          setProjectSourceVersions([]);
          setSelectedSourceVersionId(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProjectSourceVersions([]);
        setSelectedSourceVersionId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [vaultRoot, activeProjectId]);

  // Slice 4 — when the active project changes, list review runs and
  // compute metrics from the append-only Learning Event log.
  useEffect(() => {
    if (!hasTauriRuntime() || !activeProjectId) {
      setReviewRuns([]);
      return;
    }

    setReviewRuns([]);
    let cancelled = false;
    invoke<string>("list_project_review_runs", {
      vaultRoot,
      projectId: activeProjectId
    })
      .then((payload) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(payload) as ReviewRunListResponse;
          setReviewRuns(parsed.runs);
        } catch {
          setReviewRuns([]);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setReviewRuns([]);
      });

    return () => {
      cancelled = true;
    };
  }, [vaultRoot, activeProjectId]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      setLearningMetrics(null);
      return;
    }
    let cancelled = false;
    invoke<string>("list_learning_metrics", {
      vaultRoot,
      requestJson: null
    })
      .then((payload) => {
        if (cancelled) return;
        try {
          setLearningMetrics(JSON.parse(payload) as LearningMetrics);
        } catch {
          setLearningMetrics(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLearningMetrics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultRoot, reviewRuns]);

  // Slice 5 — load PET companion when project or metrics change.
  useEffect(() => {
    if (!hasTauriRuntime() || !activeProjectId) {
      setPetCompanion(null);
      setPetError(null);
      return;
    }
    let cancelled = false;
    setPetError(null);
    invoke<string>("analyze_project_pet", { vaultRoot, projectId: activeProjectId })
      .then((payload) => {
        if (cancelled) return;
        try {
          setPetCompanion(JSON.parse(payload) as PetCompanion);
        } catch (parseErr) {
          setPetCompanion(null);
          setPetError(
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPetCompanion(null);
        setPetError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultRoot, activeProjectId, learningMetrics]);

  // Slice 4 — project-scoped note filter (Note workspace).
  // Filtering happens in the render so we never mutate the
  // project-owned `projectNotes` reference.
  const filteredProjectNotes = useMemo(() => {
    if (!noteSearchQuery.trim()) {
      return projectNotes;
    }
    const needle = noteSearchQuery.trim().toLowerCase();
    return projectNotes.filter((note) =>
      `${note.title}\n${note.bodyMarkdown}\n${note.tags.join(" ")}`
        .toLowerCase()
        .includes(needle)
    );
  }, [projectNotes, noteSearchQuery]);

  // Slice 4 — only show the metrics for the active project; the rest of
  // the vault stays visible in dev only for the "All projects" diagnostics.
  const activeProjectMetric = learningMetrics?.projects.find(
    (metric) => metric.projectId === activeProjectId
  ) ?? null;

  function handleOpenEvidence(versionId: string, sourceId: string) {
    setSelectedSourceVersionId(versionId);
    setEvidenceDrawer({
      versionId,
      sourceId,
      locator: evidenceLocatorsByVersionId[versionId] ?? null
    });
  }

  function isProjectScopeCurrent(projectId: string | null, scopeToken: number) {
    return (
      activeProjectIdRef.current === projectId &&
      projectScopeTokenRef.current === scopeToken
    );
  }

  function activateProject(projectId: string, title: string) {
    if (activeProjectIdRef.current !== projectId) {
      projectScopeTokenRef.current += 1;
      dirtyNoteIdsRef.current.clear();
      noteRevisionByIdRef.current.clear();
    }
    activeProjectIdRef.current = projectId;
    setActiveProjectId(projectId);
    setActiveProjectTitle(title);
  }

  function markNoteDirty(noteId: string) {
    if (noteId) {
      noteRevisionByIdRef.current.set(
        noteId,
        (noteRevisionByIdRef.current.get(noteId) ?? 0) + 1
      );
      dirtyGenerationRef.current += 1;
      dirtyNoteIdsRef.current.add(noteId);
    }
  }

  function clearNoteDirty(noteId: string) {
    dirtyNoteIdsRef.current.delete(noteId);
  }
  function clearNoteTracking(noteId: string) {
    dirtyNoteIdsRef.current.delete(noteId);
    noteRevisionByIdRef.current.delete(noteId);
  }

  function acquireNoteWrite(noteId: string) {
    if (noteWriteInFlightRef.current.has(noteId)) {
      setErrorMessage(
        "A save, rename, or delete is already in progress for this Note."
      );
      return false;
    }
    noteWriteInFlightRef.current.add(noteId);
    return true;
  }

  function releaseNoteWrite(noteId: string) {
    noteWriteInFlightRef.current.delete(noteId);
  }


  function confirmProjectBoundaryChange(
    nextProjectId: string | null,
    action: "switch" | "create"
  ) {
    if (
      dirtyNoteIdsRef.current.size === 0 ||
      (nextProjectId !== null && nextProjectId === activeProjectIdRef.current)
    ) {
      return true;
    }

    const dirtyCount = dirtyNoteIdsRef.current.size;
    const confirmed = window.confirm(
      "You have " +
        dirtyCount +
        " unsaved Note" +
        (dirtyCount === 1 ? "" : "s") +
        ". Discard these drafts and " +
        (action === "create" ? "create another Project?" : "switch Projects?")
    );
    if (!confirmed) {
      setStatusMessage("Project change canceled. Unsaved Note drafts were kept.");
      return false;
    }
    return true;
  }

  // Sync project-scoped notes back into the Note workspace legacy view.
  // This lets us cut over the writes (save_note -> save_project_note)
  // without rewriting every reference to `activeNote` below.
  useEffect(() => {
    if (projectNotes.length === 0) {
      setNotes([]);
      setActiveProjectNoteId(null);
      setActiveNoteId("");
      return;
    }
    const nextNoteId = projectNotes.some((note) => note.noteId === activeProjectNoteId)
      ? activeProjectNoteId!
      : projectNotes[0].noteId;
    setNotes((current) => {
      const editableById = new Map(current.map((note) => [note.id, note]));
      return projectNotes.map((projectNote) => {
        const editable = editableById.get(projectNote.noteId);
        if (editable && dirtyNoteIdsRef.current.has(projectNote.noteId)) {
          return editable;
        }
        return mapProjectNoteToLearningNote(projectNote, editable?.sourceCount ?? 0);
      });
    });
    setActiveProjectNoteId(nextNoteId);
    setActiveNoteId(nextNoteId);
  }, [projectNotes]);

  function selectProjectNote(noteId: string) {
    if (!projectNotes.some((note) => note.noteId === noteId)) {
      return;
    }
    // React batches these setters, keeping list selection and editor content
    // on the same canonical Note in one interaction.
    setActiveProjectNoteId(noteId);
    setActiveNoteId(noteId);
    setSlashOpen(false);
  }

  async function handleCreateProject() {
    const title = newProjectTitle.trim();
    if (!title) {
      setErrorMessage("Project needs a title.");
      return;
    }
    if (!hasTauriRuntime()) {
      setErrorMessage("Creating projects requires the desktop app runtime.");
      return;
    }
    if (!confirmProjectBoundaryChange(null, "create")) {
      return;
    }

    const originProjectId = activeProjectIdRef.current;
    const originScopeToken = projectScopeTokenRef.current;
    const originDirtyGeneration = dirtyGenerationRef.current;

    setIsCreatingProject(true);
    setErrorMessage(null);
    try {
      const payload = await invoke<string>("create_project", {
        vaultRoot,
        title
      });
      const snapshot = JSON.parse(payload) as ProjectSnapshotResponse;
      setProjects((current) => {
        const exists = current.some((p) => p.projectId === snapshot.project.projectId);
        return exists ? current : [...current, snapshot.project];
      });
      if (!isProjectScopeCurrent(originProjectId, originScopeToken)) {
        return;
      }
      if (dirtyGenerationRef.current !== originDirtyGeneration) {
        setNewProjectTitle("");
        setIsProjectComposerOpen(false);
        setStatusMessage(
          "Project was created, but newer unsaved Note changes kept the current Project open."
        );
        return;
      }
      activateProject(snapshot.project.projectId, snapshot.project.title);
      setProjectNotes([snapshot.defaultNote]);
      setActiveProjectNoteId(snapshot.defaultNote.noteId);
      setNotes([
        {
          id: snapshot.defaultNote.noteId,
          title: snapshot.defaultNote.title,
          body: snapshot.defaultNote.bodyMarkdown,
          createdAt: snapshot.defaultNote.createdAtUnixMs,
          updatedAt: snapshot.defaultNote.updatedAtUnixMs,
          sourceCount: 0
        }
      ]);
      setActiveNoteId(snapshot.defaultNote.noteId);
      setNewProjectTitle("");
      setIsProjectComposerOpen(false);
      setLastWorkspacePage("note");
      setActivePage("note");
      setStatusMessage(`Created Project "${snapshot.project.title}".`);
    } catch (error) {
      if (isProjectScopeCurrent(originProjectId, originScopeToken)) {
        setErrorMessage(`Could not create Project: ${String(error)}`);
      }
    } finally {
      setIsCreatingProject(false);
    }
  }

  function handleSelectProject(projectId: string) {
    const found = projects.find((p) => p.projectId === projectId);
    if (!found) return false;
    if (!confirmProjectBoundaryChange(found.projectId, "switch")) {
      return false;
    }
    activateProject(found.projectId, found.title);
    return true;
  }

  function handleOpenProject(projectId: string) {
    if (!handleSelectProject(projectId)) {
      return;
    }
    setActivePage("note");
    setLastWorkspacePage("note");
  }

  function startRenameProject(projectId: string, currentTitle: string) {
    setRenamingProjectId(projectId);
    setRenamingProjectTitle(currentTitle);
  }

  function cancelRenameProject() {
    setRenamingProjectId(null);
    setRenamingProjectTitle("");
  }

  async function commitRenameProject(projectId: string) {
    const nextTitle = renamingProjectTitle.trim();
    if (!nextTitle) {
      setErrorMessage("Project title cannot be empty.");
      cancelRenameProject();
      return;
    }
    if (!hasTauriRuntime()) {
      // Browser preview: update local state only.
      setProjects((current) =>
        current.map((p) =>
          p.projectId === projectId
            ? { ...p, title: nextTitle, updatedAtUnixMs: Date.now() }
            : p
        )
      );
      if (activeProjectIdRef.current === projectId) {
        setActiveProjectTitle(nextTitle);
      }
      cancelRenameProject();
      return;
    }
    try {
      const updated = JSON.parse(
        await invoke<string>("rename_project", {
          vaultRoot,
          projectId,
          title: nextTitle
        })
      ) as ProjectManifest;
      setProjects((current) =>
        current.map((p) => (p.projectId === projectId ? updated : p))
      );
      if (activeProjectIdRef.current === projectId) {
        setActiveProjectTitle(updated.title);
      }
      cancelRenameProject();
      setStatusMessage(`Renamed Project to "${updated.title}".`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function updateActiveNote(next: Partial<LearningNote>) {
    if (("title" in next || "body" in next) && activeNote.id) {
      markNoteDirty(activeNote.id);
    }

    setNotes((current) =>
      current.map((note) =>
        note.id === activeNote.id
          ? {
              ...note,
              ...next,
              updatedAt: Date.now()
            }
          : note
      )
    );
  }

  async function handleSaveNote() {
    setErrorMessage(null);
    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    const operationNoteId = activeNote.id;
    const title = activeNote.title.trim();
    // Preserve the note body verbatim. Markdown semantics (leading
    // blank lines, trailing whitespace) must round-trip through save.
    const bodyMarkdown = activeNote.body;

    if (!title || !bodyMarkdown.trim()) {
      setErrorMessage("Note needs a title and body before saving.");
      return;
    }
    if (!operationProjectId) {
      setErrorMessage("Open or create a Project before saving notes.");
      return;
    }
    if (!operationNoteId || activeProjectNoteId !== operationNoteId) {
      setErrorMessage(
        "The selected Note and editor buffer do not match. Re-select the Note before saving."
      );
      return;
    }

    const projectNoteToSave = projectNotes.find(
      (note) => note.noteId === operationNoteId
    );
    if (
      !projectNoteToSave ||
      projectNoteToSave.projectId !== operationProjectId
    ) {
      setErrorMessage(
        "The editor Note does not belong to the active Project. Save was blocked."
      );
      return;
    }

    const operationRevision = noteRevisionByIdRef.current.get(operationNoteId) ?? 0;
    if (!acquireNoteWrite(operationNoteId)) {
      return;
    }
    let newerChangesRemain = false;

    try {
      if (hasTauriRuntime()) {
        const payload = await invoke<string>("save_project_note", {
          vaultRoot,
          projectId: operationProjectId,
          noteId: operationNoteId,
          title,
          bodyMarkdown,
          tagsJson: JSON.stringify(projectNoteToSave.tags)
        });
        const saved = JSON.parse(payload) as ProjectNote;
        if (
          saved.projectId !== operationProjectId ||
          saved.noteId !== operationNoteId ||
          saved.title !== title ||
          saved.bodyMarkdown !== bodyMarkdown
        ) {
          throw new Error(
            "Save response did not match the requested Project, Note, title, and content."
          );
        }
        if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          return;
        }

        newerChangesRemain =
          (noteRevisionByIdRef.current.get(operationNoteId) ?? 0) !== operationRevision;
        if (newerChangesRemain) {
          dirtyNoteIdsRef.current.add(operationNoteId);
        } else {
          clearNoteDirty(operationNoteId);
        }
        setProjectNotes((current) => {
          const existingIndex = current.findIndex((note) => note.noteId === saved.noteId);
          if (existingIndex < 0) {
            return current;
          }
          const next = [...current];
          next[existingIndex] = saved;
          return next;
        });
      }
      if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        setStatusMessage(
          newerChangesRemain
            ? "Note saved, but newer changes remain unsaved."
            : "Note saved to the workspace boundary."
        );
      }
    } catch (error) {
      if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      releaseNoteWrite(operationNoteId);
    }
  }

  async function handleSourceUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    if (fileList.length > maxUploadFiles) {
      setErrorMessage(`Upload at most ${maxUploadFiles} sources per batch.`);
      return;
    }
    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    if (!operationProjectId) {
      setErrorMessage("Open or create a Project before uploading sources.");
      return;
    }

    setErrorMessage(null);
    try {
      const uploads = await readSourceFiles(fileList);
      if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        return;
      }

      if (hasTauriRuntime()) {
        // Slice 3 — write each upload through the project-scoped Source
        // Version layer. Each upload mints an immutable SourceVersion
        // tied to the active Project.
        const newVersions: typeof projectSourceVersions = [];
        const newLocators: Record<string, EvidenceLocatorResponse> = {};
        for (const upload of uploads) {
          const request = {
            projectId: operationProjectId,
            sourceId: null,
            sourceName: upload.sourceName,
            content: upload.content
          };
          try {
            const payload = await invoke<string>("ingest_project_source", {
              vaultRoot,
              requestJson: JSON.stringify(request)
            });
            if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
              return;
            }
            const parsed = JSON.parse(payload) as (typeof projectSourceVersions)[number];
            if (parsed.projectId !== operationProjectId) {
              throw new Error("Source response did not match the requested Project.");
            }
            newVersions.push(parsed);
            try {
              const locatorPayload = await invoke<string>("build_evidence_locator_cmd", {
                vaultRoot,
                projectId: operationProjectId,
                requestJson: JSON.stringify({
                  versionId: parsed.versionId,
                  content: upload.content,
                  startLine: 1,
                  endLine: 3
                })
              });
              if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
                return;
              }
              newLocators[parsed.versionId] = JSON.parse(locatorPayload) as EvidenceLocatorResponse;
            } catch {
              // The immutable Source Version still succeeded; preview can remain unavailable.
            }
          } catch (error) {
            if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
              return;
            }
            // Surface the first error but keep going so the user sees
            // what was rejected and what succeeded.
            setErrorMessage(
              `Could not ingest ${upload.sourceName}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
        if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          return;
        }
        if (newVersions.length > 0) {
          setProjectSourceVersions((current) => [...current, ...newVersions]);
          setSelectedSourceVersionId(newVersions[0].versionId);
        }
        if (Object.keys(newLocators).length > 0) {
          setEvidenceLocatorsByVersionId((current) => ({ ...current, ...newLocators }));
        }

        // The legacy global source library still drives FTS + drafts
        // today; keep that pathway in place for the rest of this slice.
        const libraryPayload = await invoke<string>("ingest_sources", {
          vaultRoot,
          sourcesJson: JSON.stringify(uploads)
        });
        if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          return;
        }
        const library = parseSourceLibrary(libraryPayload).sources;
        setSourceLibrary((current) => mergeSourceLibrary(current, library));
      } else {
        setBrowserSources((current) => mergeBrowserSources(current, uploads));
        const library = indexBrowserSources(uploads);
        setSourceLibrary((current) => mergeSourceLibrary(current, library));
      }

      updateActiveNote({ sourceCount: sourceCount + uploads.length });
      setStatusMessage(`Indexed ${uploads.length} source file${uploads.length === 1 ? "" : "s"}.`);
    } catch (error) {
      if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handleGenerateGraph() {
    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    if (!operationProjectId) {
      setErrorMessage("Open or create a Project before generating nodes.");
      return;
    }

    // Trim only for the emptiness check; the prompt sent to the LLM
    // must keep its original whitespace so Markdown structure (heading
    // breaks, fenced blocks) survives.
    if (!activeNote.body.trim()) {
      setErrorMessage("Write a note before generating nodes.");
      return;
    }
    const content = activeNote.body;

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      let draft: KnowledgeDraftResponse | RagAnalysisResponse;

      // If LLM is configured, use it via Rust backend
      if (hasTauriRuntime() && isLlmConfigured) {
        const llmConfig = {
          provider: llmProvider,
          model: llmModel,
          apiKey: sessionApiKey,
          baseUrl: llmBaseUrl
        };

        // Build source context from chunks if available
        const sourceContext = retrievedChunks.length > 0
          ? retrievedChunks.map((c) =>
              `[${c.sourceName}:${c.startLine}-${c.endLine}] ${c.text}`
            ).join("\n\n")
          : "";

        const payload = await invoke<string>("generate_knowledge_draft_with_llm", {
          configJson: JSON.stringify(llmConfig),
          prompt: content,
          sourceContext
        });
        draft = JSON.parse(payload) as KnowledgeDraftResponse;
      } else if (sourceLibrary.length > 0) {
        draft = await analyzeSourceLibrary({
          browserSources,
          query: content,
          vaultRoot
        });
      } else if (hasTauriRuntime()) {
        draft = await generateDraftViaTauri(`${slugify(activeNote.title)}.md`, content);
      } else {
        draft = generateBrowserPreviewDraft(content, `${slugify(activeNote.title)}.md`);
      }

      if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        return;
      }

      const nextSuggestions = buildRelationSuggestions(draft.nodes, draft.edges);
      if (hasTauriRuntime()) {
        await invoke<string>("save_ai_suggestions", {
          vaultRoot,
          suggestionsJson: JSON.stringify(
            nextSuggestions.map((suggestion) => ({
              suggestionId: suggestion.suggestionId,
              fromNodeId: suggestion.fromNodeId,
              toNodeId: suggestion.toNodeId,
              relationKind: suggestion.relationKind,
              rationale: suggestion.rationale,
              confidence: suggestion.confidence
            }))
          )
        });
      }
      if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        return;
      }

      if (isRagAnalysisResponse(draft)) {
        setRetrievedChunks(draft.chunks);
        setSourceLibrary(draft.sources);
      }
      setDraftNodes(draft.nodes);
      setDraftEdges(draft.edges);
      setSuggestions(nextSuggestions);
      setSelectedNodeId(null);
      setLastWorkspacePage("graph");
      setActivePage("graph");
      setStatusMessage("Nodes generated. Review the smart graph and pending links.");
    } catch (error) {
      if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        setIsProcessing(false);
      }
    }
  }

  async function handleSuggestionDecision(suggestionId: string, status: Exclude<SuggestionStatus, "pending">) {
    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    if (!operationProjectId) {
      return;
    }

    setSuggestions((current) =>
      current.map((suggestion) =>
        suggestion.suggestionId === suggestionId
          ? {
              ...suggestion,
              status
            }
          : suggestion
      )
    );

    if (hasTauriRuntime()) {
      try {
        await invoke<string>("record_suggestion_decision", {
          vaultRoot,
          suggestionId,
          status
        });
      } catch (error) {
        if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }
  }

  async function createNote() {
    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    if (!operationProjectId) {
      setActivePage("projects");
      setStatusMessage("Open a Project before adding a Note.");
      return;
    }

    setErrorMessage(null);
    if (hasTauriRuntime()) {
      try {
        const payload = await invoke<string>("create_project_note", {
          vaultRoot,
          projectId: operationProjectId,
          title: "Untitled note"
        });
        const created = JSON.parse(payload) as ProjectNote;
        if (created.projectId !== operationProjectId) {
          throw new Error("Created Note response did not match the requested Project.");
        }
        if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          return;
        }
        setProjectNotes((current) => [created, ...current]);
        setNotes((current) => [
          mapProjectNoteToLearningNote(created),
          ...current.filter((note) => note.id !== created.noteId)
        ]);
        setActiveProjectNoteId(created.noteId);
        setActiveNoteId(created.noteId);
        setActivePage("note");
        setLastWorkspacePage("note");
        setStatusMessage("Created a new Note in the active Project.");
        return;
      } catch (error) {
        if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          setErrorMessage(`Could not create Note: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
    }

    const id = `note_${Date.now()}`;
    const now = Date.now();
    const nextNote: LearningNote = {
      id,
      title: "Untitled note",
      body: "",
      createdAt: now,
      updatedAt: now,
      sourceCount: 0
    };
    setNotes((current) => [nextNote, ...current]);
    setActiveNoteId(id);
    setActivePage("note");
    setLastWorkspacePage("note");
  }

  function handleBodyChange(value: string) {
    updateActiveNote({ body: value });
    const line = value.slice(value.lastIndexOf("\n") + 1);
    setSlashOpen(line.trim() === "/");
  }

  function insertSlashCommand(command: SlashCommand) {
    const body = activeNote.body;
    const slashIndex = body.lastIndexOf("/");
    const nextBody =
      slashIndex >= 0 ? `${body.slice(0, slashIndex)}${command.insert}${body.slice(slashIndex + 1)}` : `${body}\n${command.insert}`;
    updateActiveNote({ body: nextBody });
    setSlashOpen(false);
  }

  async function deleteNote(noteId: string) {
    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    const projectNote = projectNotes.find((note) => note.noteId === noteId);
    if (
      !operationProjectId ||
      (projectNote && projectNote.projectId !== operationProjectId)
    ) {
      return;
    }
    if (projectNote && projectNotes.length <= 1) {
      setErrorMessage("A Project must keep at least one Note.");
      setPendingDeleteNoteId(null);
      return;
    }

    setErrorMessage(null);
    if (projectNote && hasTauriRuntime()) {
      try {
        await invoke<string>("delete_project_note", {
          vaultRoot,
          projectId: operationProjectId,
          noteId
        });
      } catch (error) {
        if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          setPendingDeleteNoteId(null);
          setErrorMessage(
            `Could not move Note to trash: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        return;
      }
    }
    if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
      return;
    }

    // Mutate the UI only after the canonical file operation succeeds.
    const remainingProjectNotes = projectNotes.filter((note) => note.noteId !== noteId);
    const remaining = notes.filter((note) => note.id !== noteId);
    const nextProjectNoteId =
      activeProjectNoteId === noteId || activeNoteId === noteId
        ? remainingProjectNotes[0]?.noteId ?? null
        : activeProjectNoteId;
    clearNoteDirty(noteId);
    setProjectNotes(remainingProjectNotes);
    setActiveProjectNoteId(nextProjectNoteId);

    if (remaining.length === 0 && remainingProjectNotes.length === 0) {
      const fallback: LearningNote = {
        id: `note_${Date.now()}`,
        title: "Untitled note",
        body: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceCount: 0
      };
      setNotes([fallback]);
      setActiveNoteId(fallback.id);
    } else {
      const nextNotes =
        remaining.length > 0
          ? remaining
          : remainingProjectNotes.map((note) => mapProjectNoteToLearningNote(note));
      setNotes(nextNotes);
      setActiveNoteId(nextProjectNoteId ?? nextNotes[0]?.id ?? "");
    }
    setReviewNoteFilter((current) => current.filter((id) => id !== noteId));
    setPendingDeleteNoteId(null);
    setStatusMessage(
      projectNote ? "Note moved to the Project trash folder." : "Unsaved note discarded."
    );
  }

  function startRename(noteId: string) {
    setRenamingNoteId(noteId);
  }

  async function commitRename(noteId: string, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setErrorMessage("Note title cannot be empty.");
      return;
    }

    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    const projectNote = projectNotes.find((note) => note.noteId === noteId);
    const editorNote = notes.find((note) => note.id === noteId);
    if (
      !operationProjectId ||
      !projectNote ||
      projectNote.projectId !== operationProjectId
    ) {
      setErrorMessage("The Note does not belong to the active Project.");
      return;
    }
    const bodyMarkdown = editorNote?.body ?? projectNote.bodyMarkdown;

    setErrorMessage(null);
    try {
      let canonical: ProjectNote;
      if (hasTauriRuntime()) {
        const payload = await invoke<string>("save_project_note", {
          vaultRoot,
          projectId: operationProjectId,
          noteId,
          title: trimmed,
          bodyMarkdown,
          tagsJson: JSON.stringify(projectNote.tags)
        });
        canonical = JSON.parse(payload) as ProjectNote;
        if (
          canonical.projectId !== operationProjectId ||
          canonical.noteId !== noteId ||
          canonical.title !== trimmed ||
          canonical.bodyMarkdown !== bodyMarkdown
        ) {
          throw new Error(
            "Rename response did not match the requested Project, Note, title, and content."
          );
        }
      } else {
        const updatedAt = Date.now();
        canonical = {
          ...projectNote,
          title: trimmed,
          bodyMarkdown,
          updatedAtUnixMs: updatedAt
        };
      }

      if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        return;
      }

      clearNoteDirty(noteId);
      setProjectNotes((current) =>
        current.map((note) => (note.noteId === noteId ? canonical : note))
      );
      setRenamingNoteId(null);
      setStatusMessage("Note title and current draft saved.");
    } catch (error) {
      if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        setErrorMessage(
          `Could not rename Note: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  function openSettings(view: SettingsView) {
    if (activePage !== "settings") {
      setLastWorkspacePage(activePage);
    }
    setSettingsView(view);
    setActivePage("settings");
  }

  const graphLayoutStorageKey = `studynote.graph-layout.${activeProjectId ?? "preview"}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(graphLayoutStorageKey);
      setGraphNodeLayout(raw ? (JSON.parse(raw) as Record<string, NodePoint>) : {});
    } catch {
      setGraphNodeLayout({});
    }
  }, [graphLayoutStorageKey]);

  function handleGraphNodeMove(nodeId: string, point: NodePoint) {
    setGraphNodeLayout((prev) => {
      const next = { ...prev, [nodeId]: point };
      try {
        window.localStorage.setItem(graphLayoutStorageKey, JSON.stringify(next));
      } catch {
        // Layout persistence is best-effort; the in-memory layout still applies.
      }
      return next;
    });
  }

  function handleGraphLayoutReset() {
    setGraphNodeLayout({});
    try {
      window.localStorage.removeItem(graphLayoutStorageKey);
    } catch {
      // Best-effort cleanup.
    }
  }

  function focusGraphNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setGraphFocusRequest((prev) => ({ nodeId, token: (prev?.token ?? 0) + 1 }));
    setActivePage("graph");
    setLastWorkspacePage("graph");
  }

  function handleGraphSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const match = graphSearchMatches[0];
    if (match) {
      focusGraphNode(match.id);
    }
  }

  function handleLlmProviderChange(provider: LlmProvider) {
    setLlmProvider(provider);
    if (provider === "Ollama") {
      setLlmBaseUrl((current) => (current.trim() ? current : DEFAULT_OLLAMA_BASE_URL));
      setLlmModel(ollamaModels[0] ?? "");
    } else {
      setLlmModel(llmModels[provider][0] ?? "");
    }
  }

  async function handleFetchOllamaModels() {
    if (!hasTauriRuntime()) {
      setErrorMessage("Fetching Ollama models requires the desktop app runtime.");
      return;
    }
    setIsFetchingOllamaModels(true);
    setErrorMessage(null);
    try {
      const baseUrl = llmBaseUrl.trim() || DEFAULT_OLLAMA_BASE_URL;
      const payload = await invoke<string>("list_ollama_models", { baseUrl });
      const parsed = JSON.parse(payload) as { models: string[] };
      setOllamaModels(parsed.models);
      if (parsed.models.length === 0) {
        setStatusMessage("Ollama is reachable but has no models pulled yet. Run `ollama pull <model>` first.");
      } else {
        setLlmModel((current) => (parsed.models.includes(current) ? current : parsed.models[0]));
        setStatusMessage(`Found ${parsed.models.length} local Ollama model(s).`);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? `Could not reach Ollama: ${error.message}`
          : "Could not reach Ollama. Is it running on this machine?"
      );
    } finally {
      setIsFetchingOllamaModels(false);
    }
  }

  function handleSaveLlmConfig() {
    if (llmProvider === "Custom") {
      if (!llmBaseUrl.trim()) {
        setErrorMessage("Custom provider requires a base URL pointing to an OpenAI-compatible endpoint.");
        return;
      }
      if (!llmModel.trim()) {
        setErrorMessage("Custom provider requires a model ID (e.g. deepseek-chat).");
        return;
      }
    }
    setErrorMessage(null);
    setStatusMessage(
      llmProvider === "Ollama"
        ? "Ollama config is active for this session. No API key is required for local models."
        : llmProvider === "Custom"
          ? "Custom endpoint config is active for this session. The API key was not persisted."
          : "LLM config is active for this session only. The API key was not persisted."
    );
  }

  function handleAccountNameChange() {
    const nextName = accountName.trim();
    if (!nextName || nextName.length > 50) {
      setErrorMessage("Display name must be between 1 and 50 characters.");
      return;
    }
    setErrorMessage(null);
    setAccountName(nextName);
    setStatusMessage("Account display name updated in the current desktop session.");
  }

  function handleEmailChange() {
    const nextEmail = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }
    setErrorMessage(null);
    setAccountEmail(nextEmail);
    setNewEmail("");
    setStatusMessage("Email changed for this local preview session.");
  }

  async function handleReviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = reviewPrompt.trim();
    const operationProjectId = activeProjectIdRef.current;
    const operationScopeToken = projectScopeTokenRef.current;
    if (!prompt || isReviewSubmitting || !operationProjectId) {
      return;
    }

    setIsReviewSubmitting(true);
    // Add user message immediately
    setChatMessages((current) => [
      ...current,
      { id: `user_${Date.now()}`, role: "user", text: prompt, citations: [] }
    ]);
    setReviewPrompt("");

    // Slice 4 — persist every Review submission as an immutable
    // Review Run tied to the active Project. Citations come from
    // project-scoped source versions the user picked in the studio;
    // due_count is the number of pending relations + due nodes in the
    // current graph snapshot. The Learning Event the registry writes
    // is the input for transparent metrics.
    if (hasTauriRuntime()) {
      try {
        const dueCount =
          pendingSuggestions.length +
          Math.max(0, draftNodes.length - pendingSuggestions.length);
        const request = {
          projectId: operationProjectId,
          prompt,
          noteFilter: reviewNoteFilter,
          citedSourceVersionIds: reviewSelectedSourceVersions,
          dueCount: Number.isFinite(dueCount) ? dueCount : 0
        };
        const payload = await invoke<string>("create_project_review_run", {
          vaultRoot,
          requestJson: JSON.stringify(request)
        });
        const created = JSON.parse(payload) as ReviewRun;
        if (created.projectId !== operationProjectId) {
          throw new Error("Review Run response did not match the requested Project.");
        }
        if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          return;
        }
        setReviewRuns((current) => [...current, created]);
        // Refresh metrics so the dashboard reflects the new event.
        invoke<string>("list_learning_metrics", { vaultRoot, requestJson: null })
          .then((raw) => {
            if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
              return;
            }
            try {
              setLearningMetrics(JSON.parse(raw) as LearningMetrics);
            } catch {
              // ignore parse failures
            }
          })
          .catch(() => {
            // metrics are advisory; never block the chat UX
          });
        setStatusMessage(
          `Saved Review Run ${created.runId} under projects/${operationProjectId}/reviews/.`
        );
      } catch (error) {
        if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }
    if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
      return;
    }

    // If LLM is configured, use it via Rust backend
    if (hasTauriRuntime() && isLlmConfigured) {
      const llmConfig = {
        provider: llmProvider,
        model: llmModel,
        apiKey: sessionApiKey,
        baseUrl: llmBaseUrl
      };

      const sourceContext = retrievedChunks.length > 0
        ? `Source chunks:\n${retrievedChunks.map((c) =>
            `[${c.sourceName}:${c.startLine}-${c.endLine}] ${c.text}`
          ).join("\n\n")}`
        : "No sources available.";

      try {
        const payload = await invoke<string>("answer_review_question_with_llm", {
          configJson: JSON.stringify(llmConfig),
          question: prompt,
          sourceContext
        });
        if (!isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          return;
        }
        const result = JSON.parse(payload);
        const citations = retrievedChunks.slice(0, 3).map((chunk) =>
          `${chunk.sourceName}:${chunk.startLine}-${chunk.endLine}`
        );

        setChatMessages((current) => [
          ...current,
          {
            id: `assistant_${Date.now()}`,
            role: "assistant",
            text: result.answer,
            citations
          }
        ]);
      } catch (error) {
        if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
      if (isProjectScopeCurrent(operationProjectId, operationScopeToken)) {
        setIsReviewSubmitting(false);
      }
      return;
    }

    // Fallback: deterministic answer
    const citations = retrievedChunks.slice(0, 3).map((chunk) => `${chunk.sourceName}:${chunk.startLine}-${chunk.endLine}`);
    const approved = approvedSuggestions.length;
    const answer =
      citations.length > 0
        ? `I found ${citations.length} relevant source chunk${citations.length === 1 ? "" : "s"}. ${compactText(
            retrievedChunks[0].text,
            220
          )}`
        : `The approved graph has ${approved} confirmed relation${approved === 1 ? "" : "s"}. Upload or analyze sources for stronger citations.`;

    setChatMessages((current) => [
      ...current,
      {
        id: `assistant_${Date.now()}`,
        role: "assistant",
        text: answer,
        citations
      }
    ]);
    setIsReviewSubmitting(false);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to workspace</a>
      <header className="topbar">
        <div className="brand-lockup" aria-label="Application identity">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>StudyNote</strong>
            <span>Desktop vault for Windows and macOS</span>
          </div>
        </div>

        <nav className="page-tabs" aria-label="Workspace pages">
          {workspaceTabs.map((page) => {
            // Slice 2 gate: Note/Graph/Review/Projects are the main pages.
            // Per plan.md "Locked product decisions", before a Project is
            // selected, Note / Graph / Review remain visible but disabled.
            const requiresProject =
              page.id === "note" ||
              page.id === "graph" ||
              page.id === "review" ||
              page.id === "pet";
            const disabled = requiresProject && !hasActiveProject;
            const gateHint = "Open a Project to unlock";
            return (
              <button
                aria-current={activePage === page.id ? "page" : undefined}
                aria-disabled={disabled}
                aria-label={disabled ? `${page.label}. ${gateHint}` : page.label}
                className={`${activePage === page.id ? "active" : ""}${disabled ? " gated" : ""}`}
                data-page={page.id}
                key={page.id}
                onClick={() => {
                  if (disabled) {
                    // Smart-click: route the user to Projects so they can
                    // create or select one. This keeps the gating rule
                    // from plan.md intact (other workspaces stay scoped to a
                    // Project) while removing the "dead button" UX.
                    setActivePage("projects");
                    setLastWorkspacePage("projects");
                    setStatusMessage(gateHint);
                    window.requestAnimationFrame(() => {
                      document
                        .querySelector(".projects-workspace")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                    return;
                  }
                  setActivePage(page.id);
                }}
                title={disabled ? gateHint : undefined}
                type="button"
              >
                <span aria-hidden="true">{page.shortLabel}</span>
                <strong>{page.label}</strong>
              </button>
            );
          })}
        </nav>

        <div className="topbar-actions">
          {hasActiveProject ? (
            <>
              <span className="active-project-pill" title={`Active project: ${activeProjectTitle}`}>
                <span className="active-project-dot" aria-hidden="true" />
                {activeProjectTitle}
              </span>
              <label className="source-button">
                Add sources
                <input
                  accept=".txt,.md,.markdown"
                  multiple
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void handleSourceUpload(input.files).finally(() => {
                      // Clearing the control lets the same file be selected again.
                      input.value = "";
                    });
                  }}
                  type="file"
                />
              </label>
              <button
                disabled={isProcessing}
                onClick={() => handleGenerateGraph()}
                type="button"
              >
                {isProcessing ? "Generating" : "Generate nodes"}
              </button>
            </>
          ) : (
            <span className="active-project-pill muted" title="No project selected">
              <span className="active-project-dot" aria-hidden="true" />
              No project
            </span>
          )}
          <button className="user-chip" onClick={() => openSettings("account")} type="button" aria-label="Open account settings">
            <span>{accountName.trim().charAt(0).toUpperCase() || "U"}</span>
          </button>
        </div>
      </header>

      <main className="workspace-content" id="workspace-content" tabIndex={-1}>
      {errorMessage ? <div className="message error" role="alert">{errorMessage}</div> : null}
      {statusMessage ? <div aria-live="polite" className="message status" role="status">{statusMessage}</div> : null}

      {activePage === "projects" ? (
        <section className="projects-workspace" aria-label="Project manager">
          <div className="projects-toolbar">
            <div className="project-control-row">
              <label className="project-search">
                <span>Search projects</span>
                <input
                  onChange={(event) => setProjectSearchQuery(event.target.value)}
                  placeholder="Search project title"
                  value={projectSearchQuery}
                />
              </label>
              <span className="project-count" aria-live="polite">
                {projectCards.length} project{projectCards.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <div className="projects-heading">
            <span className="eyebrow">Workspace index</span>
            <h1>My projects</h1>
            <p>Separate each subject, class, or activity before it becomes a dense note list.</p>
          </div>

          <div className="project-grid">
            {isProjectComposerOpen ? (
              <form
                className="project-card project-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateProject();
                }}
              >
                <span className="eyebrow">New Project</span>
                <label htmlFor="new-project-title">Project title</label>
                <input
                  autoFocus
                  disabled={isCreatingProject}
                  id="new-project-title"
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                  placeholder="e.g. Distributed systems"
                  value={newProjectTitle}
                />
                <div className="project-create-actions">
                  <button disabled={isCreatingProject || !newProjectTitle.trim()} type="submit">
                    {isCreatingProject ? "Creating..." : "Create project"}
                  </button>
                  <button
                    disabled={isCreatingProject}
                    onClick={() => {
                      setIsProjectComposerOpen(false);
                      setNewProjectTitle("");
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button className="project-card create" onClick={() => setIsProjectComposerOpen(true)} type="button">
                <span className="project-create-mark" aria-hidden="true">+</span>
                <strong>Create new project</strong>
                <small>Start a focused notebook for one subject or activity.</small>
              </button>
            )}
            {projectCards.map((project) => {
              const isRenaming = renamingProjectId === project.id;
              return (
                <article className={`project-card ${project.tone}`} key={project.id}>
                  <div className="project-card-actions" aria-label={`Actions for ${project.title}`}>
                    <button
                      className="project-card-action"
                      onClick={() => startRenameProject(project.id, project.title)}
                      title="Rename project"
                      type="button"
                    >
                      <span>Rename</span>
                    </button>
                    <button
                      className="project-card-action primary"
                      onClick={() => handleOpenProject(project.id)}
                      title="Open project"
                      type="button"
                    >
                      <span>Open</span>
                    </button>
                  </div>
                  {isRenaming ? (
                    <div className="project-card-rename">
                      <input
                        aria-label={`Rename ${project.title}`}
                        autoFocus
                        onChange={(event) => setRenamingProjectTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRenameProject(project.id);
                          if (event.key === "Escape") cancelRenameProject();
                        }}
                        value={renamingProjectTitle}
                      />
                      <div className="project-card-rename-actions">
                        <button onClick={() => commitRenameProject(project.id)} type="button">
                          Save
                        </button>
                        <button onClick={cancelRenameProject} type="button">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="project-card-body"
                      onClick={() => handleOpenProject(project.id)}
                      type="button"
                    >
                      <span className="project-symbol" aria-hidden="true">{project.symbol}</span>
                      <strong>{project.title}</strong>
                      <small>
                        {project.date} ·{" "}
                        {project.noteCount === null || project.sourceCount === null
                          ? "Counts load on open"
                          : project.noteCount + " note" + (project.noteCount === 1 ? "" : "s") +
                            " · " + project.sourceCount + " source" + (project.sourceCount === 1 ? "" : "s")}
                      </small>
                      <p>{project.preview}</p>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {activePage === "note" ? (
        <section className="note-workspace">
          <aside className="note-rail" aria-label="Notes and source library">
            <div className="rail-heading">
              <div>
                <span className="eyebrow">Notebook</span>
                <h2>Notes</h2>
              </div>
              <button onClick={() => void createNote()} type="button">
                + Add
              </button>
            </div>
            <label className="search-field">
              <span>Search</span>
              <input
                onChange={(event) => setNoteSearchQuery(event.target.value)}
                placeholder="Find project note or source"
                value={noteSearchQuery}
              />
            </label>
            <div className="note-list">
              {filteredProjectNotes.length > 0 ? (
                filteredProjectNotes.map((note) => (
                <div className="note-item" key={note.noteId}>
                  {renamingNoteId === note.noteId ? (
                    <div
                      className={`note-select rename-mode ${note.noteId === activeProjectNote?.noteId ? "active" : ""}`}
                    >
                      <input
                        autoFocus
                        className="rename-input"
                        defaultValue={note.title}
                        onBlur={(event) => void commitRename(note.noteId, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenamingNoteId(null);
                          }
                        }}
                        aria-label={`Rename ${note.title}`}
                      />
                      <span className="note-preview">{compactText(note.bodyMarkdown || "Empty note", 72)}</span>
                      <span className="note-date">Created {formatShortDate(note.createdAtUnixMs)}</span>
                    </div>
                  ) : (
                    <button
                      aria-current={note.noteId === activeProjectNote?.noteId ? "true" : undefined}
                      className={`note-select ${note.noteId === activeProjectNote?.noteId ? "active" : ""}`}
                      onClick={() => selectProjectNote(note.noteId)}
                      type="button"
                    >
                      <strong>{note.title}</strong>
                      <span className="note-preview">{compactText(note.bodyMarkdown || "Empty note", 72)}</span>
                      <span className="note-date">Created {formatShortDate(note.createdAtUnixMs)}</span>
                      {note.tags.length > 0 ? (
                        <span className="note-tags-row">
                          {note.tags.map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  )}
                  <div className="note-inline-actions" aria-label={`Actions for ${note.title}`}>
                    <button onClick={() => startRename(note.noteId)} type="button">
                      Rename
                    </button>
                    {pendingDeleteNoteId === note.noteId ? (
                      <>
                        <button onClick={() => setPendingDeleteNoteId(null)} type="button">
                          Cancel
                        </button>
                        <button
                          className="destructive"
                          disabled={projectNotes.length <= 1}
                          onClick={() => void deleteNote(note.noteId)}
                          type="button"
                        >
                          Move to trash
                        </button>
                      </>
                    ) : (
                      <button
                        className="destructive"
                        disabled={projectNotes.length <= 1}
                        onClick={() => setPendingDeleteNoteId(note.noteId)}
                        title={projectNotes.length <= 1 ? "A Project must keep at least one Note." : "Move Note to trash"}
                        type="button"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                ))
              ) : noteSearchQuery.trim() ? (
                <p className="empty-copy">
                  No notes match “{noteSearchQuery}” in this Project.
                </p>
              ) : (
                <p className="empty-copy">No notes in this Project yet.</p>
              )}
            </div>
            <div className="source-summary">
              <span className="eyebrow">Sources</span>
              <strong>{sourceCount} files</strong>
              <span>{indexedChunkCount} indexed chunks</span>
            </div>
            <div className="source-list">
              {sourceLibrary.length > 0 ? (
                sourceLibrary.map((source) => (
                  <div className="source-row" key={source.sourceId}>
                    <span className="file-dot" aria-hidden="true" />
                    <div>
                      <strong>{source.sourceName}</strong>
                      <span>{source.chunkCount} chunks</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-copy">Upload Markdown or text files to give AI source anchors.</p>
              )}
            </div>

            {/* Slice 3 — Project-scoped Source Versions */}
            <div className="source-summary">
              <span className="eyebrow">Project sources</span>
              <strong>{projectSourceVersions.length} versions</strong>
              <span>immutable, scoped to current Project</span>
            </div>
            <div className="source-list">
              {projectSourceVersions.length > 0 ? (
                projectSourceVersions.map((v) => (
                  <div
                    className={`source-row ${
                      v.versionId === selectedSourceVersionId ? "active" : ""
                    }`}
                    key={v.versionId}
                  >
                    <span className="file-dot" aria-hidden="true" />
                    <div>
                      <strong>{v.sourceName}</strong>
                      <span>{v.versionKind}</span>
                      <button
                        className="ghost"
                        onClick={() => handleOpenEvidence(v.versionId, v.sourceId)}
                        type="button"
                      >
                        Open evidence
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-copy">
                  No Project sources yet. Use Add sources to create the first
                  immutable version.
                </p>
              )}
            </div>

            {evidenceDrawer && evidenceDrawer.versionId === selectedSourceVersionId ? (
              <div className="evidence-drawer" aria-label="Evidence detail drawer">
                <span className="eyebrow">Evidence detail</span>
                <strong>{evidenceDrawer.versionId}</strong>
                {evidenceDrawer.locator ? (
                  <div className="evidence-excerpt">
                    <span>
                      Lines {evidenceDrawer.locator.startLine}-{evidenceDrawer.locator.endLine} ·{" "}
                      {evidenceDrawer.locator.sourceId}
                    </span>
                    <p>{evidenceDrawer.locator.excerpt}</p>
                  </div>
                ) : (
                  <p className="empty-copy">
                    Preview is unavailable for this earlier source version. The immutable version ID remains traceable in the vault.
                  </p>
                )}
              </div>
            ) : null}
          </aside>

          <section className="editor-panel" aria-label="Note editor">
            <div className="editor-meta">
              <span className="doc-icon" aria-hidden="true" />
              <input
                aria-label="Note title"
                disabled={!activeProjectNote}
                onChange={(event) => updateActiveNote({ title: event.target.value })}
                value={activeNote.title}
              />
              <span>{new Date(activeNote.updatedAt).toLocaleString()}</span>
            </div>
            <p className="editor-hint">
              Type / on an empty line to open commands. Sources and notes stay local unless an AI provider is explicitly configured.
            </p>
            <div className="editor-shell">
              <textarea
                aria-controls={slashOpen ? "slash-command-palette" : undefined}
                aria-expanded={slashOpen}
                aria-label="Note body"
                disabled={!activeProjectNote}
                onChange={(event) => handleBodyChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && slashOpen) {
                    event.preventDefault();
                    setSlashOpen(false);
                  }
                }}
                placeholder="Write what you learned..."
                value={activeNote.body}
              />
              {slashOpen ? (
                <div className="slash-menu" id="slash-command-palette">
                  <span>Basic blocks</span>
                  {slashCommands.map((command) => (
                    <button key={command.id} onClick={() => insertSlashCommand(command)} type="button">
                      <strong>{command.label}</strong>
                      <small>{command.description}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="editor-actions">
              <button disabled={!activeProjectNote} onClick={handleSaveNote} type="button">
                Save note
              </button>
              <button disabled={!activeProjectNote || !activeNote.body.trim()} onClick={handleGenerateGraph} type="button">
                Generate nodes
              </button>
            </div>
          </section>

        </section>
      ) : null}

      {activePage === "graph" ? (
        <section className="graph-workspace">
          <div className="graph-header">
            <div>
              <span className="eyebrow">Dependency map</span>
              <h1>Roadmap graph</h1>
              <p className="graph-scope-meta">
                {hasActiveProject
                  ? `Scoped to Project “${activeProjectTitle || "current"}” · ${projectSourceVersions.length} source versions`
                  : "Select a Project to scope this roadmap to its sources and runs."}
              </p>
            </div>
            <div className="graph-tools">
              <form className="graph-search" onSubmit={handleGraphSearchSubmit}>
                <input
                  aria-label="Search graph nodes"
                  onChange={(event) => setGraphSearchQuery(event.target.value)}
                  placeholder="Search node keyword"
                  value={graphSearchQuery}
                />
                <button disabled={!graphSearchQuery.trim() || graphSearchMatches.length === 0} type="submit">
                  Focus
                </button>
              </form>
              <div className="graph-stats">
                <span>{roadmapNodes.length} nodes</span>
                <span>{pendingSuggestions.length} pending</span>
                <span>{approvedSuggestions.length} approved</span>
              </div>
            </div>
          </div>
          {graphSearchQuery.trim() ? (
            <div className="graph-search-results" aria-label="Graph search results">
              {graphSearchMatches.length > 0 ? (
                graphSearchMatches.slice(0, 5).map((node) => (
                  <button key={node.id} onClick={() => focusGraphNode(node.id)} type="button">
                    <span>{node.meta}</span>
                    {node.title}
                  </button>
                ))
              ) : (
                <span>No node match</span>
              )}
            </div>
          ) : null}
          <div className="roadmap-shell">
            <RoadmapGraphCanvas
              edges={roadmapEdges}
              focusRequest={graphFocusRequest}
              hasProjectGraphData={hasProjectGraphData}
              layout={graphNodeLayout}
              nodes={roadmapNodes}
              onLayoutReset={handleGraphLayoutReset}
              onNodeMove={handleGraphNodeMove}
              onSelectNode={setSelectedNodeId}
              selectedNodeId={selectedNode?.id ?? null}
            />
            {selectedNode ? (
              <aside className="node-sidebar active" aria-label="Node detail and approvals">
              <div className="panel-card">
                <div className="sidebar-title-row">
                  <span className="eyebrow">Selected node</span>
                  <button onClick={() => setSelectedNodeId(null)} type="button" aria-label="Close node sidebar">
                    ×
                  </button>
                </div>
                <h2>{selectedNode.title}</h2>
                <h3>Overview</h3>
                <p>{selectedNode.summary}</p>
                <dl>
                  <div>
                    <dt>Layer</dt>
                    <dd>{selectedNode.meta}</dd>
                  </div>
                  <div>
                    <dt>Depth</dt>
                    <dd>{selectedNode.depth}</dd>
                  </div>
                </dl>
              </div>
              <div className="panel-card source-trace-card">
                <span className="eyebrow">Source trace</span>
                <h2>Evidence behind this node</h2>
                <div className="source-trace-list">
                  {selectedNodeSources.map((source) => (
                    <article key={source.id}>
                      <strong>{source.label}</strong>
                      <span>{source.detail}</span>
                      <p>{source.excerpt}</p>
                    </article>
                  ))}
                </div>
              </div>
              <div className="panel-card">
                <span className="eyebrow">Recommended connect</span>
                <h2>Related knowledge</h2>
                {selectedNodeSuggestions.length > 0 ? (
                  <div className="suggestion-list">
                    {selectedNodeSuggestions.map((suggestion) => (
                      <article className="suggestion-card" key={suggestion.suggestionId}>
                        <strong>
                          {suggestion.fromTitle} {"->"} {suggestion.toTitle}
                        </strong>
                        <p>{suggestion.rationale}</p>
                        <span>{suggestion.confidence}% confidence</span>
                        <div>
                          <button onClick={() => handleSuggestionDecision(suggestion.suggestionId, "approved")} type="button">
                            Approve
                          </button>
                          <button onClick={() => handleSuggestionDecision(suggestion.suggestionId, "rejected")} type="button">
                            Reject
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty-copy">No pending relations. Generate from a note or upload sources.</p>
                )}
              </div>
            </aside>
            ) : hasProjectGraphData ? (
              <aside className="graph-empty-panel graph-selection-panel" aria-label="Graph selection guidance">
                <div className="graph-empty-headline">
                  <span className="eyebrow">Roadmap graph</span>
                  <h2>Select a node to inspect it</h2>
                  <p>
                    This Project already has graph data. Choose a node to review its source trace and pending relations.
                  </p>
                  <p className="graph-hint">
                    Drag nodes to arrange them. Drag the canvas to pan, scroll to zoom.
                  </p>
                </div>
              </aside>
            ) : (
              <aside className="graph-empty-panel" aria-label="Graph onboarding">
                <div className="graph-empty-headline">
                  <span className="eyebrow">Roadmap graph</span>
                  <h2>Populate this Project graph</h2>
                  <p>
                    {hasActiveProject
                      ? `Project "${activeProjectTitle || "current"}" is empty so far. Pick a starting action and your graph fills in as you go.`
                      : "Pick a starting action to begin building the roadmap."}
                  </p>
                </div>
                <ol className="next-steps-list">
                  <li className="next-step">
                    <div className="next-step-meta">
                      <span className="next-step-index">01</span>
                      <div>
                        <strong>Upload sources</strong>
                        <span>Markdown or text files become immutable Project versions.</span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setActivePage("note");
                        setLastWorkspacePage("graph");
                      }}
                      type="button"
                    >
                      Open note workspace
                    </button>
                  </li>
                  <li className="next-step">
                    <div className="next-step-meta">
                      <span className="next-step-index">02</span>
                      <div>
                        <strong>Generate nodes</strong>
                        <span>Run on a saved note to draft candidate knowledge nodes.</span>
                      </div>
                    </div>
                    <button
                      disabled={!activeNote?.body?.trim()}
                      onClick={() => handleGenerateGraph()}
                      type="button"
                    >
                      Generate from current note
                    </button>
                  </li>
                  <li className="next-step">
                    <div className="next-step-meta">
                      <span className="next-step-index">03</span>
                      <div>
                        <strong>Approve relations</strong>
                        <span>Pending links appear here once nodes are generated.</span>
                      </div>
                    </div>
                    <span className="next-step-status">Waiting for nodes</span>
                  </li>
                </ol>
              </aside>
            )}
          </div>
        </section>
      ) : null}

      {activePage === "review" ? (
        <section
          className={[
            "review-workspace",
            isSourceRailCollapsed ? "rail-collapsed" : "",
            isStudioPanelCollapsed ? "studio-collapsed" : ""
          ].filter(Boolean).join(" ")}
        >
          <aside
            aria-label="Project sources for citations"
            className={`source-rail${isSourceRailCollapsed ? " collapsed" : ""}`}
          >
            {isSourceRailCollapsed ? (
              <button
                aria-expanded={false}
                aria-label="Show sources panel"
                className="rail-toggle"
                onClick={() => setIsSourceRailCollapsed(false)}
                title="Show sources panel"
                type="button"
              >
                <span aria-hidden="true">»</span>
                <span className="rail-toggle-label">
                  Sources{projectSourceVersions.length > 0 ? ` (${projectSourceVersions.length})` : ""}
                </span>
              </button>
            ) : (
              <>
                <div className="source-rail-heading">
                  <span className="eyebrow">Sources</span>
                  <button
                    aria-expanded={true}
                    aria-label="Hide sources panel"
                    className="panel-collapse"
                    onClick={() => setIsSourceRailCollapsed(true)}
                    title="Hide sources panel"
                    type="button"
                  >
                    <span aria-hidden="true">«</span>
                  </button>
                </div>
                {projectSourceVersions.length === 0 ? (
                  <p className="empty-copy">No sources in this Project yet.</p>
                ) : (
                  <>
                    <p className="source-rail-hint">
                      Pick which source versions the next answer should cite.
                    </p>
                    <ul className="source-rail-list">
                      {projectSourceVersions.slice(0, 12).map((version) => {
                        const isCited = reviewSelectedSourceVersions.includes(version.versionId);
                        return (
                          <li key={version.versionId}>
                            <button
                              aria-pressed={isCited}
                              className={isCited ? "active" : ""}
                              onClick={() =>
                                setReviewSelectedSourceVersions((current) =>
                                  current.includes(version.versionId)
                                    ? current.filter((id) => id !== version.versionId)
                                    : [...current, version.versionId]
                                )
                              }
                              title={`${version.sourceName} · ${version.versionKind}`}
                              type="button"
                            >
                              <strong>{stripExtension(version.sourceName)}</strong>
                              <span>
                                {version.versionKind} · {new Date(version.createdAtUnixMs).toLocaleDateString()}
                                {isCited ? " · cited" : ""}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {projectSourceVersions.length > 12 ? (
                      <p className="source-rail-more">
                        +{projectSourceVersions.length - 12} more versions not shown yet.
                      </p>
                    ) : null}
                  </>
                )}
              </>
            )}
          </aside>
          <section className="chat-panel" aria-label="Review prompt">
            <div className="chat-heading">
              <div>
                <span className="eyebrow">Review</span>
                <h1>{activeProjectNote?.title ?? activeNote.title}</h1>
                <p>
                  {hasActiveProject
                    ? `Project “${activeProjectTitle || "current"}” · ${projectSourceVersions.length} source versions · ${approvedSuggestions.length} approved relations`
                    : "Select a Project to persist Review Runs."}
                </p>
              </div>
              <div className="review-note-filter" aria-label="Note filter">
                <span>Note filter:</span>
                {projectNotes.length === 0 ? (
                  <span className="empty-copy">No project notes yet.</span>
                ) : (
                  projectNotes.map((note) => (
                    <button
                      aria-pressed={reviewNoteFilter.includes(note.noteId)}
                      className={reviewNoteFilter.includes(note.noteId) ? "active" : ""}
                      key={note.noteId}
                      onClick={() =>
                        setReviewNoteFilter((current) =>
                          current.includes(note.noteId)
                            ? current.filter((id) => id !== note.noteId)
                            : [...current, note.noteId]
                        )
                      }
                      type="button"
                    >
                      {note.title}
                    </button>
                  ))
                )}
              </div>
            </div>
            <div aria-live="polite" className="chat-log" role="log">
              {chatMessages.map((message) => (
                <article className={`chat-message ${message.role}`} key={message.id}>
                  <p>{message.text}</p>
                  {message.citations.length > 0 ? (
                    <div className="citation-row">
                      {message.citations.map((citation) => (
                        <span key={citation}>{citation}</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <form className="review-composer" onSubmit={handleReviewSubmit}>
              <label className="sr-only" htmlFor="review-prompt">Review question</label>
              <input
                aria-describedby="review-composer-meta"
                disabled={isReviewSubmitting}
                id="review-prompt"
                onChange={(event) => setReviewPrompt(event.target.value)}
                placeholder="Ask the vault..."
                value={reviewPrompt}
              />
              <span id="review-composer-meta">
                {reviewNoteFilter.length > 0 ? `${reviewNoteFilter.length} notes` : "All notes"}
                {" · "}
                {reviewSelectedSourceVersions.length > 0
                  ? `${reviewSelectedSourceVersions.length} citations`
                  : "No citations"}
              </span>
              <button type="submit" disabled={!hasActiveProject || !reviewPrompt.trim() || isReviewSubmitting}>
                {isReviewSubmitting ? "Sending..." : "Send"}
              </button>
            </form>
          </section>
          <aside
            aria-label="Study studio and metrics"
            className={`studio-panel${isStudioPanelCollapsed ? " collapsed" : ""}`}
          >
            {isStudioPanelCollapsed ? (
              <button
                aria-expanded={false}
                aria-label="Show studio panel"
                className="rail-toggle"
                onClick={() => setIsStudioPanelCollapsed(false)}
                title="Show studio panel"
                type="button"
              >
                <span aria-hidden="true">«</span>
                <span className="rail-toggle-label">Studio</span>
              </button>
            ) : (
            <>
            <div className="studio-heading">
              <span className="eyebrow">Studio</span>
              <button
                aria-expanded={true}
                aria-label="Hide studio panel"
                className="panel-collapse"
                onClick={() => setIsStudioPanelCollapsed(true)}
                title="Hide studio panel"
                type="button"
              >
                <span aria-hidden="true">»</span>
              </button>
            </div>
            <div className="studio-grid">
              {studioActions.map(([title, description]) => (
                <button disabled key={title} title={`${title} is planned after MVP`} type="button">
                  <strong>{title}</strong>
                  <span>{description}</span>
                  <small>Planned</small>
                </button>
              ))}
            </div>
            <div className="review-runs-card" aria-label="Recent Review Runs">
              <span className="eyebrow">Recent Review Runs</span>
              {reviewRuns.length === 0 ? (
                <p className="empty-copy">
                  {hasActiveProject
                    ? "No Review Runs yet. Send a prompt to create the first immutable run."
                    : "Open a Project before Review Runs can persist."}
                </p>
              ) : (
                <ul>
                  {reviewRuns.slice(-5).reverse().map((run) => (
                    <li key={run.runId}>
                      <strong>{run.runId}</strong>
                      <span>
                        {run.dueCount} due · {run.citedSourceVersionIds.length} citations
                      </span>
                      <small>{new Date(run.createdAtUnixMs).toLocaleString()}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {learningMetrics ? (
              <div className="metrics-card" aria-label="Learning metrics">
                <span className="eyebrow">Learning metrics</span>
                <div className="metrics-headline">
                  <div>
                    <strong>{learningMetrics.totalRuns}</strong>
                    <span>runs total</span>
                  </div>
                  <div>
                    <strong>{learningMetrics.totalCitedSourceVersions}</strong>
                    <span>source citations</span>
                  </div>
                  <div>
                    <strong>{learningMetrics.projects.length}</strong>
                    <span>projects</span>
                  </div>
                </div>
                {activeProjectMetric ? (
                  <div className="metrics-project">
                    <strong>Active project</strong>
                    <span>{activeProjectMetric.runCount} runs · {activeProjectMetric.dueCountTotal} due total · max {activeProjectMetric.dueCountMax}</span>
                    <span>{activeProjectMetric.citedSourceVersionTotal} citations · {activeProjectMetric.recentRunCount} recent</span>
                    <small>
                      {activeProjectMetric.isActiveLearner
                        ? "Active learner threshold met."
                        : `Need ${learningMetrics.thresholds.activeLearnerMinRuns} runs to mark as active learner.`}
                    </small>
                  </div>
                ) : null}
                <details>
                  <summary>Thresholds</summary>
                  <ul>
                    <li>
                      <strong>activeLearnerMinRuns:</strong>{" "}
                      {learningMetrics.thresholds.activeLearnerMinRuns}
                    </li>
                    <li>
                      <strong>consistencyWindowMs:</strong>{" "}
                      {learningMetrics.thresholds.consistencyWindowMs}
                    </li>
                  </ul>
                </details>
              </div>
            ) : null}
            </>
            )}
          </aside>
        </section>
      ) : null}

      {activePage === "pet" ? (
        <section className="pet-workspace">
          <header className="pet-header">
            <div>
              <h1>Companion</h1>
              <p>
                Your vault-level study companion. Read-only insights that never mutate canonical data.
              </p>
            </div>
          </header>

          {!hasActiveProject ? (
            <div className="empty-copy">
              Open a Project to see personalized action cards.
            </div>
          ) : petError !== null && petCompanion === null ? (
            <div className="empty-copy">
              Could not analyze this vault: {petError}
            </div>
          ) : petCompanion === null ? (
            <div className="empty-copy">Analyzing your vault...</div>
          ) : petCompanion.cards.length === 0 ? (
            <div className="empty-copy">
              No recommendations right now. Try adding notes, sources, or
              completing a review session to unlock insights.
            </div>
          ) : (
            <div className="pet-cards-container">
              {(["knowledge", "study", "projects"] as const).map((category) => {
                const categoryCards = petCompanion.cards.filter(
                  (card) => card.category === category
                );
                if (categoryCards.length === 0) return null;
                const count = petCompanion.categoryCounts[category] ?? 0;
                const label = category === "knowledge"
                  ? "Knowledge"
                  : category === "study"
                    ? "Study"
                    : "Projects";
                return (
                  <div key={category} className="pet-category-section">
                    <h2 className="pet-category-heading">
                      {label}
                      <span className="pet-category-count">{count}</span>
                    </h2>
                    <div className="pet-cards-grid">
                      {categoryCards.map((card) => {
                        const priorityClass =
                          card.priority === "high"
                            ? "priority-high"
                            : card.priority === "medium"
                              ? "priority-medium"
                              : "priority-low";
                        return (
                          <div
                            key={card.id}
                            className={`pet-action-card ${priorityClass}`}
                          >
                            <div className="pet-card-priority">{card.priority}</div>
                            <h3 className="pet-card-title">{card.title}</h3>
                            <p className="pet-card-body">{card.body}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {activePage === "settings" ? (
        <section className="settings-workspace" aria-label="Settings">
          <aside className="settings-sidebar">
            <div>
              <span className="eyebrow">Settings</span>
              <h2>Workspace</h2>
            </div>
            <nav aria-label="Settings sections">
              <span className="settings-group-label">User settings</span>
              <button
                className={settingsView === "account" ? "active" : ""}
                onClick={() => setSettingsView("account")}
                type="button"
              >
                <span aria-hidden="true">U</span>
                Account
              </button>
              <button
                className={settingsView === "llm" ? "active" : ""}
                onClick={() => setSettingsView("llm")}
                type="button"
              >
                <span aria-hidden="true">K</span>
                LLM Configuration
              </button>
              <span className="settings-group-label">Project settings</span>
              <button disabled type="button">
                <span aria-hidden="true">V</span>
                Vault permissions
              </button>
              <button disabled type="button">
                <span aria-hidden="true">G</span>
                Graph rules
              </button>
            </nav>
          </aside>

          <section className="settings-content">
            <button className="back-link" onClick={() => setActivePage(lastWorkspacePage)} type="button">
              <span aria-hidden="true">‹</span>
              Back to workspace
            </button>

            {settingsView === "llm" ? (
              <>
                <div className="settings-page-heading">
                  <h1>Personal LLM configuration (BYOK)</h1>
                  <p>
                    Manage the provider, model, and session key used to generate nodes and relation suggestions. Retrieval still starts
                    from local sources.
                  </p>
                </div>
                <div className="settings-callout">
                  <span aria-hidden="true">?</span>
                  <div>
                    <strong>Provider-agnostic by design</strong>
                    <p>
                      Use OpenAI, Anthropic, Gemini, OpenRouter, Azure, Ollama, a local endpoint, or any OpenAI-compatible
                      provider via Custom. Keys are never written to the vault.
                    </p>
                  </div>
                </div>
                <div className="provider-tabs" role="group" aria-label="LLM providers">
                  {llmProviders.map((provider) => (
                    <button
                      aria-pressed={llmProvider === provider}
                      className={llmProvider === provider ? "active" : ""}
                      key={provider}
                      onClick={() => handleLlmProviderChange(provider)}
                      type="button"
                    >
                      {provider}
                    </button>
                  ))}
                </div>
                <div className="settings-card">
                  <label>
                    API Key{llmProvider === "Ollama" || llmProvider === "Custom" ? " (optional)" : ""}
                    <input
                      aria-describedby="api-key-help"
                      autoComplete="new-password"
                      onChange={(event) => setSessionApiKey(event.target.value)}
                      placeholder={
                        llmProvider === "Ollama"
                          ? "Not required for local Ollama"
                          : llmProvider === "Custom"
                            ? "Sent as Bearer token when provided"
                            : "Stored only in memory"
                      }
                      spellCheck={false}
                      type="password"
                      value={sessionApiKey}
                    />
                  </label>
                  <label>
                    Model
                    {llmProvider === "Ollama" ? (
                      <div className="ollama-model-row">
                        <input
                          list="ollama-model-options"
                          onChange={(event) => setLlmModel(event.target.value)}
                          placeholder={ollamaModels.length ? "Select a pulled model" : "e.g. llama3.2:3b"}
                          spellCheck={false}
                          value={llmModel}
                        />
                        <datalist id="ollama-model-options">
                          {ollamaModels.map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </datalist>
                        <button disabled={isFetchingOllamaModels} onClick={handleFetchOllamaModels} type="button">
                          {isFetchingOllamaModels ? "Fetching…" : "Fetch models"}
                        </button>
                      </div>
                    ) : llmProvider === "Custom" ? (
                      <input
                        onChange={(event) => setLlmModel(event.target.value)}
                        placeholder="e.g. deepseek-chat, grok-3, mistral-large-latest"
                        spellCheck={false}
                        value={llmModel}
                      />
                    ) : (
                      <select onChange={(event) => setLlmModel(event.target.value)} value={llmModel}>
                        {llmModels[llmProvider].map((model) => (
                          <option key={model}>{model}</option>
                        ))}
                      </select>
                    )}
                  </label>
                  <label>
                    Base URL{llmProvider === "Custom" ? " (required)" : ""}
                    <input
                      onChange={(event) => setLlmBaseUrl(event.target.value)}
                      placeholder={
                        llmProvider === "Local API" || llmProvider === "Ollama"
                          ? "http://localhost:11434/v1"
                          : llmProvider === "Custom"
                            ? "https://api.example.com/v1"
                            : "Provider default"
                      }
                      value={llmBaseUrl}
                    />
                  </label>
                  {llmProvider === "Custom" ? (
                    <p className="settings-note">
                      Works with any OpenAI-compatible chat completions endpoint — Groq, DeepSeek, Mistral, Together,
                      xAI, LM Studio, vLLM, and more. Enter the base URL up to <code>/v1</code>; the app appends{" "}
                      <code>/chat/completions</code>.
                    </p>
                  ) : null}
                  {llmProvider === "Ollama" && ollamaModels.length === 0 ? (
                    <p className="settings-note">
                      Click "Fetch models" to list the models you've already pulled with Ollama, or type a model tag
                      manually (e.g. <code>llama3.2:3b</code>).
                    </p>
                  ) : null}
                  <div className="settings-actions">
                    <button onClick={handleSaveLlmConfig} type="button">
                      Use for this session
                    </button>
                  </div>
                  <p className="settings-note" id="api-key-help">
                    {apiKeyState}. Production persistence must use OS secure storage or Tauri Stronghold, not localStorage or vault files.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="settings-page-heading">
                  <h1>Account settings</h1>
                  <p>Account information for the local desktop workspace.</p>
                </div>
                <div className="account-card">
                  <span className="settings-card-icon user" aria-hidden="true" />
                  <div>
                    <h2>Name representation</h2>
                    <p>Set the name displayed in this desktop app.</p>
                  </div>
                  <label>
                    Name
                    <input onChange={(event) => setAccountName(event.target.value)} value={accountName} />
                  </label>
                  <small>Under 50 characters</small>
                  <button onClick={handleAccountNameChange} type="button">
                    Change name
                  </button>
                </div>
                <div className="account-card">
                  <span className="settings-card-icon mail" aria-hidden="true" />
                  <div>
                    <h2>Change email address</h2>
                    <p>Use this later for login or cross-device pairing. Current MVP remains local-first.</p>
                  </div>
                  <label>
                    Current email address
                    <input readOnly value={accountEmail} />
                  </label>
                  <label>
                    New email address
                    <input onChange={(event) => setNewEmail(event.target.value)} placeholder="new@example.com" value={newEmail} />
                  </label>
                  <button onClick={handleEmailChange} type="button">
                    Change email address
                  </button>
                </div>
                <div className="account-card">
                  <span className="settings-card-icon lock" aria-hidden="true" />
                  <div>
                    <h2>Change password</h2>
                    <p>Password auth is not active in the local-first desktop MVP.</p>
                  </div>
                  <label>
                    Current password
                    <input disabled type="password" />
                  </label>
                  <label>
                    New password
                    <input disabled placeholder="8 characters or more" type="password" />
                  </label>
                  <button disabled type="button">
                    Change password
                  </button>
                </div>
                <div className="account-card compact">
                  <span className="settings-card-icon bell" aria-hidden="true" />
                  <div>
                    <h2>Consultation banner</h2>
                    <p>Show a quiet reminder when provider configuration is incomplete.</p>
                  </div>
                  <label className="toggle-row">
                    <input
                      checked={consultationBannerEnabled}
                      onChange={(event) => setConsultationBannerEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    Display the LLM configuration reminder
                  </label>
                </div>
              </>
            )}
          </section>
        </section>
      ) : null}
      </main>
    </div>
  );
}

function mapProjectNoteToLearningNote(
  note: ProjectNote,
  sourceCount = 0
): LearningNote {
  return {
    id: note.noteId,
    title: note.title,
    body: note.bodyMarkdown,
    createdAt: note.createdAtUnixMs,
    updatedAt: note.updatedAtUnixMs,
    sourceCount
  };
}

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function buildProjectCards(
  projects: ProjectManifest[],
  activeProjectId: string | null,
  activeProjectNotes: ProjectNote[],
  activeProjectSources: ProjectSourceVersion[],
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();
  return projects
    .filter((project) => {
      if (!normalizedQuery) {
        return true;
      }
      return project.title.toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => right.updatedAtUnixMs - left.updatedAtUnixMs)
    .map((project, index) => {
      const isActive = project.projectId === activeProjectId;
      const scopedNotes = isActive
        ? activeProjectNotes.filter((note) => note.projectId === project.projectId)
        : [];
      const scopedSources = isActive
        ? activeProjectSources.filter((source) => source.projectId === project.projectId)
        : [];
      const firstNote = scopedNotes[0] ?? null;

      return {
        id: project.projectId,
        title: project.title,
        preview: !isActive
          ? "Open this Project to load its current note and source counts."
          : firstNote
            ? compactText(firstNote.bodyMarkdown || "Empty Note", 110)
            : "No Notes are currently loaded for this Project.",
        date: formatShortDate(project.updatedAtUnixMs),
        noteCount: isActive ? scopedNotes.length : null,
        sourceCount: isActive ? scopedSources.length : null,
        symbol: projectSymbol(project.title),
        tone: projectTones[index % projectTones.length]
      };
    });
}

function searchRoadmapNodes(nodes: RoadmapNode[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return nodes;
  }
  return nodes.filter((node) =>
    `${node.title} ${node.meta} ${node.summary}`.toLowerCase().includes(normalizedQuery)
  );
}

function buildNodeSourceCards(
  node: RoadmapNode,
  activeNote: LearningNote,
  drafts: DraftNodeResponse[],
  chunks: RetrievedChunk[],
  sources: SourceLibraryItem[]
): NodeSourceCard[] {
  const draft = drafts.find((item) => item.id === node.id);
  if (draft) {
    const chunk = chunks.find((item) => draft.source.startsWith(`${item.sourceName}:`));
    return [
      {
        id: `draft-${draft.id}`,
        label: draft.source,
        detail: draft.relationType,
        excerpt: chunk ? compactText(chunk.text, 150) : draft.summary
      }
    ];
  }

  const source = sources.find((item) => item.sourceId === node.id);
  if (source) {
    return [
      {
        id: source.sourceId,
        label: source.sourceName,
        detail: `${source.chunkCount} indexed chunks`,
        excerpt: source.vaultRelativePath
      }
    ];
  }

  const chunk = chunks[0];
  if (chunk) {
    return [
      {
        id: chunk.chunkId,
        label: `${chunk.sourceName}:${chunk.startLine}-${chunk.endLine}`,
        detail: "Retrieved evidence",
        excerpt: compactText(chunk.text, 150)
      }
    ];
  }

  return [
    {
      id: activeNote.id,
      label: activeNote.title,
      detail: `Created ${formatShortDate(activeNote.createdAt)}`,
      excerpt: compactText(activeNote.body || "This seed node is part of the current workspace model.", 150)
    }
  ];
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

function parseKnowledgeDraft(payload: string): KnowledgeDraftResponse {
  const parsed = JSON.parse(payload) as KnowledgeDraftResponse;
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error("Draft command returned an invalid payload.");
  }
  return parsed;
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

async function readSourceFiles(fileList: FileList): Promise<SourceUploadPayload[]> {
  const files = Array.from(fileList);
  const uploads: SourceUploadPayload[] = [];

  for (const file of files) {
    if (!isSupportedUploadName(file.name)) {
      throw new Error("Only .txt, .md, and .markdown sources are supported.");
    }
    if (file.size > maxUploadBytes) {
      throw new Error(`${file.name} is larger than ${formatBytes(maxUploadBytes)}.`);
    }
    const content = await file.text();
    if (!content.trim()) {
      throw new Error(`${file.name} is empty.`);
    }
    uploads.push({
      sourceName: file.name,
      content
    });
  }

  return uploads;
}

function isSupportedUploadName(fileName: string) {
  const normalized = fileName.toLowerCase();
  return supportedUploadExtensions.some((extension) => normalized.endsWith(extension));
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
  const selected = chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk.text, terms) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
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
      title: title ? title[0].toUpperCase() + title.slice(1) : `Retrieved node ${index + 1}`,
      summary: compactText(chunk.text, 190),
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

function generateBrowserPreviewDraft(prompt: string, sourceName = promptDraftSourceName): KnowledgeDraftResponse {
  const parts = prompt
    .split(/[.!?\n;]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 4);
  const nodes = (parts.length ? parts : [prompt]).map((part, index): DraftNodeResponse => {
    const title = part.split(/\s+/).slice(0, 6).join(" ");
    const relationType: DraftRelationType =
      index === 0 ? "Source" : /risk|but|however|unless/i.test(part) ? "Contrasts" : "Supports";
    return {
      id: `browser-draft-${index + 1}`,
      title: title ? title[0].toUpperCase() + title.slice(1) : `Knowledge node ${index + 1}`,
      summary: compactText(part, 190),
      tags: buildPreviewTags(part),
      confidence: Math.max(70, 90 - index * 3),
      relationType,
      source: `${sourceName}:${index + 1}-${index + 1}`
    };
  });
  const edges = nodes.slice(1).map((node, index): GraphEdgeResponse => ({
    id: `browser-edge-${index + 1}`,
    from: nodes[index].id,
    to: node.id,
    label: node.relationType === "Contrasts" ? "contrasts" : "supports"
  }));
  return { sourceName, nodes, edges };
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

type ProjectSourceVersion = {
  schemaVersion: number;
  projectId: string;
  sourceId: string;
  versionId: string;
  sourceName: string;
  sha256: string;
  modality: string;
  sizeBytes: number;
  createdAtUnixMs: number;
  versionKind: string;
  vaultRelativePath: string;
};

function clampZoom(value: number) {
  return Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, value));
}

function roadmapBasePosition(node: RoadmapNode): NodePoint {
  return {
    x: (node.x / 100) * GRAPH_WORLD_WIDTH,
    y: (node.y / 100) * GRAPH_WORLD_HEIGHT
  };
}

function RoadmapGraphCanvas({
  edges,
  focusRequest,
  hasProjectGraphData,
  layout,
  nodes,
  onLayoutReset,
  onNodeMove,
  onSelectNode,
  selectedNodeId
}: {
  edges: RoadmapEdge[];
  focusRequest: GraphFocusRequest | null;
  hasProjectGraphData: boolean;
  layout: Record<string, NodePoint>;
  nodes: RoadmapNode[];
  onLayoutReset: () => void;
  onNodeMove: (nodeId: string, point: NodePoint) => void;
  onSelectNode: (nodeId: string) => void;
  selectedNodeId: string | null;
}) {
  const canvasRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<GraphViewTransform>({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragNode, setDragNode] = useState<{ id: string } & NodePoint | null>(null);
  const [animated, setAnimated] = useState(false);

  const viewRef = useRef(view);
  viewRef.current = view;
  const animationTimerRef = useRef<number | null>(null);
  const panSessionRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    nodeId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const basePositions = useMemo(() => {
    const map = new Map<string, NodePoint>();
    for (const node of nodes) {
      map.set(node.id, roadmapBasePosition(node));
    }
    return map;
  }, [nodes]);

  function positionOf(nodeId: string): NodePoint {
    if (dragNode && dragNode.id === nodeId) {
      return { x: dragNode.x, y: dragNode.y };
    }
    return layout[nodeId] ?? basePositions.get(nodeId) ?? { x: GRAPH_WORLD_WIDTH / 2, y: GRAPH_WORLD_HEIGHT / 2 };
  }

  function applyView(next: GraphViewTransform, animate: boolean) {
    if (animate) {
      setAnimated(true);
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
      }
      animationTimerRef.current = window.setTimeout(() => {
        setAnimated(false);
        animationTimerRef.current = null;
      }, 420);
    } else {
      setAnimated(false);
    }
    setView(next);
  }

  function fitView(animate: boolean, ignoreLayout = false) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const points = nodes.map((node) =>
      ignoreLayout ? roadmapBasePosition(node) : layout[node.id] ?? basePositions.get(node.id) ?? roadmapBasePosition(node)
    );
    if (points.length === 0 || rect.width === 0 || rect.height === 0) {
      applyView({ x: 0, y: 0, k: 1 }, animate);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const width = maxX - minX + GRAPH_FIT_PADDING * 2;
    const height = maxY - minY + GRAPH_FIT_PADDING * 2;
    const k = clampZoom(Math.min(rect.width / width, rect.height / height, 1.3));
    applyView(
      {
        k,
        x: rect.width / 2 - ((minX + maxX) / 2) * k,
        y: rect.height / 2 - ((minY + maxY) / 2) * k
      },
      animate
    );
  }

  function centerOnNode(nodeId: string, animate: boolean) {
    const canvas = canvasRef.current;
    if (!canvas || (!layout[nodeId] && !basePositions.has(nodeId))) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const point = layout[nodeId] ?? basePositions.get(nodeId)!;
    const k = Math.max(viewRef.current.k, 0.9);
    applyView({ k, x: rect.width / 2 - point.x * k, y: rect.height / 2 - point.y * k }, animate);
  }

  // Initial view: keep continuity with an existing selection, else fit all.
  useEffect(() => {
    if (selectedNodeId && (layout[selectedNodeId] || basePositions.has(selectedNodeId))) {
      centerOnNode(selectedNodeId, false);
    } else {
      fitView(false);
    }
    return () => {
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Newly generated nodes may land outside the current viewport; refit.
  const nodeCountRef = useRef(nodes.length);
  useEffect(() => {
    if (nodeCountRef.current !== nodes.length) {
      nodeCountRef.current = nodes.length;
      fitView(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  // Explicit focus (search "Focus" button) always recenters, even when the
  // selection did not change. Skip the token already handled by mount.
  const focusTokenRef = useRef(focusRequest?.token ?? 0);
  useEffect(() => {
    if (focusRequest && focusRequest.token !== focusTokenRef.current) {
      focusTokenRef.current = focusRequest.token;
      centerOnNode(focusRequest.nodeId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // Wheel zoom must be a native non-passive listener to preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const { x, y, k } = viewRef.current;
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.0034 : 0.0016));
      const nextK = clampZoom(k * factor);
      if (nextK === k) {
        return;
      }
      const worldX = (cursorX - x) / k;
      const worldY = (cursorY - y) / k;
      setAnimated(false);
      setView({ k: nextK, x: cursorX - worldX * nextK, y: cursorY - worldY * nextK });
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  function zoomBy(factor: number) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const { x, y, k } = viewRef.current;
    const nextK = clampZoom(k * factor);
    if (nextK === k) {
      return;
    }
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const worldX = (centerX - x) / k;
    const worldY = (centerY - y) / k;
    applyView({ k: nextK, x: centerX - worldX * nextK, y: centerY - worldY * nextK }, true);
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest(".roadmap-node, .graph-controls")) {
      return;
    }
    canvasRef.current?.setPointerCapture(event.pointerId);
    panSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y
    };
    setAnimated(false);
    setIsPanning(true);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const pan = panSessionRef.current;
    if (!pan || event.pointerId !== pan.pointerId) {
      return;
    }
    setView({
      k: viewRef.current.k,
      x: pan.originX + (event.clientX - pan.startX),
      y: pan.originY + (event.clientY - pan.startY)
    });
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (panSessionRef.current?.pointerId === event.pointerId) {
      panSessionRef.current = null;
      setIsPanning(false);
    }
  }

  function handleNodePointerDown(event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = positionOf(nodeId);
    dragSessionRef.current = {
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false
    };
  }

  function handleNodePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.moved && Math.hypot(dx, dy) < 4) {
      return;
    }
    session.moved = true;
    const k = viewRef.current.k;
    setDragNode({ id: session.nodeId, x: session.originX + dx / k, y: session.originY + dy / k });
  }

  function handleNodePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    dragSessionRef.current = null;
    if (session.moved) {
      suppressClickRef.current = true;
      const k = viewRef.current.k;
      onNodeMove(session.nodeId, {
        x: session.originX + (event.clientX - session.startX) / k,
        y: session.originY + (event.clientY - session.startY) / k
      });
      setDragNode(null);
    }
  }

  function handleNodeClick(nodeId: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelectNode(nodeId);
  }

  const hasCustomLayout = Object.keys(layout).length > 0;
  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);

  return (
    <section
      aria-label="Roadmap graph canvas"
      className={`roadmap-canvas ${isPanning ? "panning" : ""}`}
      data-has-project-data={String(hasProjectGraphData)}
      onPointerCancel={handleCanvasPointerUp}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      ref={canvasRef}
    >
      <div
        className={`graph-world ${animated ? "animated" : ""}`}
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})` }}
      >
        <div className="world-grid" aria-hidden="true" />
        <svg className="edge-layer" aria-hidden="true">
          {edges.map((edge, index) => {
            if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
              return null;
            }
            const from = positionOf(edge.from);
            const to = positionOf(edge.to);
            const midX = (from.x + to.x) / 2;
            return (
              <path
                className={`edge-path ${edge.status}`}
                d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
                key={edge.id}
                style={
                  {
                    "--edge-index": index
                  } as CSSProperties
                }
              />
            );
          })}
        </svg>
        {nodes.map((node, index) => {
          const point = positionOf(node.id);
          return (
            <button
              className={`roadmap-node ${node.tone} ${selectedNodeId === node.id ? "selected" : ""} ${
                dragNode?.id === node.id ? "dragging" : ""
              }`}
              key={node.id}
              onClick={() => handleNodeClick(node.id)}
              onPointerCancel={handleNodePointerUp}
              onPointerDown={(event) => handleNodePointerDown(event, node.id)}
              onPointerMove={handleNodePointerMove}
              onPointerUp={handleNodePointerUp}
              style={
                {
                  "--x": `${point.x}px`,
                  "--y": `${point.y}px`,
                  "--z": `${node.depth}px`,
                  "--node-index": index
                } as CSSProperties
              }
              type="button"
            >
              <span>{node.meta}</span>
              <strong>{node.title}</strong>
            </button>
          );
        })}
      </div>
      <div aria-label="Graph view controls" className="graph-controls" role="toolbar">
        <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)} type="button">
          -
        </button>
        <span aria-live="polite" className="graph-zoom-readout">
          {Math.round(view.k * 100)}%
        </span>
        <button aria-label="Zoom in" onClick={() => zoomBy(1.25)} type="button">
          +
        </button>
        <span className="graph-controls-divider" aria-hidden="true" />
        <button className="graph-controls-text" onClick={() => fitView(true)} type="button">
          Fit
        </button>
        {hasCustomLayout ? (
          <button
            className="graph-controls-text"
            onClick={() => {
              onLayoutReset();
              fitView(true, true);
            }}
            type="button"
          >
            Reset layout
          </button>
        ) : null}
      </div>
    </section>
  );
}

function buildRoadmapNodes(
  sources: SourceLibraryItem[],
  drafts: DraftNodeResponse[],
  projectVersions: ProjectSourceVersion[],
  activeProjectId: string | null
): RoadmapNode[] {
  // Slice 4 — when a Project is selected, prefer its immutable
  // Source Versions for the "source" layer of the graph; otherwise fall
  // back to the legacy source library for unprojected previews.
  const sourceNodes: RoadmapNode[] = activeProjectId
    ? projectVersions.slice(0, 5).map((version, index): RoadmapNode => ({
        id: `version:${version.versionId}`,
        title: stripExtension(version.sourceName),
        summary: `${version.versionKind} snapshot of ${version.sourceName} · sha ${version.sha256.slice(0, 8)}.`,
        x: 16 + (index % 2) * 12,
        y: 68 + Math.floor(index / 2) * 11,
        depth: -20 - index * 6,
        tone: "source",
        meta: version.versionKind === "Initial" ? "project-source" : "project-source-updated"
      }))
    : sources.slice(0, 5).map((source, index): RoadmapNode => ({
        id: source.sourceId,
        title: stripExtension(source.sourceName),
        summary: `${source.chunkCount} indexed chunks in ${source.vaultRelativePath}.`,
        x: 16 + (index % 2) * 12,
        y: 68 + Math.floor(index / 2) * 11,
        depth: -20 - index * 6,
        tone: "source",
        meta: "source"
      }));
  const draftNodes = drafts.slice(0, 6).map((node, index): RoadmapNode => ({
    id: node.id,
    title: node.title,
    summary: node.summary,
    x: 62 + (index % 2) * 18,
    y: 20 + Math.floor(index / 2) * 20,
    depth: 44 - index * 5,
    tone: "draft",
    meta: node.relationType
  }));
  // The onboarding illustration (Capture -> Source index -> ... -> Review
  // prompt) only makes sense before the Project has real graph data; once
  // real sources/drafts exist it just clutters the canvas with faded nodes.
  const hasRealNodes = sourceNodes.length > 0 || draftNodes.length > 0;
  return [...(hasRealNodes ? [] : seedNodes), ...sourceNodes, ...draftNodes];
}

function buildRoadmapEdges(
  nodes: RoadmapNode[],
  suggestions: RelationSuggestion[],
  draftEdges: GraphEdgeResponse[]
): RoadmapEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  // seedEdges only connect the onboarding illustration's node ids; once
  // buildRoadmapNodes drops those nodes for a Project with real data, drop
  // the matching edges too instead of leaving them dangling.
  const activeSeedEdges = seedEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const draftRoadmapEdges = draftEdges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, status: "pending" as const }));
  const suggestionEdges = suggestions
    .filter((suggestion) => suggestion.status !== "rejected" && nodeIds.has(suggestion.fromNodeId) && nodeIds.has(suggestion.toNodeId))
    .map((suggestion) => ({
      id: suggestion.suggestionId,
      from: suggestion.fromNodeId,
      to: suggestion.toNodeId,
      status: suggestion.status
    }));
  return [...activeSeedEdges, ...draftRoadmapEdges, ...suggestionEdges];
}

function buildRelationSuggestions(nodes: DraftNodeResponse[], edges: GraphEdgeResponse[]): RelationSuggestion[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const suggestions: RelationSuggestion[] = edges.map((edge, index) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    return {
      suggestionId: `suggestion_${stableHash(`${edge.from}:${edge.to}:${edge.label}`)}`,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      fromTitle: from?.title ?? edge.from,
      toTitle: to?.title ?? edge.to,
      relationKind: edge.label,
      rationale: `AI proposes this relation because both nodes were generated in the same analysis pass.`,
      confidence: Math.max(68, 88 - index * 5),
      status: "pending"
    };
  });

  for (const node of nodes.slice(0, 3)) {
    suggestions.push({
      suggestionId: `suggestion_${stableHash(`${node.id}:approval`)}`,
      fromNodeId: node.id,
      toNodeId: "approval",
      fromTitle: node.title,
      toTitle: "Approval gate",
      relationKind: "needs-approval",
      rationale: "New AI-generated nodes need human review before becoming canonical graph links.",
      confidence: node.confidence,
      status: "pending"
    });
  }
  return suggestions;
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

function buildPreviewTags(text: string) {
  const stopWords = new Set(["and", "the", "that", "this", "with", "into", "when", "note", "notes"]);
  const tags = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !stopWords.has(word))
    .slice(0, 3);
  return tags.length ? tags : ["learning"];
}

function compactText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 42) || "note"
  );
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function projectSymbol(title: string) {
  const firstLetter = title.match(/[A-Za-z0-9]/)?.[0];
  return firstLetter ? firstLetter.toUpperCase() : "P";
}

function formatShortDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(timestamp));
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
