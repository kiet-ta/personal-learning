import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

type WorkspacePage = "note" | "graph" | "review" | "settings";
type WorkspaceMainPage = Exclude<WorkspacePage, "settings">;
type SettingsView = "account" | "llm";
type DraftRelationType = "Source" | "Prerequisite" | "Supports" | "Contrasts";
type SuggestionStatus = "pending" | "approved" | "rejected";
type LlmProvider = "OpenAI" | "Anthropic" | "Azure OpenAI" | "Google Gemini" | "OpenRouter" | "Local API";

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
  tone: "primary" | "source" | "draft" | "review" | "muted";
  meta: string;
};

type RoadmapEdge = {
  id: string;
  from: string;
  to: string;
  status: "fixed" | SuggestionStatus;
};

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

const maxUploadBytes = 2 * 1024 * 1024;
const maxUploadFiles = 40;
const promptDraftSourceName = "note-draft.md";
const supportedUploadExtensions = [".txt", ".md", ".markdown"];
const workspaceTabs: { id: WorkspaceMainPage; label: string; shortLabel: string }[] = [
  { id: "note", label: "Note", shortLabel: "N" },
  { id: "graph", label: "Graph", shortLabel: "G" },
  { id: "review", label: "Review", shortLabel: "R" }
];

const llmProviders: LlmProvider[] = ["OpenAI", "Anthropic", "Azure OpenAI", "Google Gemini", "OpenRouter", "Local API"];
const llmModels: Record<LlmProvider, string[]> = {
  OpenAI: ["GPT-5.5", "GPT-5 mini", "GPT-4.1"],
  Anthropic: ["Claude Opus", "Claude Sonnet", "Claude Haiku"],
  "Azure OpenAI": ["gpt-5.5-deployment", "gpt-5-mini-deployment"],
  "Google Gemini": ["Gemini 2.5 Pro", "Gemini 2.5 Flash"],
  OpenRouter: ["openrouter/auto", "anthropic/claude-sonnet", "openai/gpt-5-mini"],
  "Local API": ["local-default", "llama.cpp", "ollama"]
};

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
    updatedAt: Date.now(),
    sourceCount: 0
  }
];

