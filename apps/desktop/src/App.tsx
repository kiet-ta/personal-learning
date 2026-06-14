type WorkQueueItem = {
  id: string;
  filename: string;
  status: "Queued" | "Parsed" | "Needs review";
  nodes: number;
};

type ReviewMetric = {
  label: string;
  value: string;
};

const queue: WorkQueueItem[] = [
  { id: "asset-001", filename: "database-normalization.md", status: "Parsed", nodes: 12 },
  { id: "asset-002", filename: "operating-systems.txt", status: "Queued", nodes: 0 },
  { id: "asset-003", filename: "lecture-slide.pdf", status: "Needs review", nodes: 28 }
];

const reviewMetrics: ReviewMetric[] = [
  { label: "Due today", value: "18" },
  { label: "Indexed nodes", value: "40" },
  { label: "Trace coverage", value: "100%" }
];

export function App() {
  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div>
          <p className="eyebrow">Local Knowledge</p>
          <h1>Learning Vault</h1>
        </div>
        <nav className="nav-list">
          <a className="nav-item active" href="#inbox">Inbox</a>
          <a className="nav-item" href="#search">Search</a>
          <a className="nav-item" href="#graph">Graph</a>
          <a className="nav-item" href="#review">Review</a>
          <a className="nav-item" href="#sync">Mobile Sync</a>
        </nav>
        <div className="vault-status">
          <span className="status-dot" />
          <span>Desktop vault is canonical</span>
        </div>
      </aside>

      <section className="workspace" aria-label="Knowledge workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Phase 1</p>
            <h2>Import, parse, trace</h2>
          </div>
          <button className="primary-action" type="button">Import file</button>
        </header>

        <section className="metrics" aria-label="Review metrics">
          {reviewMetrics.map((metric) => (
            <div className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </section>

        <section className="content-grid">
          <section className="panel import-panel" id="inbox">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Inbox</p>
                <h3>Source assets</h3>
              </div>
              <button className="secondary-action" type="button">Rebuild index</button>
            </div>
            <div className="queue-list">
              {queue.map((item) => (
                <article className="queue-row" key={item.id}>
                  <div>
                    <strong>{item.filename}</strong>
                    <span>{item.id}</span>
                  </div>
                  <div className="queue-meta">
                    <span>{item.status}</span>
                    <span>{item.nodes} nodes</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel" id="search">
            <p className="eyebrow">FTS first</p>
            <h3>Recall search</h3>
            <label className="search-box">
              <span>Query</span>
              <input placeholder="Search concepts, formulas, aliases" />
            </label>
            <div className="result-preview">
              <strong>Normalization</strong>
              <p>Source anchored to database-normalization.md, lines 14-28.</p>
            </div>
          </section>

          <section className="panel graph-panel" id="graph">
            <p className="eyebrow">Graph MVP</p>
            <h3>Typed edges</h3>
            <div className="graph-canvas" aria-label="Graph preview">
              <span className="graph-node node-a">Source</span>
              <span className="graph-edge edge-a" />
              <span className="graph-node node-b">Node</span>
              <span className="graph-edge edge-b" />
              <span className="graph-node node-c">Review</span>
            </div>
          </section>

          <section className="panel" id="review">
            <p className="eyebrow">FSRS basic</p>
            <h3>Review queue</h3>
            <div className="review-row">
              <span>Database Normalization</span>
              <button className="secondary-action" type="button">Start</button>
            </div>
            <div className="review-row">
              <span>Process Scheduling</span>
              <button className="secondary-action" type="button">Start</button>
            </div>
          </section>

          <section className="panel sync-panel" id="sync">
            <p className="eyebrow">Local only</p>
            <h3>Mobile companion</h3>
            <p>
              Pairing uses a short-lived token. Mobile can push assets and review events,
              then receive due cards and node summaries.
            </p>
          </section>
        </section>
      </section>
    </main>
  );
}
