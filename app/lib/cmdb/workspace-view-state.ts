// Single source of truth for the Agent Workspace UI.
//
// Every phase card, Mara message, governance panel, and Approvals label reads
// from the same derived shape so the surfaces cannot disagree ("Mara says
// approval required" vs "Approvals says zero", etc.).

import type { ConfigurationItem, HealthData, Relationship, TimelineEvent } from "../../cmdb-data";
import {
  deriveAgentWorkspaceSnapshot,
  type AgentWorkspaceSnapshot,
  type CprPhaseId,
} from "./agent-workspace";
import type { RemediationFinding, RemediationReview } from "./comprehend-adapter";
import { isDraftRunState, isTerminalRunState } from "./run-lifecycle";
import { deriveRemediationWorkQueue, type WorkQueueSummary } from "./work-queue";

export type WorkspacePhaseId = CprPhaseId | "verify";

export type PhaseStatus = "waiting" | "working" | "complete" | "blocked" | "approval_required" | "unknown";

export type MaraViewState =
  | "sleeping"
  | "inspecting"
  | "warning"
  | "awaiting_approval"
  | "blooming"
  | "error";

export type ApiState = "connecting" | "live" | "partial" | "demo" | "error";

export type WorkspaceViewInput = {
  runLabel: string;
  runId?: string;
  runState: string;
  apiState: ApiState;
  analysisState?: "idle" | "starting" | "started" | "error";
  cis: ConfigurationItem[];
  timeline: TimelineEvent[];
  relationships: Relationship[];
  findings: RemediationFinding[];
  reviews: RemediationReview[];
  health: HealthData;
};

export type WorkspaceHealthView = {
  baseline: number | null;
  verified: number | null;
  projected: number | null;
  realizedLift: number | null;
  remainingLift: number | null;
};

export type WorkspaceViewState = {
  runLabel: string;
  runId: string;
  runState: string;
  hasRun: boolean;
  snapshot: AgentWorkspaceSnapshot;
  queue: WorkQueueSummary;

  activePhase: WorkspacePhaseId;
  comprehendStatus: PhaseStatus;
  prioritizeStatus: PhaseStatus;
  remediateStatus: PhaseStatus;
  verifyStatus: PhaseStatus;

  approvalCount: number;
  heldCount: number;
  requiresApproval: boolean;
  requiresReview: boolean;

  mara: {
    state: MaraViewState;
    primary: string;
    secondary?: string;
  };

  governance: {
    title: string;
    message: string;
    tone: "clear" | "attention" | "blocked";
  };

  health: WorkspaceHealthView;
  liveHealthAvailable: boolean;
};

export function deriveWorkspaceViewState(input: WorkspaceViewInput): WorkspaceViewState {
  const queue = deriveRemediationWorkQueue({
    cis: input.cis,
    timeline: input.timeline,
    healthFixes: input.health.fixes,
    findings: input.findings,
    reviews: input.reviews,
    demoFallback: !input.runLabel && input.apiState === "demo",
  });

  const snapshot = deriveAgentWorkspaceSnapshot({
    runLabel: input.runLabel,
    runState: input.runState,
    cis: input.cis,
    timeline: input.timeline,
    relationships: input.relationships,
    findings: input.findings,
    reviews: input.reviews,
    health: input.health,
    queue,
  });

  const hasRun = Boolean(input.runId || input.runLabel);
  const runStateLower = (input.runState || "").toLowerCase();

  const heldCount = input.cis.filter(ci => ci.status !== "live").length;
  const approvalCount = snapshot.approvals.length;
  const requiresApproval = approvalCount > 0 || runStateLower === "awaiting_approval";
  const requiresReview = heldCount > 0 || input.findings.length > 0 || input.reviews.some(r => {
    const decision = (r.decision || "").toLowerCase();
    return !decision || decision === "pending" || decision === "open" || decision === "deferred";
  });

  const comprehendStatus = mapPhaseState(findPhase(snapshot, "comprehend"));
  const prioritizeStatus = mapPhaseState(findPhase(snapshot, "prioritize"));
  const remediateStatus = mapPhaseState(findPhase(snapshot, "remediate"));
  const verifyStatus = deriveVerifyStatus(input, queue);

  const activePhase = pickActivePhase({
    comprehendStatus,
    prioritizeStatus,
    remediateStatus,
    verifyStatus,
    requiresApproval,
    hasRun,
  });

  const mara = deriveMaraView({
    hasRun,
    runStateLower,
    analysisState: input.analysisState,
    apiState: input.apiState,
    requiresApproval,
    approvalCount,
    heldCount,
    verifyStatus,
    snapshot,
  });

  const governance = deriveGovernance({ requiresApproval, requiresReview, approvalCount, heldCount, hasRun });

  const liveHealthAvailable = Boolean(
    input.health.baselineScore !== undefined
    || input.health.verifiedScore !== undefined
    || input.health.projectedScore !== undefined,
  );
  const health = liveHealthAvailable
    ? {
        baseline: input.health.baselineScore ?? null,
        verified: input.health.verifiedScore ?? null,
        projected: input.health.projectedScore ?? null,
        realizedLift: input.health.verifiedScore !== undefined && input.health.baselineScore !== undefined
          ? round(input.health.verifiedScore - input.health.baselineScore)
          : null,
        remainingLift: input.health.projectedScore !== undefined && input.health.verifiedScore !== undefined
          ? round(input.health.projectedScore - input.health.verifiedScore)
          : null,
      }
    : { baseline: null, verified: null, projected: null, realizedLift: null, remainingLift: null };

  return {
    runLabel: input.runLabel,
    runId: input.runId ?? "",
    runState: input.runState,
    hasRun,
    snapshot,
    queue,
    activePhase,
    comprehendStatus,
    prioritizeStatus,
    remediateStatus,
    verifyStatus,
    approvalCount,
    heldCount,
    requiresApproval,
    requiresReview,
    mara,
    governance,
    health,
    liveHealthAvailable,
  };
}

