const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const action = fs.readFileSync(path.join(root, "servicenow/run_dotwalkers_mara.phase-c.js"), "utf8");
const comprehendAction = fs.readFileSync(path.join(root, "servicenow/run_dotwalkers_comprehend.cpr.js"), "utf8");
const comprehendResource = fs.readFileSync(path.join(root, "servicenow/comprehend.cpr.js"), "utf8");
const RUN = "11111111111111111111111111111111";
const APPROVAL = "22222222222222222222222222222222";

function execute(parm2, options = {}) {
  const calls = { supervise: 0, service: 0, claim: 0, prepare: 0, prepared: 0, continue: 0, failed: 0 };
  function DotwalkersMaraAgent() {}
  DotwalkersMaraAgent.prototype.run = function run(runId) {
    calls.supervise++;
    assert.equal(runId, RUN);
    return options.supervisionResult ?? { success: true };
  };
  DotwalkersMaraAgent.prototype.prepareApprovalResume = function prepare(binding) {
    calls.prepare++;
    return { success: true, binding };
  };
  DotwalkersMaraAgent.prototype.continueApprovalResume = function continueApproval(prepared) {
    calls.continue++;
    assert.equal(prepared.success, true);
    return { success: true };
  };

  function DotwalkersIreSimulationService() { calls.service++; }
  DotwalkersIreSimulationService.prototype.validateAndClaimApprovalResume = function validate(runId, approvalId) {
    calls.claim++;
    assert.equal(runId, RUN);
    assert.equal(approvalId, APPROVAL);
    return { success: true, claimed: true, binding: { migration_run_id: RUN }, claim_event_id: "claim" };
  };
  DotwalkersIreSimulationService.prototype.recordApprovalResumePrepared = function recordPrepared() {
    calls.prepared++;
    return true;
  };
  DotwalkersIreSimulationService.prototype.recordApprovalResumeFailure = function recordFailure() {
    calls.failed++;
    return true;
  };

  vm.runInNewContext(action, {
    event: { parm1: RUN, parm2 },
    DotwalkersMaraAgent,
    DotwalkersIreSimulationService,
    gs: { info() {}, error() {} },
    String,
    Error,
  });
  return calls;
}

const comprehend = execute("comprehend_complete");
assert.deepEqual(comprehend, {
  supervise: 1, service: 0, claim: 0, prepare: 0, prepared: 0, continue: 0, failed: 0,
});

const recovery = execute("mara_recovery");
assert.equal(recovery.supervise, 1);
assert.equal(recovery.service, 0);

const approval = execute(APPROVAL);
assert.deepEqual(approval, {
  supervise: 0, service: 1, claim: 1, prepare: 1, prepared: 1, continue: 1, failed: 0,
});

const unknown = execute("untrusted_mode");
assert.deepEqual(unknown, {
  supervise: 0, service: 0, claim: 0, prepare: 0, prepared: 0, continue: 0, failed: 0,
});

assert.match(comprehendAction, /state === 'analyzing' && hasCompletedComprehend\(\)/);
assert.match(comprehendAction, /'x_kest_dotwalkers\.mara\.requested'/);
assert.match(comprehendAction, /'mara_recovery'/);
assert.ok(
  comprehendAction.indexOf("hasCompletedComprehend()") < comprehendAction.indexOf("new DotwalkersComprehendAgent().run(runId)"),
  "persisted completion must be checked before Comprehend can run again",
);
assert.equal(
  (comprehendAction.match(/new DotwalkersComprehendAgent\(\)\.run\(runId\)/g) || []).length,
  1,
  "Comprehend has one execution site",
);
assert.match(comprehendResource, /currentState === 'analyzing' && comprehendCompleted/);
assert.match(comprehendResource, /gs\.eventQueue\(MARA_EVENT, run, runId, 'mara_recovery'\)/);
assert.equal(comprehendResource.includes("new DotwalkersComprehendAgent"), false, "REST resource must remain an event-only adapter");
for (const forbidden of ["body.payload", "body.operation", "body.class", "body.mapping", "body.target_ci", "body.decision"]) {
  assert.equal(comprehendResource.includes(forbidden), false, `Comprehend recovery accepts executable field ${forbidden}`);
}

console.log("ServiceNow CPR handoff smoke checks passed (Comprehend -> Mara -> Prioritize and approval continuation isolated).\n");
