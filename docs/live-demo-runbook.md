# Keystone Live End-to-End Demo Runbook

## Purpose

This runbook is the authoritative same-day path for demonstrating a real
ServiceNow-backed migration. It is not the fixture-only
`demo:approval-packet` flow. A successful live demo must show persisted
ServiceNow evidence for staging, simulation, approval, Phase D execution, and
correlated verification.

ServiceNow remains authoritative. Keystone never writes directly to
`cmdb_ci*` or `cmdb_rel_ci`, the browser never submits an executable payload,
and the approval-packet route never calls Execute or Verify. Existing Phase D
owns one IRE execution and one correlated verification per approved CI.

## Current live checkpoint — 2026-07-22

Migration run `DMR0001066`
(`31b134742b96875060aefba6b891bfcb`) currently shows:

| Evidence-backed state | Count |
|---|---:|
| Staged Linux server INSERT candidates | 50 |
| Correlated ServiceNow verification passed | 20 |
| Verified INSERT target CIs | 20 |
| Awaiting review in Agent Workspace | 14 |
| Ready for simulation | 16 |
| Executing | 0 |
| Blocked | 0 |

A GET-backed `plan-packet` check currently selects the next homogeneous slice
of 13 simulated Linux-server INSERT records. Planning is read-only. Packet
approval is disarmed until `CMDB_AGENT_APPROVAL_PACKET_HASH` is set to the
exact freshly prepared 64-character parent hash and the server is restarted.
Do not reuse an earlier hash: packet membership, fingerprints, and the
30-minute freshness boundary are part of the authorization.

The Agent Workspace `View completed results` control is presentation-only. It
truthfully presents the 20 verified records while leaving 30 records unchanged
in ServiceNow. It is not evidence that the full run completed.

## Preflight

Complete these checks before presenting:

1. Confirm `.env.local` points to the intended ServiceNow instance and contains
   only server-side credentials.
2. Leave `CMDB_AGENT_APPROVAL_PACKET_HASH` empty until the operator has reviewed
   and explicitly authorized the freshly prepared packet hash.
3. Start Keystone and open the intended run URL.
4. Confirm the header says `Live API`, shows run `DMR0001066`, and names the
   expected ServiceNow instance.
5. Refresh evidence and confirm there are no connectivity, authorization,
   configuration, or run-state errors.
6. Run the repository gates:

   ```text
   npm.cmd run smoke:agent-workspace
   npm.cmd run smoke:approval-packet
   npx tsc --noEmit --incremental false
   npm.cmd run lint
   npm.cmd run build
   ```

7. Keep the exact-hash authorization step separate from preparation. Never
   preauthorize a guessed or historical hash.

## Live demo sequence

### 1. Import and stage

- Import the chosen dataset into ServiceNow staging.
- Open the returned migration run.
- Explain that import targets quarantine/staging and performs no direct CMDB
  write.

### 2. Comprehend and prioritize

- Show the staged CI count, normalization, class and identity evidence,
  findings, and deterministic work groups.
- Show that current state reconstructs after refresh from ServiceNow resources
  and Event Ledger evidence.

### 3. Simulate eligible work

- In Remediate, use the bounded Agent Campaign flow for records that are ready
  to simulate.
- Simulation may run three-wide, but it remains non-mutating.
- Resolve only allowlisted retry groups. Missing identity, unsupported classes,
  exhausted retry budgets, and ambiguous evidence remain blocked.
- Continue until the intended homogeneous records have fresh completed
  simulations.

### 4. Plan and prepare one bounded packet

- Select `Plan packet`. Planning performs reads only.
- Review the homogeneous class and operation family, child manifests,
  exclusions, aggregate operation/risk counts, deterministic samples, and
  expiry.
- Select `Prepare packet`. Preparation may bind only missing deferred reviews;
  it does not approve, execute, verify, or initiate simulation.
- Copy the complete 64-character packet hash and note the expiry time.

### 5. Obtain exact authorization

- The operator must explicitly authorize the exact displayed packet hash and
  stated record scope.
- Set `CMDB_AGENT_APPROVAL_PACKET_HASH` to that exact uppercase hash on the
  Keystone server and restart the local server so the gate is armed.
- Refresh the prepared packet. If the hash, membership, fingerprint, identity,
  operation, policy, or freshness changed, stop and prepare a new packet.

### 6. Approve and observe Phase D

- Enter the complete packet hash in the confirmation field.
- Submit the single packet confirmation once.
- Keystone fans out individual approvals sequentially. ServiceNow still
  persists one auditable approval chain per CI.
- Continue after isolated record rejection. Stop on authorization,
  configuration, connectivity, or run-state failure.
- Never retry an ambiguous response blindly. Refresh and continue only when the
  exact persisted approval chain reconciles.
- Phase D, not the packet route, claims and performs each IRE execution and
  correlated verification.

### 7. Verify the real result

- Return to Agent Workspace and refresh evidence.
- Open Chapter 4, Verify.
- Show Mara's verification summary, verified operation counts, target CI count,
  class counts, blockers, and correlated ServiceNow read-back.
- Show baseline, verified-now, and projected health. When ServiceNow does not
  supply historical health fields, Keystone labels the progression as derived
  from staged CI health plus realized and remaining work-group lift.
- Repeat simulation, packet preparation, exact authorization, approval, and
  verification for additional homogeneous slices until the intended scope is
  terminal.

## Success criteria

A full 50-CI demonstration is complete only when live evidence reports:

- 50 verified records;
- 50 verified target CI bindings for this all-INSERT dataset;
- 0 awaiting approval;
- 0 ready to simulate;
- 0 executing;
- no unresolved blocker or reconciliation-required state; and
- refresh reconstructs the same terminal counts from ServiceNow evidence.

Healthy `NO_CHANGE` records in other datasets must be presented as reconciled
existing CIs, not as new inserts. Only verified `INSERT` and `UPDATE` outcomes
should be described as CMDB mutations.

## Stop conditions

Stop the live mutation path and preserve evidence when:

- the prepared packet is expired;
- the recomputed hash differs from the authorized hash;
- packet membership, identity evidence, operation, policy, or fingerprint
  drifts;
- ServiceNow authentication, role, connectivity, or run-state checks fail;
- an ambiguous response cannot be reconciled to the exact persisted chain; or
- the UI count disagrees with ServiceNow verification evidence.

The presentation-only completed-results view may still be used to explain the
verified subset, but it must disclose the number of deferred records and that
ServiceNow was not changed for them.

## Fixture fallback

If the live instance is unavailable, run `npm run demo:approval-packet`. That
isolated loopback fixture can demonstrate the 100-record packet UI and progress
reconstruction, but it must be introduced as a local fixture. It sends no
ServiceNow approval, Execute, Verify, or CMDB write.

## Known demo limitation

Past Summaries currently derives its operation totals from staged operations,
not exclusively from correlated verification outcomes. Do not use its
`Inserted` total as proof that every record was committed. Agent Workspace
Chapter 4 and Verify evidence are the authoritative demo surfaces until that
summary derivation is corrected.
