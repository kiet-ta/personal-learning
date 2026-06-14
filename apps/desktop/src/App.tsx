import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";

type PromptExample = {
  id: string;
  label: string;
  template: string;
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

type GraphEdge = GraphEdgeResponse & {
  slot: string;
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

const promptDraftSourceName = "prompt-draft.md";
const maxUploadBytes = 2 * 1024 * 1024;
const maxUploadFiles = 40;
const supportedUploadExtensions = [".txt", ".md", ".markdown"];

const initialPrompt =
  "Spaced repetition works better when a note is split into a precise question, a source-backed answer, and a relation to existing concepts. The main risk is keeping vague notes that feel useful but cannot be reviewed.";

const promptExamples: PromptExample[] = [
  {
    id: "lecture",
    label: "Lecture recap",
    template:
      "Today I learned these lecture ideas: [topic]. Main claim: [claim]. Example: [example]. Confusing part: [question]."
  },
  {
    id: "book",
    label: "Book chapter",
    template:
      "This chapter argues that [claim]. Important concepts are [concepts]. It connects to [older idea] because [reason]."
  },
  {
    id: "code",
    label: "Code concept",
    template:
      "I learned the code concept [name]. It solves [problem]. The key rule is [rule]. The common mistake is [mistake]."
  },
  {
    id: "exam",
    label: "Exam prep",
    template:
      "For exam prep, I need to remember [fact], understand [concept], and practice [problem type]. Weak spot: [gap]."
  }
];

const nodeSlots = ["graph-node-a", "graph-node-b", "graph-node-c", "graph-node-d"];
const edgeSlots = ["graph-edge-a", "graph-edge-b", "graph-edge-c", "graph-edge-d"];

export function App() {
  const [promptText, setPromptText] = useState(initialPrompt);
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
  const pipelineSteps = useMemo(() => buildPipelineSteps(draftState), [draftState]);
  const knowledgeFilters = useMemo(() => buildKnowledgeFilters(draftNodes), [draftNodes]);

  async function handleGenerateDraft() {
    const prompt = promptText.trim();
    if (!prompt) {
      setDraftState("error");
      setErrorMessage("Prompt is empty.");
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
      setGraphEdges(
        draft.edges.map((edge, index) => ({
          ...edge,
          slot: edgeSlots[index % edgeSlots.length]
        }))
      );
      setDraftState("ready");
    } catch (error) {
      setDraftState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleSaveSourceOnly() {
    setDraftNodes([]);
    setGraphEdges([]);
    setRetrievedChunks([]);
    setDraftState("idle");
    setErrorMessage("Source-only save is not wired to the vault yet.");
  }

  async function handleSourceUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    if (fileList.length > maxUploadFiles) {
      setDraftState("error");
      setErrorMessage(`Upload at most ${maxUploadFiles} Markdown/text sources per batch.`);
      return;
    }

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
      setRuntimeMode(hasTauriRuntime() ? "SQLite FTS" : "Browser preview");
      setSourceName("rag-analysis.md");
      setDraftNodes([]);
      setGraphEdges([]);
      setRetrievedChunks([]);
      setDraftState("idle");
      setErrorMessage(`Indexed ${uploads.length} source${uploads.length === 1 ? "" : "s"}. Ask a question, then analyze sources.`);
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
    setErrorMessage("Switched back to prompt draft mode.");
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand-block">
          <p className="eyebrow">Local Knowledge</p>
          <h1>Learn Alone</h1>
          <p className="sidebar-note">Prompt-first vault for durable study nodes.</p>
        </div>

        <nav className="nav-list">
          <a className="nav-item active" href="#prompt" aria-current="page">
            Prompt
          </a>
          <a className="nav-item" href="#pipeline">
            Pipeline
          </a>
          <a className="nav-item" href="#drafts">
            Node drafts
          </a>
          <a className="nav-item" href="#graph">
            Graph
          </a>
        </nav>

        <div className="vault-status">
          <span className="status-dot" />
          <span>{runtimeMode}</span>
        </div>
      </aside>

      <section className="workspace" aria-label="Knowledge workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Prompt capture</p>
            <h2>Turn learning into reviewable knowledge nodes.</h2>
          </div>
          <div className="session-badge">
            <span>Source</span>
            <strong>{sourceName}</strong>
          </div>
        </header>

        <section className="hero-grid">
          <section className="composer-surface" id="prompt" aria-labelledby="prompt-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Knowledge prompt</p>
                <h3 id="prompt-title">What did you learn?</h3>
              </div>
              <span className="draft-pill">{draftState === "ready" ? "Draft generated" : "Unsaved draft"}</span>
            </div>

            <label className="prompt-box">
              <span>Learning input</span>
              <textarea value={promptText} onChange={(event) => setPromptText(event.target.value)} />
            </label>

            <div className="source-upload-panel" aria-label="Upload source">
              <div>
                <p className="eyebrow">Source ingest</p>
                <strong>Notebook-style source library</strong>
                <span>Upload up to {maxUploadFiles} Markdown/text sources. Tauri runtime persists them to vault + SQLite FTS.</span>
              </div>
              <div className="source-upload-actions">
                <label className="vault-path-field">
                  <span>Vault root</span>
                  <input value={vaultRoot} onChange={(event) => setVaultRoot(event.target.value)} />
                </label>
                <label className="file-picker">
                  <input
                    accept=".txt,.md,.markdown,text/plain,text/markdown"
                    onChange={(event) => handleSourceUpload(event.target.files)}
                    multiple
                    type="file"
                  />
                  Add sources
                </label>
                <button className="secondary-action" onClick={handleUsePromptDraft} type="button">
                  Use prompt draft
                </button>
              </div>
            </div>

            {sourceLibrary.length > 0 ? (
              <div className="source-library-list" aria-label="Indexed sources">
                {sourceLibrary.map((source) => (
                  <article className="source-library-row" key={source.sourceId}>
                    <div>
                      <strong>{source.sourceName}</strong>
                      <span>{source.vaultRelativePath}</span>
                    </div>
                    <div>
                      <span>{source.chunkCount} chunks</span>
                      <span>{formatBytes(source.sizeBytes)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="prompt-example-grid" aria-label="Prompt examples">
              {promptExamples.map((example) => (
                <button
                  className="prompt-chip"
                  key={example.id}
                  onClick={() => setPromptText(example.template)}
                  type="button"
                  title={example.template}
                >
                  {example.label}
                </button>
              ))}
            </div>

            {errorMessage ? (
              <div className={draftState === "error" ? "error-banner" : "notice-banner"} role="status">
                {errorMessage}
              </div>
            ) : null}

            <div className="composer-actions">
              <button className="secondary-action" onClick={handleSaveSourceOnly} type="button">
                Save source only
              </button>
              <button
                className="primary-action"
                disabled={!canGenerate}
                onClick={handleGenerateDraft}
                type="button"
              >
                {draftState === "processing" ? "Analyzing..." : sourceLibrary.length > 0 ? "Analyze sources" : "Generate node draft"}
              </button>
            </div>
          </section>

          <aside className="pipeline-surface" id="pipeline" aria-labelledby="pipeline-title">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Processing</p>
                <h3 id="pipeline-title">Summarize to graph</h3>
              </div>
              <span className="runtime-label">{runtimeMode}</span>
            </div>

            <ol className="pipeline-list">
              {pipelineSteps.map((step) => (
                <li className={`pipeline-step ${step.status.toLowerCase()}`} key={step.id}>
                  <span className="pipeline-marker" />
                  <div>
                    <div className="pipeline-title-row">
                      <strong>{step.label}</strong>
                      <span>{step.status}</span>
                    </div>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </section>

        <section className="state-grid" aria-label="Workflow states">
          <article className="state-card">
            <span>Prompt</span>
            <strong>{promptText.trim().length} chars</strong>
            <p>{sourceLibrary.length > 0 ? "Prompt is used as the RAG query over indexed sources." : "Input stays local and is only sent to the Tauri command in desktop runtime."}</p>
          </article>
          <article className={`state-card ${draftState === "processing" ? "active" : ""}`}>
            <span>Indexed sources</span>
            <strong>{sourceLibrary.length}</strong>
            <p>SQLite FTS retrieves relevant chunks before draft node generation.</p>
          </article>
          <article className={`state-card ${draftState === "ready" ? "ready" : ""}`}>
            <span>Review ready</span>
            <strong>{draftNodes.length} nodes</strong>
            <p>{graphEdges.length} proposed links are editable before persistence.</p>
          </article>
        </section>

        <section className="review-layout">
          <section className="draft-section" id="drafts" aria-labelledby="draft-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Filtered knowledge</p>
                <h3 id="draft-title">Node drafts</h3>
              </div>
              <div className="filter-row" aria-label="Knowledge filters">
                {knowledgeFilters.map((filter) => (
                  <button
                    className={`filter-chip ${filter.state === "Active" ? "active" : ""}`}
                    key={filter.id}
                    type="button"
                  >
                    <span>{filter.label}</span>
                    <strong>{filter.count}</strong>
                  </button>
                ))}
              </div>
            </div>

            {retrievedChunks.length > 0 ? (
              <div className="retrieved-chunks" aria-label="Retrieved source chunks">
                {retrievedChunks.slice(0, 4).map((chunk) => (
                  <article className="retrieved-chunk" key={chunk.chunkId}>
                    <strong>{chunk.sourceName}:{chunk.startLine}-{chunk.endLine}</strong>
                    <p>{compactPreviewText(chunk.text, 150)}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {draftNodes.length > 0 ? (
              <div className="draft-grid">
                {draftNodes.map((node) => (
                  <article className="draft-card" key={node.id}>
                    <div className="draft-card-header">
                      <span>{node.relationType}</span>
                      <strong>{node.confidence}%</strong>
                    </div>
                    <h4>{node.title}</h4>
                    <p>{node.summary}</p>
                    <div className="tag-row">
                      {node.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className="source-line">{node.source}</div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No generated nodes yet</strong>
                <p>Write a learning prompt, then generate a node draft.</p>
              </div>
            )}
          </section>

          <section className="graph-section" id="graph" aria-labelledby="graph-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Obsidian-like preview</p>
                <h3 id="graph-title">Node graph</h3>
              </div>
              <span className="draft-pill">Not persisted</span>
            </div>

            <div className="graph-canvas" aria-label="Node graph preview">
              {graphEdges.map((edge) => (
                <span
                  aria-label={`${edge.from} ${edge.label} ${edge.to}`}
                  className={`graph-edge ${edge.slot}`}
                  key={edge.id}
                >
                  <span>{edge.label}</span>
                </span>
              ))}
              {draftNodes.map((node) => (
                <article className={`graph-node ${node.graphSlot}`} key={node.id}>
                  <strong>{node.title}</strong>
                  <span>{node.relationType}</span>
                </article>
              ))}
              {draftNodes.length === 0 ? (
                <div className="empty-graph">
                  <strong>Graph waits for generated nodes</strong>
                  <span>Draft links appear here after the Rust command returns.</span>
                </div>
              ) : null}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
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

function buildPipelineSteps(state: DraftRunState): PipelineStep[] {
  if (state === "error") {
    return [
      {
        id: "summarize",
        label: "Summarize",
        status: "Blocked",
        description: "Generation did not complete. Review the message in the composer."
      },
      {
        id: "filter",
        label: "Filter",
        status: "Queued",
        description: "Waiting for a valid prompt and command response."
      },
      {
        id: "split",
        label: "Split nodes",
        status: "Queued",
        description: "No draft nodes were accepted."
      },
      {
        id: "link",
        label: "Link graph",
        status: "Queued",
        description: "Graph links need generated node IDs."
      }
    ];
  }

  return [
    {
      id: "summarize",
      label: "Summarize",
      status: state === "idle" ? "Queued" : "Done",
      description: "Condense raw learning notes into claims and examples."
    },
    {
      id: "filter",
      label: "Filter",
      status: state === "idle" ? "Queued" : state === "processing" ? "Active" : "Done",
      description: "Remove filler, keep source-bound knowledge units."
    },
    {
      id: "split",
      label: "Split nodes",
      status: state === "ready" ? "Done" : state === "processing" ? "Active" : "Queued",
      description: "Create atomic node drafts with tags and confidence."
    },
    {
      id: "link",
      label: "Link graph",
      status: state === "ready" ? "Done" : "Queued",
      description: "Propose Obsidian-style relations for review."
    }
  ];
}

function buildKnowledgeFilters(nodes: DraftNode[]): KnowledgeFilter[] {
  const relationCounts = nodes.reduce<Record<DraftRelationType, number>>(
    (counts, node) => ({
      ...counts,
      [node.relationType]: counts[node.relationType] + 1
    }),
    { Source: 0, Prerequisite: 0, Supports: 0, Contrasts: 0 }
  );

  return [
    filter("core", "Core ideas", nodes.length),
    filter("support", "Supports", relationCounts.Supports),
    filter("prereq", "Prerequisites", relationCounts.Prerequisite),
    filter("contrast", "Contrasts", relationCounts.Contrasts)
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

async function readSourceFiles(fileList: FileList): Promise<SourceUploadPayload[]> {
  const files = Array.from(fileList);
  const uploads: SourceUploadPayload[] = [];

  for (const file of files) {
    if (!isSupportedUploadName(file.name)) {
      throw new Error("Only .txt, .md, and .markdown sources are supported.");
    }
    if (file.size > maxUploadBytes) {
      throw new Error(`${file.name} is larger than the ${formatBytes(maxUploadBytes)} limit.`);
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
