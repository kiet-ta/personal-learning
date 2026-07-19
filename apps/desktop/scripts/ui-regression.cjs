const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const appRoot = path.resolve(__dirname, "..");

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));

  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1 &&
      dimensions.bodyScrollWidth <= dimensions.clientWidth + 1,
    `${label} overflows horizontally: ${JSON.stringify(dimensions)}`
  );
}

async function main() {
  const { createServer } = await import("vite");
  const screenshotDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  let server;
  let browser;

  try {
    server = await createServer({
      root: appRoot,
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false
      }
    });
    await server.listen();

    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== "string", "Vite did not expose a TCP port.");
    const appUrl = `http://127.0.0.1:${address.port}/`;

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 800 }
    });

    await context.addInitScript(() => {
      const now = 1_750_000_000_000;
      const projectId = "project_ui_regression";
      const noteId = "note_ui_regression";
      const secondProjectId = "project_ui_regression_second";
      const secondNoteId = "note_ui_regression_second";
      const calls = [];
      let failNextDelete = true;
      let createdProjectCount = 0;
      let sourceVersionCount = 0;
      let createdNoteReturned = false;
      let pendingSaveRelease = null;
      let pendingReviewRelease = null;
      let pendingSourceListRelease = null;
      let pendingCreateRelease = null;
      let pendingIngestRelease = null;
      const regressionState = {
        migrationCompleted: false,
        listProjectsBeforeMigration: false,
        deferNextSaveProjectId: null,
        deferNextReviewProjectId: null,
        pendingSave: false,
        pendingReview: false,
        deferNextSourceListProjectId: null,
        pendingSourceList: false,
        deferNextCreate: false,
        failNextCreate: false,
        pendingCreate: false,
        deferNextIngestProjectId: null,
        pendingIngest: false,
        lastResolvedReviewRunId: null
      };

      const project = {
        schemaVersion: 1,
        projectId,
        title: "Regression Project",
        slug: "regression-project",
        defaultNoteId: noteId,
        createdAtUnixMs: now,
        updatedAtUnixMs: now
      };
      const defaultNote = {
        schemaVersion: 1,
        projectId,
        noteId,
        title: "Welcome",
        slug: "welcome",
        tags: [],
        bodyMarkdown: "# Welcome\n\nRegression fixture note.",
        createdAtUnixMs: now,
        updatedAtUnixMs: now,
        legacyNoteId: null,
        vaultRelativePath: "projects/regression-project/notes/welcome.md"
      };
      const createdNote = {
        ...defaultNote,
        noteId: "note_created_in_regression",
        title: "Untitled note",
        slug: "untitled-note",
        tags: ["regression-tag"],
        bodyMarkdown: "# Scratch fixture\n\nCreated body v1.",
        vaultRelativePath: "projects/regression-project/notes/untitled-note.md"
      };
      const secondProject = {
        ...project,
        projectId: secondProjectId,
        title: "Second Project",
        slug: "second-project",
        defaultNoteId: secondNoteId
      };
      const secondDefaultNote = {
        ...defaultNote,
        projectId: secondProjectId,
        noteId: secondNoteId,
        title: "Second Welcome",
        slug: "second-welcome",
        bodyMarkdown: "# Second Project\n\nIsolated editor state.",
        vaultRelativePath: "projects/second-project/notes/second-welcome.md"
      };
      const notesById = new Map([
        [defaultNote.noteId, defaultNote],
        [createdNote.noteId, createdNote],
        [secondDefaultNote.noteId, secondDefaultNote]
      ]);
      const sourceVersionsByProject = new Map([
        [projectId, []],
        [secondProjectId, []]
      ]);

      window.__UI_REGRESSION__ = {
        calls,
        state: regressionState,
        deferNextSaveFor(projectIdToDelay) {
          regressionState.deferNextSaveProjectId = projectIdToDelay;
        },
        releasePendingSave() {
          const release = pendingSaveRelease;
          pendingSaveRelease = null;
          release?.();
        },
        deferNextReviewFor(projectIdToDelay) {
          regressionState.deferNextReviewProjectId = projectIdToDelay;
        },
        releasePendingReview() {
          const release = pendingReviewRelease;
          pendingReviewRelease = null;
          release?.();
        },
        deferNextSourceListFor(projectIdToDelay) {
          regressionState.deferNextSourceListProjectId = projectIdToDelay;
        },
        releasePendingSourceList() {
          const release = pendingSourceListRelease;
          pendingSourceListRelease = null;
          release?.();
        },
        deferNextCreateProject() {
          regressionState.deferNextCreate = true;
        },
        releasePendingCreate() {
          const release = pendingCreateRelease;
          pendingCreateRelease = null;
          release?.();
        },
        failNextCreateProject() {
          regressionState.failNextCreate = true;
        },
        deferNextIngestFor(projectIdToDelay) {
          regressionState.deferNextIngestProjectId = projectIdToDelay;
        },
        releasePendingIngest() {
          const release = pendingIngestRelease;
          pendingIngestRelease = null;
          release?.();
        }
      };
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args = {}) => {
          calls.push({ command, args });

          switch (command) {
            case "migrate_legacy_workspace":
              await new Promise((resolve) => setTimeout(resolve, 30));
              regressionState.migrationCompleted = true;
              calls.push({ command: "__migration_completed__", args: {} });
              return JSON.stringify({
                status: "noLegacyNotes",
                migratedNoteCount: 0,
                importedProjectId: null,
                backupVaultRelativePath: null,
                contentSha256: null
              });
            case "list_projects":
              if (!regressionState.migrationCompleted) {
                regressionState.listProjectsBeforeMigration = true;
              }
              return JSON.stringify({ projects: [] });
            case "create_project": {
              if (regressionState.failNextCreate) {
                regressionState.failNextCreate = false;
                throw new Error("simulated Project creation failure");
              }
              if (regressionState.deferNextCreate) {
                regressionState.deferNextCreate = false;
                regressionState.pendingCreate = true;
                await new Promise((resolve) => {
                  pendingCreateRelease = resolve;
                });
                regressionState.pendingCreate = false;
              }
              const snapshot = createdProjectCount === 0
                ? {
                    project: { ...project, title: String(args.title || project.title) },
                    defaultNote
                  }
                : {
                    project: { ...secondProject, title: String(args.title || secondProject.title) },
                    defaultNote: secondDefaultNote
                  };
              createdProjectCount += 1;
              return JSON.stringify({
                project: snapshot.project,
                defaultNote: snapshot.defaultNote
              });
            }
            case "list_project_notes": {
              const notes = args.projectId === secondProjectId
                ? [notesById.get(secondNoteId)].filter(Boolean)
                : [
                    createdNoteReturned ? notesById.get(createdNote.noteId) : null,
                    notesById.get(noteId)
                  ].filter(Boolean);
              return JSON.stringify({ notes });
            }
            case "create_project_note": {
              const alreadyReturned = calls.some(
                (call) => call.command === "__created_note_returned__"
              );
              if (args.projectId === projectId && !alreadyReturned) {
                createdNoteReturned = true;
                calls.push({ command: "__created_note_returned__", args: {} });
                return JSON.stringify(createdNote);
              }
              const fallbackNote = {
                ...(args.projectId === secondProjectId ? secondDefaultNote : defaultNote),
                noteId: `unexpected_created_note_${calls.length}`,
                title: args.title,
                slug: `unexpected-created-note-${calls.length}`,
                bodyMarkdown: "",
                vaultRelativePath: `projects/unexpected/notes/${calls.length}.md`
              };
              notesById.set(fallbackNote.noteId, fallbackNote);
              return JSON.stringify(fallbackNote);
            }
            case "save_project_note": {
              if (regressionState.deferNextSaveProjectId === args.projectId) {
                regressionState.deferNextSaveProjectId = null;
                regressionState.pendingSave = true;
                await new Promise((resolve) => {
                  pendingSaveRelease = resolve;
                });
                regressionState.pendingSave = false;
              }
              const existing = notesById.get(args.noteId);
              if (!existing) {
                throw new Error(`Mock cannot save unknown note ${args.noteId}`);
              }
              const saved = {
                ...existing,
                title: args.title,
                bodyMarkdown: args.bodyMarkdown,
                tags: JSON.parse(String(args.tagsJson)),
                updatedAtUnixMs: now + calls.length
              };
              notesById.set(saved.noteId, saved);
              return JSON.stringify(saved);
            }
            case "delete_project_note":
              if (failNextDelete) {
                failNextDelete = false;
                throw new Error("simulated disk failure");
              }
              notesById.delete(args.noteId);
              return JSON.stringify({
                success: true,
                noteId: args.noteId
              });
            case "ingest_project_source": {
              const request = JSON.parse(String(args.requestJson));
              if (regressionState.deferNextIngestProjectId === request.projectId) {
                regressionState.deferNextIngestProjectId = null;
                regressionState.pendingIngest = true;
                await new Promise((resolve) => {
                  pendingIngestRelease = resolve;
                });
                regressionState.pendingIngest = false;
              }
              sourceVersionCount += 1;
              const version = {
                schemaVersion: 1,
                projectId: request.projectId,
                sourceId: "source_ui_regression",
                versionId: `version_ui_regression_${sourceVersionCount}`,
                sourceName: request.sourceName,
                sha256: "abc123",
                modality: "text",
                sizeBytes: request.content.length,
                createdAtUnixMs: now + sourceVersionCount,
                versionKind: "Initial",
                vaultRelativePath: "projects/regression-project/sources/source.md"
              };
              const versions = sourceVersionsByProject.get(request.projectId) ?? [];
              sourceVersionsByProject.set(request.projectId, [version, ...versions]);
              return JSON.stringify(version);
            }
            case "build_evidence_locator_cmd": {
              const request = JSON.parse(String(args.requestJson));
              return JSON.stringify({
                schemaVersion: 1,
                sourceVersionId: request.versionId,
                sourceId: "source_ui_regression",
                startLine: request.startLine,
                endLine: request.endLine,
                startOffset: 0,
                endOffset: request.content.length,
                excerpt: request.content
              });
            }
            case "ingest_sources":
              return JSON.stringify({
                sources: [{
                  sourceId: "source_ui_regression",
                  sourceName: "source.md",
                  sha256: "abc123",
                  sizeBytes: 22,
                  chunkCount: 1,
                  vaultRelativePath: "sources/source.md"
                }]
              });
            case "list_project_source_versions":
              if (regressionState.deferNextSourceListProjectId === args.projectId) {
                regressionState.deferNextSourceListProjectId = null;
                regressionState.pendingSourceList = true;
                await new Promise((resolve) => {
                  pendingSourceListRelease = resolve;
                });
                regressionState.pendingSourceList = false;
              }
              return JSON.stringify({
                versions: sourceVersionsByProject.get(args.projectId) ?? []
              });
            case "list_project_review_runs":
              return JSON.stringify({ runs: [] });
            case "create_project_review_run": {
              const request = JSON.parse(String(args.requestJson));
              if (regressionState.deferNextReviewProjectId === request.projectId) {
                regressionState.deferNextReviewProjectId = null;
                regressionState.pendingReview = true;
                await new Promise((resolve) => {
                  pendingReviewRelease = resolve;
                });
                regressionState.pendingReview = false;
              }
              const runId = `review_run_${request.projectId}_${calls.length}`;
              regressionState.lastResolvedReviewRunId = runId;
              return JSON.stringify({
                schemaVersion: 1,
                runId,
                projectId: request.projectId,
                noteFilter: request.noteFilter,
                citedSourceVersionIds: request.citedSourceVersionIds,
                prompt: request.prompt,
                dueCount: request.dueCount,
                createdAtUnixMs: now + calls.length,
                vaultRelativePath: `projects/${request.projectId}/reviews/run.md`
              });
            }
            case "list_learning_metrics":
              return JSON.stringify({
                schemaVersion: 1,
                thresholds: {
                  activeLearnerMinRuns: 3,
                  consistencyWindowMs: 604800000
                },
                totalRuns: 0,
                totalCitedSourceVersions: 0,
                projects: [],
                firstEventUnixMs: 0,
                lastEventUnixMs: 0
              });
            case "analyze_project_pet":
              return JSON.stringify({
                schemaVersion: 1,
                projectId,
                asOfUnixMs: now,
                cards: [],
                categoryCounts: {}
              });
            default:
              throw new Error(`Unexpected Tauri command in UI regression: ${command}`);
          }
        }
      };
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({
      content: "*, *::before, *::after { animation: none !important; transition: none !important; }"
    });
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__?.calls.some((call) => call.command === "list_projects")
    );

    const startupCalls = await page.evaluate(() => window.__UI_REGRESSION__.calls);
    assert.ok(
      startupCalls.some((call) => call.command === "list_projects"),
      "list_projects was not invoked during first-run startup."
    );
    const migrationCompletedIndex = startupCalls.findIndex(
      (call) => call.command === "__migration_completed__"
    );
    const listProjectsIndex = startupCalls.findIndex(
      (call) => call.command === "list_projects"
    );
    assert.ok(
      migrationCompletedIndex >= 0 && migrationCompletedIndex < listProjectsIndex,
      "list_projects ran before the legacy migration promise settled."
    );
    assert.equal(
      await page.evaluate(() => window.__UI_REGRESSION__.state.listProjectsBeforeMigration),
      false,
      "Project discovery raced legacy migration and can miss the imported Project."
    );
    assert.equal(
      startupCalls.some((call) => call.command === "list_project_notes"),
      false,
      "Project-scoped notes were requested before a Project existed."
    );

    const projectsNav = page.locator('nav[aria-label="Workspace pages"] button[data-page="projects"]');
    const noteNav = page.locator('nav[aria-label="Workspace pages"] button[data-page="note"]');
    await assertNoHorizontalOverflow(page, "Projects at 1280px");
    if (screenshotDir) {
      await page.waitForTimeout(50);
      await page.screenshot({ path: path.join(screenshotDir, "projects-1280.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 960, height: 800 });
    await assertNoHorizontalOverflow(page, "Projects at 960px");
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "projects-960.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    assert.equal(await noteNav.getAttribute("aria-disabled"), "true");
    assert.equal(
      await noteNav.getAttribute("disabled"),
      null,
      "The gated Note tab still uses native disabled and cannot provide smart redirect feedback."
    );
    await noteNav.evaluate((button) => button.click());
    await assertNoHorizontalOverflow(page, "Gated redirect at 1280px");
    await page.locator(".projects-workspace").waitFor({ state: "visible" });
    assert.match((await projectsNav.getAttribute("class")) || "", /\bactive\b/);

    await page.getByRole("button", { name: /create new project/i }).click();
    const projectTitle = page.getByLabel("Project title");
    await projectTitle.waitFor({ state: "visible" });
    await projectTitle.fill("Regression Project");
    await page.getByRole("button", { name: /^create project$/i }).click();

    await page.locator(".note-workspace").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__?.calls.some((call) => call.command === "create_project")
    );
    const createCall = await page.evaluate(() =>
      window.__UI_REGRESSION__.calls.find((call) => call.command === "create_project")
    );
    assert.equal(createCall.args.title, "Regression Project");
    assert.equal(await noteNav.getAttribute("aria-disabled"), "false");

    const noteBody = page.getByLabel("Note body");
    const unsavedWelcomeDraft = "# Welcome\n\nUnsaved draft survives sibling Note mutations.";
    await noteBody.fill(unsavedWelcomeDraft);

    await page.getByRole("button", { name: "+ Add", exact: true }).click();
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__?.calls.some((call) => call.command === "create_project_note")
    );
    const createdNoteItem = page.locator(".note-item").first();
    await createdNoteItem.waitFor({ state: "visible" });
    assert.match(await createdNoteItem.innerText(), /Untitled note/);
    const updatedScratchBody = "# Scratch fixture\n\nUpdated canonical body.";
    assert.equal(
      await noteBody.inputValue(),
      "# Scratch fixture\n\nCreated body v1.",
      "The newly selected Note did not load its own editor body."
    );

    const welcomeNoteItem = page.locator(".note-item").filter({ hasText: "Welcome" });
    await welcomeNoteItem.locator(".note-select").click();
    assert.equal(
      await noteBody.inputValue(),
      unsavedWelcomeDraft,
      "Creating a sibling Note erased the unsaved Welcome draft."
    );
    await createdNoteItem.locator(".note-select").click();
    assert.equal(
      await noteBody.inputValue(),
      "# Scratch fixture\n\nCreated body v1.",
      "Selecting the created Note did not restore its distinct editor state."
    );

    await noteBody.fill(updatedScratchBody);
    await page.getByRole("button", { name: "Save note" }).click();
    await page.waitForFunction((expectedBody) =>
      window.__UI_REGRESSION__.calls.some(
        (call) => call.command === "save_project_note" &&
          call.args.noteId === "note_created_in_regression" &&
          call.args.bodyMarkdown === expectedBody
      ), updatedScratchBody
    );
    const scratchBodySave = await page.evaluate((expectedBody) =>
      window.__UI_REGRESSION__.calls.find(
        (call) => call.command === "save_project_note" &&
          call.args.noteId === "note_created_in_regression" &&
          call.args.bodyMarkdown === expectedBody
      ), updatedScratchBody
    );
    assert.deepEqual(
      JSON.parse(scratchBodySave.args.tagsJson),
      ["regression-tag"],
      "Saving the body erased canonical Note tags."
    );

    await createdNoteItem.getByRole("button", { name: "Rename" }).click();
    const renameInput = createdNoteItem.locator(".rename-input");
    await renameInput.fill("Scratch note");
    await renameInput.press("Enter");
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__?.calls.some(
        (call) => call.command === "save_project_note" && call.args.title === "Scratch note"
      )
    );
    const scratchRenameSave = await page.evaluate(() =>
      window.__UI_REGRESSION__.calls.find(
        (call) => call.command === "save_project_note" && call.args.title === "Scratch note"
      )
    );
    assert.equal(
      scratchRenameSave.args.bodyMarkdown,
      updatedScratchBody,
      "Renaming a Note rolled its body back to stale project state."
    );
    assert.deepEqual(JSON.parse(scratchRenameSave.args.tagsJson), ["regression-tag"]);
    const scratchNoteItem = page.locator(".note-item").first();
    await scratchNoteItem.getByText("Scratch note", { exact: true }).waitFor();
    await welcomeNoteItem.locator(".note-select").click();
    assert.equal(
      await noteBody.inputValue(),
      unsavedWelcomeDraft,
      "Renaming a sibling Note erased the unsaved Welcome draft."
    );
    await scratchNoteItem.locator(".note-select").click();
    assert.equal(
      await noteBody.inputValue(),
      updatedScratchBody,
      "Returning to the renamed Note did not restore its saved body."
    );
    await scratchNoteItem.getByRole("button", { name: "Delete" }).click();
    await scratchNoteItem.getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("alert").filter({ hasText: "Could not move Note to trash" }).waitFor();
    assert.equal(
      await page.locator(".note-item").filter({ hasText: "Scratch note" }).count(),
      1,
      "Note disappeared even though the canonical delete failed."
    );
    const retryNoteItem = page.locator(".note-item").first();
    await retryNoteItem.getByRole("button", { name: "Delete" }).click();
    await retryNoteItem.getByRole("button", { name: "Move to trash" }).click();
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__?.calls.filter(
        (call) => call.command === "delete_project_note"
      ).length === 2
    );
    assert.equal(
      await page.locator(".note-item").filter({ hasText: "Scratch note" }).count(),
      0,
      "Deleted Note remained in the rail after the canonical delete succeeded."
    );
    const remainingWelcomeItem = page.locator(".note-item").filter({ hasText: "Welcome" });
    assert.equal(
      await remainingWelcomeItem.locator(".note-select").getAttribute("aria-current"),
      "true",
      "Deleting the active Note did not select a remaining canonical Note."
    );
    assert.equal(
      await noteBody.inputValue(),
      unsavedWelcomeDraft,
      "Deleting a sibling Note erased the unsaved draft of the remaining active Note."
    );

    const createNoteCallsBeforePostDeleteSave = await page.evaluate(() =>
      window.__UI_REGRESSION__.calls.filter(
        (call) => call.command === "create_project_note"
      ).length
    );
    const updatedWelcomeBody = "# Welcome\n\nUpdated after deleting the active Note.";
    await noteBody.fill(updatedWelcomeBody);
    await page.getByRole("button", { name: "Save note" }).click();
    await page.waitForFunction((expectedBody) =>
      window.__UI_REGRESSION__.calls.some(
        (call) => call.command === "save_project_note" &&
          call.args.noteId === "note_ui_regression" &&
          call.args.bodyMarkdown === expectedBody
      ), updatedWelcomeBody
    );
    assert.equal(
      await page.evaluate(() =>
        window.__UI_REGRESSION__.calls.filter(
          (call) => call.command === "create_project_note"
        ).length
      ),
      createNoteCallsBeforePostDeleteSave,
      "Saving after active-Note deletion created a duplicate Note instead of updating the remaining Note."
    );

    await assertNoHorizontalOverflow(page, "Note at 1280px");
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "note-1280.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 960, height: 800 });
    await assertNoHorizontalOverflow(page, "Note at 960px");
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "note-960.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    const sourceInput = page.locator('.source-button input[type="file"]');
    const sourceFile = {
      name: "source.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Source\nline 2\nline 3")
    };
    await sourceInput.setInputFiles(sourceFile);
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__?.calls.filter(
        (call) => call.command === "build_evidence_locator_cmd"
      ).length === 1
    );
    assert.equal(
      await sourceInput.inputValue(),
      "",
      "The file input retained its value and cannot reliably reselect the same source."
    );

    await sourceInput.setInputFiles(sourceFile);
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__?.calls.filter(
        (call) => call.command === "ingest_project_source"
      ).length === 2 &&
      window.__UI_REGRESSION__?.calls.filter(
        (call) => call.command === "build_evidence_locator_cmd"
      ).length === 2
    );
    assert.equal(
      await sourceInput.inputValue(),
      "",
      "The repeated upload did not reset the file chooser."
    );
    assert.equal(
      await page.evaluate(() =>
        window.__UI_REGRESSION__.calls.some(
          (call) => call.command === "build_evidence_locator"
        )
      ),
      false,
      "React invoked the unregistered Evidence command name."
    );
    await page.getByRole("button", { name: "Open evidence" }).last().click();
    assert.match(await page.locator(".evidence-excerpt p").innerText(), /# Source/);

    const graphNav = page.locator('nav[aria-label="Workspace pages"] button[data-page="graph"]');
    await graphNav.click();
    await page.locator(".graph-workspace").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Select a node to inspect it" }).waitFor({
      state: "visible"
    });
    await assertNoHorizontalOverflow(page, "Graph at 1280px");
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "graph-1280.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 960, height: 800 });
    await assertNoHorizontalOverflow(page, "Graph at 960px");
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "graph-960.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    const reviewNav = page.locator('nav[aria-label="Workspace pages"] button[data-page="review"]');
    await reviewNav.click();
    await page.locator(".review-workspace").waitFor({ state: "visible" });

    const studioButtons = page.locator(".studio-panel .studio-grid button");
    const studioButtonCount = await studioButtons.count();
    assert.ok(studioButtonCount > 0, "Study Studio actions were not rendered.");
    for (let index = 0; index < studioButtonCount; index += 1) {
      assert.equal(
        await studioButtons.nth(index).isDisabled(),
        true,
        `Study Studio action ${index + 1} looks available but has no implemented behavior.`
      );
    }

    const sendButton = page.locator('.review-composer button[type="submit"]');
    const sendBox = await sendButton.boundingBox();
    assert.ok(sendBox, "Review Send button is not visible.");
    assert.ok(
      sendBox.width >= 64 && sendBox.width > sendBox.height + 16,
      `Review Send button still reads as a ${Math.round(sendBox.width)}x${Math.round(sendBox.height)} circle.`
    );

    await assertNoHorizontalOverflow(page, "Review at 1280px");
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "review-1280.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 960, height: 800 });
    await assertNoHorizontalOverflow(page, "Review at 960px");
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "review-960.png"), fullPage: true });
    }

    await page.setViewportSize({ width: 1280, height: 800 });

    await page.getByRole("button", { name: "Hide sources panel" }).click();
    await page.getByRole("button", { name: "Hide studio panel" }).click();
    await page.locator(".review-workspace.rail-collapsed.studio-collapsed").waitFor({ state: "visible" });
    assert.equal(
      await page.locator(".source-rail-list").count(),
      0,
      "The Sources list should hide while the rail is collapsed."
    );
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "review-collapsed-1280.png"), fullPage: true });
    }
    await page.getByRole("button", { name: "Show sources panel" }).click();
    await page.getByRole("button", { name: "Show studio panel" }).click();
    await page.locator(".source-rail-list button").first().waitFor({ state: "visible" });

    const firstProjectPrompt = "First project scoped question";
    await page.locator(".source-rail-list button").first().click();
    await page.locator(".review-note-filter").getByRole("button", { name: "Welcome" }).click();
    assert.match(
      await page.locator("#review-composer-meta").innerText(),
      /1 notes · 1 citations/,
      "Review scope controls did not reflect the selected Note and source version."
    );
    await page.getByLabel("Review question").fill(firstProjectPrompt);
    await page.locator('.review-composer button[type="submit"]').click();
    await page.waitForFunction(({ expectedProjectId, expectedPrompt }) =>
      window.__UI_REGRESSION__.calls.some((call) => {
        if (call.command !== "create_project_review_run") return false;
        const request = JSON.parse(String(call.args.requestJson));
        return request.projectId === expectedProjectId && request.prompt === expectedPrompt;
      }), { expectedProjectId: "project_ui_regression", expectedPrompt: firstProjectPrompt }
    );
    const firstReviewRequest = await page.evaluate((expectedPrompt) => {
      const call = window.__UI_REGRESSION__.calls.find((candidate) => {
        if (candidate.command !== "create_project_review_run") return false;
        return JSON.parse(String(candidate.args.requestJson)).prompt === expectedPrompt;
      });
      return JSON.parse(String(call.args.requestJson));
    }, firstProjectPrompt);
    assert.deepEqual(firstReviewRequest.noteFilter, ["note_ui_regression"]);
    assert.equal(firstReviewRequest.citedSourceVersionIds.length, 1);

    await noteNav.click();
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    const sameNoteSaveV1 = "# Welcome\n\nSave response v1.";
    const sameNoteDraftV2 = "# Welcome\n\nNewer editor draft v2.";
    await noteBody.fill(sameNoteSaveV1);
    await page.evaluate(() =>
      window.__UI_REGRESSION__.deferNextSaveFor("project_ui_regression")
    );
    await page.getByRole("button", { name: "Save note" }).click();
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingSave === true);
    await noteBody.fill(sameNoteDraftV2);
    await page.evaluate(() => window.__UI_REGRESSION__.releasePendingSave());
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingSave === false);
    await page.waitForTimeout(20);
    assert.equal(
      await noteBody.inputValue(),
      sameNoteDraftV2,
      "The older v1 Save response overwrote the newer v2 editor draft."
    );

    const createCallsBeforeDirtyProbe = await page.evaluate(() =>
      window.__UI_REGRESSION__.calls.filter(
        (call) => call.command === "create_project"
      ).length
    );
    await projectsNav.click();
    await page.getByRole("button", { name: /create new project/i }).click();
    await page.getByLabel("Project title").fill("Dirty-state probe");
    const dirtyProbeDialog = page.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      return message;
    });
    const [dirtyProbeMessage] = await Promise.all([
      dirtyProbeDialog,
      page.getByRole("button", { name: /^create project$/i }).click()
    ]);
    assert.match(dirtyProbeMessage, /unsaved|discard/i);
    assert.equal(
      await page.evaluate(() =>
        window.__UI_REGRESSION__.calls.filter(
          (call) => call.command === "create_project"
        ).length
      ),
      createCallsBeforeDirtyProbe,
      "The v2 editor buffer was treated as clean after resolving the older v1 Save."
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await noteNav.click();
    assert.equal(await noteBody.inputValue(), sameNoteDraftV2);

    await page.getByRole("button", { name: "Save note" }).click();
    await page.waitForFunction((expectedBody) =>
      window.__UI_REGRESSION__.calls.some(
        (call) => call.command === "save_project_note" &&
          call.args.noteId === "note_ui_regression" &&
          call.args.bodyMarkdown === expectedBody
      ), sameNoteDraftV2
    );
    const v2CanonicalSave = await page.evaluate((expectedBody) =>
      window.__UI_REGRESSION__.calls.find(
        (call) => call.command === "save_project_note" &&
          call.args.noteId === "note_ui_regression" &&
          call.args.bodyMarkdown === expectedBody
      ), sameNoteDraftV2
    );
    assert.equal(v2CanonicalSave.args.bodyMarkdown, sameNoteDraftV2);

    const failedCreateDraft = "# Welcome\n\nDraft survives a failed Project creation.";
    await noteBody.fill(failedCreateDraft);
    await projectsNav.click();
    await page.evaluate(() => window.__UI_REGRESSION__.failNextCreateProject());
    await page.getByRole("button", { name: /create new project/i }).click();
    await page.getByLabel("Project title").fill("Failed Project");
    const failedCreateDialog = page.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    });
    const [failedCreateMessage] = await Promise.all([
      failedCreateDialog,
      page.getByRole("button", { name: /^create project$/i }).click()
    ]);
    assert.match(failedCreateMessage, /unsaved|discard/i);
    await page.getByRole("alert").filter({ hasText: /could not create project/i }).waitFor();
    assert.match(
      await page.locator(".active-project-pill").innerText(),
      /Regression Project/,
      "A failed Project creation changed the active Project."
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await noteNav.click();
    assert.equal(
      await noteBody.inputValue(),
      failedCreateDraft,
      "A failed Project creation discarded the current Note draft after confirmation."
    );

    await projectsNav.click();
    await page.locator(".projects-workspace").waitFor({ state: "visible" });
    await page.evaluate(() =>
      window.__UI_REGRESSION__.deferNextSourceListFor("project_ui_regression_second")
    );
    await page.getByRole("button", { name: /create new project/i }).click();
    const secondProjectTitle = page.getByLabel("Project title");
    await secondProjectTitle.fill("Second Project");
    await page.getByRole("button", { name: /^create project$/i }).click();
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      window.__UI_REGRESSION__.calls.filter(
        (call) => call.command === "create_project"
      ).length === 2
    );
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingSourceList === true);

    const noteSourceSummaries = page.locator(".note-rail .source-summary");
    assert.match(
      await noteSourceSummaries.nth(0).innerText(),
      /0 files[\s\S]*0 indexed chunks/,
      "Project A's legacy sourceLibrary file/chunk counts remained visible in Project B."
    );
    assert.match(
      await noteSourceSummaries.nth(1).innerText(),
      /0 versions/,
      "Project A's Source Version count remained visible while Project B was loading."
    );
    assert.equal(
      await page.locator(".note-rail .source-row").count(),
      0,
      "Project A source rows remained visible under Project B while its source list was pending."
    );

    await reviewNav.click();
    await page.locator(".review-workspace").waitFor({ state: "visible" });
    assert.equal(await page.locator(".source-rail-list button").count(), 0);
    await page.locator(".source-rail .empty-copy").waitFor({ state: "visible" });
    assert.match(await page.locator("#review-composer-meta").innerText(), /No citations/);
    assert.equal(
      await page.locator(".review-runs-card li").count(),
      0,
      "Project A Review Run count remained visible immediately after entering Project B."
    );

    await page.evaluate(() => window.__UI_REGRESSION__.releasePendingSourceList());
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingSourceList === false);
    await noteNav.click();
    assert.equal(
      await page.locator(".note-rail .source-row").count(),
      0,
      "Project A source rows reappeared after Project B source loading settled."
    );

    const regressionProjectCard = page.locator("article.project-card").filter({
      hasText: "Regression Project"
    });
    const secondProjectCard = page.locator("article.project-card").filter({
      hasText: "Second Project"
    });

    await projectsNav.click();
    await regressionProjectCard.locator(".project-card-body").click();
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    const switchGateDraft = "# Welcome\n\nKeep this draft when Project switch is cancelled.";
    await noteBody.fill(switchGateDraft);
    await projectsNav.click();

    const cancelSwitchDialog = page.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      return message;
    });
    const [cancelMessage] = await Promise.all([
      cancelSwitchDialog,
      secondProjectCard.locator(".project-card-body").click()
    ]);
    assert.match(cancelMessage, /unsaved|discard/i);
    assert.match(
      await page.locator(".active-project-pill").innerText(),
      /Regression Project/,
      "Cancelling the dirty Project switch still changed the active Project."
    );
    await noteNav.click();
    assert.equal(
      await noteBody.inputValue(),
      switchGateDraft,
      "Cancelling the Project switch discarded the active unsaved draft."
    );

    await projectsNav.click();
    const confirmSwitchDialog = page.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    });
    const [confirmMessage] = await Promise.all([
      confirmSwitchDialog,
      secondProjectCard.locator(".project-card-body").click()
    ]);
    assert.match(confirmMessage, /unsaved|discard/i);
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    assert.match(await page.locator(".active-project-pill").innerText(), /Second Project/);

    await projectsNav.click();
    await regressionProjectCard.locator(".project-card-body").click();
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    const lateSaveBody = "# Welcome\n\nLate Project A save must not mutate Project B UI.";
    await noteBody.fill(lateSaveBody);
    await page.evaluate(() =>
      window.__UI_REGRESSION__.deferNextSaveFor("project_ui_regression")
    );
    await page.getByRole("button", { name: "Save note" }).click();
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingSave === true);

    await projectsNav.click();
    const pendingSaveSwitchDialog = page.waitForEvent("dialog").then(async (dialog) => {
      await dialog.accept();
    });
    await Promise.all([
      pendingSaveSwitchDialog,
      secondProjectCard.locator(".project-card-body").click()
    ]);
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    await page.evaluate(() => window.__UI_REGRESSION__.releasePendingSave());
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingSave === false);
    await page.waitForTimeout(20);
    assert.match(
      await page.locator(".active-project-pill").innerText(),
      /Second Project/,
      "A late Project A Save response changed the active Project."
    );
    assert.equal(
      await noteBody.inputValue(),
      "# Second Project\n\nIsolated editor state.",
      "A late Project A Save response replaced Project B's editor state."
    );
    assert.equal(
      await page.getByText("Welcome", { exact: true }).count(),
      0,
      "A late Project A Save response inserted Note A into Project B."
    );

    await reviewNav.click();
    await page.locator(".review-workspace").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Second Welcome" }).waitFor({ state: "visible" });
    assert.match(
      await page.locator("#review-composer-meta").innerText(),
      /All notes · No citations/,
      "Review Note/source filters leaked from the previous Project."
    );
    assert.equal(
      await page.locator(".chat-message").filter({ hasText: firstProjectPrompt }).count(),
      0,
      "Project-scoped Review conversation leaked into the next Project."
    );

    const secondProjectPrompt = "Second project isolated question";
    await page.getByLabel("Review question").fill(secondProjectPrompt);
    await page.locator('.review-composer button[type="submit"]').click();
    await page.waitForFunction(({ expectedProjectId, expectedPrompt }) =>
      window.__UI_REGRESSION__.calls.some((call) => {
        if (call.command !== "create_project_review_run") return false;
        const request = JSON.parse(String(call.args.requestJson));
        return request.projectId === expectedProjectId && request.prompt === expectedPrompt;
      }), { expectedProjectId: "project_ui_regression_second", expectedPrompt: secondProjectPrompt }
    );
    const secondReviewRequest = await page.evaluate((expectedPrompt) => {
      const call = window.__UI_REGRESSION__.calls.find((candidate) => {
        if (candidate.command !== "create_project_review_run") return false;
        return JSON.parse(String(candidate.args.requestJson)).prompt === expectedPrompt;
      });
      return JSON.parse(String(call.args.requestJson));
    }, secondProjectPrompt);
    assert.equal(secondReviewRequest.projectId, "project_ui_regression_second");
    assert.deepEqual(
      secondReviewRequest.noteFilter,
      [],
      "The second Project Review Run persisted a stale Note filter."
    );
    assert.deepEqual(
      secondReviewRequest.citedSourceVersionIds,
      [],
      "The second Project Review Run persisted a stale source citation."
    );

    await projectsNav.click();
    await regressionProjectCard.locator(".project-card-body").click();
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    await reviewNav.click();
    await page.locator(".review-workspace").waitFor({ state: "visible" });
    const lateReviewPrompt = "Late Project A Review must not leak into Project B";
    await page.evaluate(() =>
      window.__UI_REGRESSION__.deferNextReviewFor("project_ui_regression")
    );
    await page.getByLabel("Review question").fill(lateReviewPrompt);
    await page.locator('.review-composer button[type="submit"]').click();
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingReview === true);

    await projectsNav.click();
    await secondProjectCard.locator(".project-card-body").click();
    await page.locator(".note-workspace").waitFor({ state: "visible" });
    await reviewNav.click();
    await page.locator(".review-workspace").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Second Welcome" }).waitFor({ state: "visible" });
    const projectBChatCountBeforeLateReview = await page.locator(".chat-message").count();
    const projectBRunCountBeforeLateReview = await page.locator(".review-runs-card li").count();
    await page.evaluate(() => window.__UI_REGRESSION__.releasePendingReview());
    await page.waitForFunction(() => window.__UI_REGRESSION__.state.pendingReview === false);
    await page.waitForTimeout(20);
    assert.match(await page.locator(".active-project-pill").innerText(), /Second Project/);
    assert.equal(
      await page.locator(".chat-message").filter({ hasText: lateReviewPrompt }).count(),
      0,
      "A late Project A Review response restored Project A chat inside Project B."
    );
    assert.equal(
      await page.locator(".chat-message").count(),
      projectBChatCountBeforeLateReview,
      "A late Project A Review response appended assistant chat inside Project B."
    );
    assert.equal(
      await page.locator(".review-runs-card li").count(),
      projectBRunCountBeforeLateReview,
      "A late Project A Review response changed Project B's Review Run count."
    );
    const lateProjectAReviewRunId = await page.evaluate(() =>
      window.__UI_REGRESSION__.state.lastResolvedReviewRunId
    );
    assert.match(lateProjectAReviewRunId, /project_ui_regression/);
    assert.equal(
      await page.locator(".review-runs-card li").filter({
        hasText: lateProjectAReviewRunId
      }).count(),
      0,
      "A late Project A Review response appended its run inside Project B."
    );

    assert.deepEqual(pageErrors, [], `Browser runtime errors: ${pageErrors.join(" | ")}`);
    console.log("UI regression passed: migration ordering, unsaved Note buffers, Project-switch confirmation, late-response isolation, repeated Evidence upload, responsive layout, Graph guidance, and Project-scoped Review Runs.");
  } finally {
    await browser?.close();
    await server?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