function findPhase(snapshot: AgentWorkspaceSnapshot, id: CprPhaseId) {
  return snapshot.phases.find(phase => phase.id === id);
}

function mapPhaseState(phase?: { state: string }): PhaseStatus {
  if (!phase) return "unknown";
  const state = phase.state;
  if (state === "waiting" || state === "working" || state === "complete" || state === "blocked" || state === "approval_required") return state;
  return "unknown";
}

function deriveVerifyStatus(input: WorkspaceViewInput, queue: WorkQueueSummary): PhaseStatus {
  const verified = queue.items.filter(item => item.bucket === "verified").length;
  const needsVerification = queue.items.filter(item => item.bucket === "needs_verification").length;
  const hasVerifyLedger = input.timeline.some(event => {
    const text = `${event.name} ${event.reasoning}`.toLowerCase();
    return text.includes("verif") || text.includes("read-back") || event.step === 7;
  });
  if (needsVerification > 0) return "working";
  if (verified > 0) return "complete";
  if (hasVerifyLedger) return "complete";
  return "waiting";
}

function pickActivePhase(input: {
  comprehendStatus: PhaseStatus;
  prioritizeStatus: PhaseStatus;
  remediateStatus: PhaseStatus;
  verifyStatus: PhaseStatus;
  requiresApproval: boolean;
  hasRun: boolean;
}): WorkspacePhaseId {
  if (!input.hasRun) return "comprehend";
  if (input.requiresApproval || input.remediateStatus === "approval_required") return "remediate";
  if (input.verifyStatus === "working") return "verify";
  if (input.remediateStatus === "working" || input.remediateStatus === "blocked") return "remediate";
  if (input.prioritizeStatus === "working") return "prioritize";
  if (input.comprehendStatus === "working") return "comprehend";
  if (input.verifyStatus === "complete") return "verify";
  if (input.remediateStatus === "complete") return "verify";
  if (input.prioritizeStatus === "complete") return "remediate";
  if (input.comprehendStatus === "complete") return "prioritize";
  return "comprehend";
}

function deriveMaraView(input: {
  hasRun: boolean;
  runStateLower: string;
  analysisState?: string;
  apiState: ApiState;
  requiresApproval: boolean;
  approvalCount: number;
  heldCount: number;
  verifyStatus: PhaseStatus;
  snapshot: AgentWorkspaceSnapshot;
}): WorkspaceViewState["mara"] {
  if (!input.hasRun) return { state: "sleeping", primary: "Bring me an estate when you're ready." };

  const errored = input.analysisState === "error"
    || input.runStateLower === "failed" || input.runStateLower === "error"
    || (input.apiState === "error" && !isDraftRunState(input.runStateLower));
  if (errored) return {
    state: "error",
    primary: "Something interrupted the run. The existing evidence is still available.",
  };

  if (input.requiresApproval) return {
    state: "awaiting_approval",
    primary: input.approvalCount === 1
      ? "One authorization is waiting for a human decision."
      : `${input.approvalCount} authorizations are waiting for a human decision.`,
    secondary: "Each approval is scoped to one staged CI and one simulation fingerprint.",
  };

  if (input.heldCount > 0 && (isTerminalRunState(input.runStateLower) || !isDraftRunState(input.runStateLower))) {
    return {
      state: "warning",
      primary: input.heldCount === 1
        ? "1 record needs human attention."
        : `${input.heldCount} records need human attention.`,
    };
  }

  if (input.runStateLower === "complete" || input.runStateLower === "completed" || input.runStateLower === "committed" || input.verifyStatus === "complete") {
    return {
      state: "blooming",
      primary: input.verifyStatus === "complete"
        ? "The repair was verified through IRE."
        : "The run is complete and the evidence is preserved.",
    };
  }

  const isWorking = input.analysisState === "starting"
    || input.analysisState === "started"
    || (Boolean(input.runStateLower) && !isTerminalRunState(input.runStateLower) && !isDraftRunState(input.runStateLower))
    || input.apiState === "connecting";
  if (isWorking) return {
    state: "inspecting",
    primary: input.snapshot.activeAction || "The agents are inspecting this migration run.",
  };

  return { state: "sleeping", primary: "Waiting for the next backend signal." };
}

function deriveGovernance(input: {
  requiresApproval: boolean;
  requiresReview: boolean;
  approvalCount: number;
  heldCount: number;
  hasRun: boolean;
}): WorkspaceViewState["governance"] {
  if (!input.hasRun) return {
    title: "Governance idle",
    message: "Open a run to see whether Mara is waiting for authorization.",
    tone: "clear",
  };
  if (input.requiresApproval) return {
    title: input.approvalCount === 1 ? "Approval required" : `${input.approvalCount} approvals required`,
    message: "Authorize one IRE execution per staged CI. ServiceNow then executes and verifies automatically.",
    tone: "attention",
  };
  if (input.heldCount > 0) return {
    title: input.heldCount === 1 ? "1 record held for review" : `${input.heldCount} records held for review`,
    message: "Mara is holding these records until human review or a stronger identity signal arrives.",
    tone: "attention",
  };
  if (input.requiresReview) return {
    title: "Review queue open",
    message: "Findings are waiting for a review decision before Mara can advance them.",
    tone: "attention",
  };
  return {
    title: "No human action needed",
    message: "Mara can continue bounded, non-mutating work until the next policy boundary.",
    tone: "clear",
  };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