const seedNodes: RoadmapNode[] = [
  {
    id: "capture",
    title: "Capture",
    summary: "Upload source files and take fast notes in the same workspace.",
    x: 18,
    y: 18,
    depth: 16,
    tone: "primary",
    meta: "note"
  },
  {
    id: "source-index",
    title: "Source index",
    summary: "Markdown and text sources are chunked, hashed, and indexed with SQLite FTS.",
    x: 18,
    y: 44,
    depth: -8,
    tone: "source",
    meta: "FTS"
  },
  {
    id: "draft-nodes",
    title: "AI draft nodes",
    summary: "AI or deterministic generators create candidate knowledge nodes.",
    x: 50,
    y: 34,
    depth: 40,
    tone: "draft",
    meta: "pending"
  },
  {
    id: "approval",
    title: "Approval gate",
    summary: "Suggested edges remain pending until the user approves or rejects them.",
    x: 50,
    y: 62,
    depth: 18,
    tone: "review",
    meta: "human"
  },
  {
    id: "graph-review",
    title: "Review prompt",
    summary: "Approved notes feed NotebookLM-style review answers with citations.",
    x: 82,
    y: 48,
    depth: 4,
    tone: "primary",
    meta: "review"
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

export function App() {
  const [activePage, setActivePage] = useState<WorkspacePage>("note");
  const [lastWorkspacePage, setLastWorkspacePage] = useState<WorkspaceMainPage>("note");
  const [settingsView, setSettingsView] = useState<SettingsView>("llm");
  const [vaultRoot, setVaultRoot] = useState("vault");
  const [notes, setNotes] = useState<LearningNote[]>(seedNotes);
  const [activeNoteId, setActiveNoteId] = useState(seedNotes[0].id);
  const [sourceLibrary, setSourceLibrary] = useState<SourceLibraryItem[]>([]);
  const [browserSources, setBrowserSources] = useState<SourceUploadPayload[]>([]);
  const [retrievedChunks, setRetrievedChunks] = useState<RetrievedChunk[]>([]);
  const [draftNodes, setDraftNodes] = useState<DraftNodeResponse[]>([]);
  const [draftEdges, setDraftEdges] = useState<GraphEdgeResponse[]>([]);
  const [suggestions, setSuggestions] = useState<RelationSuggestion[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("OpenAI");
  const [llmModel, setLlmModel] = useState(llmModels.OpenAI[0]);
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [sessionApiKey, setSessionApiKey] = useState("");
  const [accountName, setAccountName] = useState("KietTranAnh");
  const [accountEmail, setAccountEmail] = useState("local-user@example.com");
  const [newEmail, setNewEmail] = useState("");
  const [consultationBannerEnabled, setConsultationBannerEnabled] = useState(true);
  const [reviewPrompt, setReviewPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "assistant_welcome",
      role: "assistant",
      text:
        "Ask a question about the approved graph or uploaded sources. Answers should be checked against citations before review.",
      citations: []
    }
  ]);

  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0];
  const roadmapNodes = useMemo(
    () => buildRoadmapNodes(sourceLibrary, draftNodes),
    [draftNodes, sourceLibrary]
  );
  const roadmapEdges = useMemo(
    () => buildRoadmapEdges(roadmapNodes, suggestions, draftEdges),
    [draftEdges, roadmapNodes, suggestions]
  );
  const selectedNode = selectedNodeId ? roadmapNodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const approvedSuggestions = suggestions.filter((suggestion) => suggestion.status === "approved");
  const sourceCount = sourceLibrary.length;
  const indexedChunkCount = sourceLibrary.reduce((total, source) => total + source.chunkCount, 0);
  const apiKeyState = sessionApiKey.trim() ? "Session key active" : "No key stored";

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let cancelled = false;
    invoke<string>("list_notes", { vaultRoot })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const parsed = JSON.parse(payload) as LearningNoteListResponse;
        if (Array.isArray(parsed.notes) && parsed.notes.length > 0) {
          const loaded = parsed.notes.map((note) => ({
            id: note.noteId,
            title: note.title,
            body: note.bodyMarkdown,
            updatedAt: note.updatedAtUnixMs,
            sourceCount: 0
          }));
          setNotes(loaded);
          setActiveNoteId(loaded[0].id);
        }
      })
      .catch(() => {
        // Browser preview and first-run vaults can continue with the seed note.
      });

    return () => {
      cancelled = true;
    };
  }, [vaultRoot]);

  function updateActiveNote(next: Partial<LearningNote>) {
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
    const title = activeNote.title.trim();
    const bodyMarkdown = activeNote.body.trim();
    if (!title || !bodyMarkdown) {
      setErrorMessage("Note needs a title and body before saving.");
      return;
    }

    try {
      if (hasTauriRuntime()) {
        const payload = await invoke<string>("save_note", {
          vaultRoot,
          title,
          bodyMarkdown
        });
        const saved = JSON.parse(payload) as LearningNoteResponse;
        updateActiveNote({
          id: saved.noteId,
          title: saved.title,
          body: saved.bodyMarkdown,
          updatedAt: saved.updatedAtUnixMs
        });
        setActiveNoteId(saved.noteId);
      }
      setStatusMessage("Note saved to the workspace boundary.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
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

    setErrorMessage(null);
    try {
      const uploads = await readSourceFiles(fileList);
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
      updateActiveNote({ sourceCount: sourceCount + uploads.length });
      setStatusMessage(`Indexed ${uploads.length} source file${uploads.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleGenerateGraph() {
    const content = activeNote.body.trim();
    if (!content) {
      setErrorMessage("Write a note before generating nodes.");
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const draft =
        sourceLibrary.length > 0
          ? await analyzeSourceLibrary({
              browserSources,
              query: content,
              vaultRoot
            })
          : hasTauriRuntime()
            ? await generateDraftViaTauri(`${slugify(activeNote.title)}.md`, content)
            : generateBrowserPreviewDraft(content, `${slugify(activeNote.title)}.md`);

      if (isRagAnalysisResponse(draft)) {
        setRetrievedChunks(draft.chunks);
        setSourceLibrary(draft.sources);
      }
      setDraftNodes(draft.nodes);
      setDraftEdges(draft.edges);

      const nextSuggestions = buildRelationSuggestions(draft.nodes, draft.edges);
      setSuggestions(nextSuggestions);
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
      setSelectedNodeId(null);
      setLastWorkspacePage("graph");
      setActivePage("graph");
      setStatusMessage("Nodes generated. Review the smart graph and pending links.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleSuggestionDecision(suggestionId: string, status: Exclude<SuggestionStatus, "pending">) {
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
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function createNote() {
    const id = `note_${Date.now()}`;
    const nextNote: LearningNote = {
      id,
      title: "Untitled note",
      body: "",
      updatedAt: Date.now(),
      sourceCount: 0
    };
    setNotes((current) => [nextNote, ...current]);
    setActiveNoteId(id);
    setActivePage("note");
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

  function deleteNote(noteId: string) {
    const remaining = notes.filter((n) => n.id !== noteId);
    if (remaining.length === 0) {
      const fallback: LearningNote = {
        id: `note_${Date.now()}`,
        title: "Untitled note",
        body: "",
        updatedAt: Date.now(),
        sourceCount: 0
      };
      setNotes([fallback]);
      setActiveNoteId(fallback.id);
    } else {
      setNotes(remaining);
      if (activeNoteId === noteId) {
        setActiveNoteId(remaining[0].id);
      }
    }
    setNoteMenuId(null);
  }

  function duplicateNote(noteId: string) {
    const source = notes.find((n) => n.id === noteId);
    if (!source) return;
    const id = `note_${Date.now()}`;
    const clone: LearningNote = {
      ...source,
      id,
      title: `Copy of ${source.title}`,
      updatedAt: Date.now()
    };
    setNotes((current) => [clone, ...current]);
    setActiveNoteId(id);
    setNoteMenuId(null);
  }

  function startRename(noteId: string) {
    setRenamingNoteId(noteId);
    setNoteMenuId(null);
  }

  function commitRename(noteId: string, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setNotes((current) =>
      current.map((n) =>
        n.id === noteId ? { ...n, title: trimmed, updatedAt: Date.now() } : n
      )
    );
    setRenamingNoteId(null);
  }

  function openSettings(view: SettingsView) {
    if (activePage !== "settings") {
      setLastWorkspacePage(activePage);
    }
    setSettingsView(view);
    setActivePage("settings");
  }

  function handleLlmProviderChange(provider: LlmProvider) {
    setLlmProvider(provider);
    setLlmModel(llmModels[provider][0]);
  }

  function handleSaveLlmConfig(makeDefault = false) {
    setErrorMessage(null);
    setStatusMessage(
      makeDefault
        ? "Default LLM config updated for this session. Secure persistence still requires OS-backed storage."
        : "LLM config updated for this session."
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

  function handleReviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = reviewPrompt.trim();
    if (!prompt) {
      return;
    }
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
      { id: `user_${Date.now()}`, role: "user", text: prompt, citations: [] },
      {
        id: `assistant_${Date.now()}`,
        role: "assistant",
        text: answer,
        citations
      }
    ]);
    setReviewPrompt("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="Application identity">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>ReMind</strong>
            <span>Desktop vault for Windows and macOS</span>
          </div>
        </div>

        <nav className="page-tabs" aria-label="Workspace pages">
          {workspaceTabs.map((page) => (
            <button
              className={activePage === page.id ? "active" : ""}
              key={page.id}
              onClick={() => setActivePage(page.id)}
              type="button"
            >
              <span aria-hidden="true">{page.shortLabel}</span>
              {page.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <label className="source-button">
            Add sources
            <input
              accept=".txt,.md,.markdown"
              multiple
              onChange={(event) => handleSourceUpload(event.target.files)}
              type="file"
            />
          </label>
          <button onClick={handleGenerateGraph} type="button">
            {isProcessing ? "Generating" : "Generate nodes"}
          </button>
          <button className="user-chip" onClick={() => openSettings("account")} type="button" aria-label="Open account settings">
            <span>K</span>
          </button>
        </div>
      </header>

      {errorMessage ? <div className="message error">{errorMessage}</div> : null}
      {statusMessage ? <div className="message status">{statusMessage}</div> : null}

      {activePage === "note" ? (
        <section className="note-workspace">
          <aside className="note-rail" aria-label="Notes and source library">
            <div className="rail-heading">
              <div>
                <span className="eyebrow">Notebook</span>
                <h2>Notes</h2>
              </div>
              <button onClick={createNote} type="button">
                + Add
              </button>
            </div>
            <label className="search-field">
              <span>Search</span>
              <input placeholder="Find note or source" />
            </label>
            <div className="note-list">
              {notes.map((note) => (
                <div className="note-item" key={note.id}>
                  <button
                    className={note.id === activeNote.id ? "active" : ""}
                    onClick={() => setActiveNoteId(note.id)}
                    type="button"
                  >
                    {renamingNoteId === note.id ? (
                      <input
                        autoFocus
                        className="rename-input"
                        defaultValue={note.title}
                        onBlur={(e) => commitRename(note.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(note.id, e.currentTarget.value);
                          if (e.key === "Escape") setRenamingNoteId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <strong>{note.title}</strong>
                    )}
                    <span>{compactText(note.body || "Empty note", 72)}</span>
                  </button>
                  <button
                    className="note-menu-trigger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNoteMenuId(noteMenuId === note.id ? null : note.id);
                    }}
                    type="button"
                    aria-label="Note actions"
                  >⋮</button>
                  {noteMenuId === note.id ? (
                    <div className="note-context-menu">
                      <button onClick={() => startRename(note.id)} type="button">Rename</button>
                      <button onClick={() => duplicateNote(note.id)} type="button">Duplicate</button>
                      <button className="destructive" onClick={() => deleteNote(note.id)} type="button">Delete</button>
                    </div>
                  ) : null}
                </div>
              ))}
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
          </aside>

          <section className="editor-panel" aria-label="Note editor">
            <div className="editor-meta">
              <span className="doc-icon" aria-hidden="true" />
              <input
                aria-label="Note title"
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
                aria-label="Note body"
                onChange={(event) => handleBodyChange(event.target.value)}
                placeholder="Write what you learned..."
                value={activeNote.body}
              />
              {slashOpen ? (
                <div className="slash-menu" role="menu">
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
              <button onClick={handleSaveNote} type="button">
                Save note
              </button>
              <button onClick={handleGenerateGraph} type="button">
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
            </div>
            <div className="graph-stats">
              <span>{roadmapNodes.length} nodes</span>
              <span>{pendingSuggestions.length} pending</span>
              <span>{approvedSuggestions.length} approved</span>
            </div>
          </div>
          <div className="roadmap-shell">
            <section className="roadmap-canvas" aria-label="2.5D roadmap graph">
              <div className="depth-plane" aria-hidden="true" />
              <svg className="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {roadmapEdges.map((edge, index) => {
                  const from = roadmapNodes.find((node) => node.id === edge.from);
                  const to = roadmapNodes.find((node) => node.id === edge.to);
                  if (!from || !to) {
                    return null;
                  }
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
              {roadmapNodes.map((node, index) => (
                <button
                  className={`roadmap-node ${node.tone} ${selectedNode?.id === node.id ? "selected" : ""}`}
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  style={
                    {
                      "--x": `${node.x}%`,
                      "--y": `${node.y}%`,
                      "--z": `${node.depth}px`,
                      "--node-index": index
                    } as CSSProperties
                  }
                  type="button"
                >
                  <span>{node.meta}</span>
                  <strong>{node.title}</strong>
                </button>
              ))}
            </section>
            {selectedNode ? (
              <aside className="node-sidebar active" aria-label="Node detail and approvals">
              <div className="panel-card">
                <div className="sidebar-title-row">
                  <span className="eyebrow">Selected node</span>
                  <button onClick={() => setSelectedNodeId(null)} type="button" aria-label="Close node sidebar">
                    x
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
              <div className="panel-card">
                <span className="eyebrow">Recommended connect</span>
                <h2>Related knowledge</h2>
                {pendingSuggestions.length > 0 ? (
                  <div className="suggestion-list">
                    {pendingSuggestions.map((suggestion) => (
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
            ) : (
              <div className="graph-empty-hint">
                <strong>Click a node</strong>
                <span>Open title, overview, and recommended connections.</span>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {activePage === "review" ? (
        <section className="review-workspace">
          <aside className="mini-source-strip" aria-label="Source shortcuts">
            {sourceLibrary.slice(0, 12).map((source, index) => (
              <button key={source.sourceId} title={source.sourceName} type="button">
                {index + 1}
              </button>
            ))}
          </aside>
          <section className="chat-panel" aria-label="Review prompt">
            <div className="chat-heading">
              <div>
                <span className="eyebrow">Review</span>
                <h1>{activeNote.title}</h1>
                <p>
                  {sourceCount} sources · {approvedSuggestions.length} approved relations
                </p>
              </div>
            </div>
            <div className="chat-log">
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
              <input
                onChange={(event) => setReviewPrompt(event.target.value)}
                placeholder="Ask the vault..."
                value={reviewPrompt}
              />
              <span>{sourceCount} sources</span>
              <button type="submit">Send</button>
            </form>
          </section>
          <aside className="studio-panel" aria-label="Study studio">
            <div className="studio-grid">
              {studioActions.map(([title, description]) => (
                <button key={title} type="button">
                  <strong>{title}</strong>
                  <span>{description}</span>
                </button>
              ))}
            </div>
          </aside>
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
                    <p>Use OpenAI, Anthropic, Gemini, OpenRouter, Azure, or a local endpoint. Keys are never written to the vault.</p>
                  </div>
                </div>
                <div className="provider-tabs" role="tablist" aria-label="LLM providers">
                  {llmProviders.map((provider) => (
                    <button
                      aria-selected={llmProvider === provider}
                      className={llmProvider === provider ? "active" : ""}
                      key={provider}
                      onClick={() => handleLlmProviderChange(provider)}
                      role="tab"
                      type="button"
                    >
                      {provider}
                    </button>
                  ))}
                </div>
                <div className="settings-card">
                  <label>
                    API Key
                    <input
                      autoComplete="off"
                      onChange={(event) => setSessionApiKey(event.target.value)}
                      placeholder="Stored only in memory"
                      type="password"
                      value={sessionApiKey}
                    />
                  </label>
                  <label>
                    Model
                    <select onChange={(event) => setLlmModel(event.target.value)} value={llmModel}>
                      {llmModels[llmProvider].map((model) => (
                        <option key={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Base URL
                    <input
                      onChange={(event) => setLlmBaseUrl(event.target.value)}
                      placeholder={llmProvider === "Local API" ? "http://localhost:11434/v1" : "Provider default"}
                      value={llmBaseUrl}
                    />
                  </label>
                  <div className="settings-actions">
                    <button onClick={() => handleSaveLlmConfig(false)} type="button">
                      Save
                    </button>
                    <button onClick={() => handleSaveLlmConfig(true)} type="button">
                      Save and set as default
                    </button>
                  </div>
                  <p className="settings-note">
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
  );
}

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
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

function buildRoadmapNodes(sources: SourceLibraryItem[], drafts: DraftNodeResponse[]): RoadmapNode[] {
  const sourceNodes = sources.slice(0, 5).map((source, index): RoadmapNode => ({
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
  return [...seedNodes, ...sourceNodes, ...draftNodes];
}

function buildRoadmapEdges(
  nodes: RoadmapNode[],
  suggestions: RelationSuggestion[],
  draftEdges: GraphEdgeResponse[]
): RoadmapEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
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
  return [...seedEdges, ...draftRoadmapEdges, ...suggestionEdges];
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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
