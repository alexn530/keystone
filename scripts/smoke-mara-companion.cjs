// Mara companion state derivation.
//
// The mascot must not invent status — every state maps to an observable signal
// the dashboard already computes. This test freezes the mapping so a future
// refactor cannot silently claim a state that the backend has not reported.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  if ((request.startsWith("./") || request.startsWith("../")) && parent?.filename) {
    const candidate = path.resolve(path.dirname(parent.filename), request);
    if (!path.extname(candidate) && fs.existsSync(`${candidate}.ts`)) {
      return `${candidate}.ts`;
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function loadTypeScript(module, filename) {
  if (!filename.startsWith(root)) return module._compile(fs.readFileSync(filename, "utf8"), filename);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { deriveMaraState, buildMaraMessage } = require("../app/lib/cmdb/mara-companion-state.ts");

function baseHealth(overrides = {}) {
  return {
    score: 0, grade: "-", ciCount: 0, duplicateCandidates: 0, reviewCount: 0,
    relationshipCount: 0, completeness: 0, correctness: 0, compliance: 0,
    duplicateRate: 0, staleRecords: 0, fixes: [], ...overrides,
  };
}

function ci(status) {
  return { id: `CI-${status}`, name: "n", className: "c", ip: "", source: "", operation: "NO_CHANGE", confidence: 0, health: 0, updatedAt: "", status, provenance: [] };
}

function scenario(partial) {
  return {
    section: "comprehend", activeRunId: "", runState: "", analysisState: "idle",
    apiState: "demo", timeline: [], cis: [], health: baseHealth(), findings: [],
    reviews: [], ...partial,
  };
}

// Sleeping: no active run.
assert.equal(deriveMaraState(scenario({})).state, "sleeping");
assert.equal(deriveMaraState(scenario({ activeRunId: "", runState: "analyzing" })).state, "sleeping");

// Inspecting: analysis started, or active run state.
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", analysisState: "starting" })).state, "inspecting");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "analyzing" })).state, "inspecting");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "ingesting" })).state, "inspecting");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", apiState: "connecting" })).state, "inspecting");

// Awaiting approval: explicit backend state.
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "awaiting_approval" })).state, "awaiting_approval");

// Blooming: terminal success with no unresolved review items.
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "complete" })).state, "blooming");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "completed" })).state, "blooming");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "committed" })).state, "blooming");

// Warning overrides completed when unresolved holds remain.
assert.equal(
  deriveMaraState(scenario({ activeRunId: "R1", runState: "complete", cis: [ci("review"), ci("live")] })).state,
  "warning",
);
assert.equal(
  deriveMaraState(scenario({ activeRunId: "R1", runState: "analyzing", reviews: [{ decision: "pending" }] })).state,
  "warning",
);
assert.equal(
  deriveMaraState(scenario({ activeRunId: "R1", runState: "analyzing", findings: [{ severity: "high" }] })).state,
  "warning",
);
// Reviews already decided do not create attention noise.
assert.equal(
  deriveMaraState(scenario({ activeRunId: "R1", runState: "complete", reviews: [{ decision: "approved" }] })).state,
  "blooming",
);

// Error: analysis failed, run failed, or API errored on an active run.
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", analysisState: "error" })).state, "error");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "failed" })).state, "error");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "error" })).state, "error");
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "analyzing", apiState: "error" })).state, "error");

// Draft is not error even when apiState is idle.
assert.equal(deriveMaraState(scenario({ activeRunId: "R1", runState: "draft" })).state, "sleeping");

// Awaiting_approval takes precedence over warning when it is the raw run state.
assert.equal(
  deriveMaraState(scenario({ activeRunId: "R1", runState: "awaiting_approval", cis: [ci("review")] })).state,
  "awaiting_approval",
);

// Messages use real counts.
const warningInput = scenario({ activeRunId: "R1", runState: "complete", cis: [ci("review"), ci("review"), ci("live")] });
const warningMsg = buildMaraMessage(warningInput, deriveMaraState(warningInput));
assert.match(warningMsg.primary, /2 records need human attention/);

const singleWarningInput = scenario({ activeRunId: "R1", runState: "complete", cis: [ci("review"), ci("live")] });
const singleWarningMsg = buildMaraMessage(singleWarningInput, deriveMaraState(singleWarningInput));
assert.match(singleWarningMsg.primary, /^1 record needs/);

const sleepingMsg = buildMaraMessage(scenario({}), deriveMaraState(scenario({})));
assert.match(sleepingMsg.primary, /Bring me an estate/);

const bloomingInput = scenario({
  activeRunId: "R1",
  runState: "complete",
  timeline: [
    { id: "e1", seq: 1, step: 1, name: "Source received", recordName: "", className: "", operation: "NO_CHANGE", source: "", confidence: 0, time: "", status: "complete", reasoning: "" },
    { id: "e7", seq: 7, step: 7, name: "Ledger sealed", recordName: "", className: "", operation: "NO_CHANGE", source: "", confidence: 0, time: "", status: "complete", reasoning: "" },
  ],
});
const bloomingMsg = buildMaraMessage(bloomingInput, deriveMaraState(bloomingInput));
assert.match(bloomingMsg.primary, /verified through IRE/);

console.log("smoke-mara-companion: all assertions passed");
