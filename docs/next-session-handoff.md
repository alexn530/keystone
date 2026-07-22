# Keystone Next-Session Handoff

## Current state

Milestones 5, 6, and 7 are complete. Phase E supports deterministic,
homogeneous campaigns of at most 20 staged CIs, simulation concurrency of
three, isolated failures, one allowlisted class-alias retry, frozen SHA-256
approval manifests, sequential individual ServiceNow approvals, and automatic
Phase D Execute/Verify continuation. Browser Execute and Verify routes are
status-only. ServiceNow and IRE retain all write authority.

The working contract and endpoint details are in `docs/cmdb-bridge-api.md`.
The product roadmap is in `docs/keystone-agentic-cmdb-prd.md`. Live evidence is
in `docs/lifecycle-acceptance-report.md`.

## Completed live acceptance

- Five distinct bounded INSERTs from run `065821a42b1e835060aefba6b891bf53`
  were individually approved, executed through server-owned Phase D, and
  correlated Verify passed for every target.
- Failure-loop run `DMR0001064`
  (`cdcdc8bc93d60b50410e383efaba105c`) proved the exact two-step alias contract.
- Event sequence 44 persisted `CLASS_ALIAS_RETRY_AVAILABLE` for staged CI
  `c1cdccbc93d60b50410e383efaba10b2`.
- Replaying the same idempotency key returned the same blocker without another
  ledger event.
- Event sequence 45 persisted `MISSING_IDENTITY` for staged CI
  `09cdccbc93d60b50410e383efaba10b3`.
- Campaign `2FDDC906DE059210B4F13701` consumed exactly one sequential retry using
  `normalize_known_class_alias` and `class-alias-v1`.
- Events 46–47 completed non-mutating INSERT simulation with `retry_count=1`
  and fingerprint
  `02C56D74BE1C7EDFEDB527BE33C316A31A2F6FD9CB4EACD8288D73DF9D547A9C`.
- The missing-identity CI remained blocked. That acceptance performed no
  approval, Execute, Verify, or CMDB write.

## Next objective: Milestone 8A — Bounded Approval Packets

The immediate product problem is approval volume. A 2,000-CI run can produce
100 separate 20-record manifests, which is operationally safer than bulk IRE
but still requires too many confirmations.

Implement a parent approval packet that:

1. Collects several fresh, frozen, homogeneous Phase E manifests.
2. Initially caps total membership at 100–200 records while retaining the
   20-record child-campaign limit.
3. Computes a canonical SHA-256 parent hash over versioned policy, run ID,
   ordered child manifest hashes, item counts, operation families, and expiry.
4. Shows aggregate operation/risk counts, blockers, exclusions, and sampled
   record evidence before confirmation.
5. Requires one explicit human confirmation naming the exact packet hash and
   scope.
6. Recomputes the packet and every child manifest immediately before fan-out.
7. Creates at most one individually auditable ServiceNow approval chain per CI.
8. Never calls Execute or Verify from the packet route; existing Phase D owns
   both actions and their correlation.
9. Halts on systemic failures, isolates record failures, and reconciles
   ambiguous outcomes from persisted evidence without blind retries.
10. Reconstructs all packet progress after refresh from ServiceNow evidence.

The AI may plan, group, prioritize, explain, simulate, and prepare this packet.
It must never approve the packet, approve individual records, call a
write-capable Execute endpoint, or directly write CMDB tables.

## Suggested implementation sequence

1. Add typed parent-packet, child-manifest, progress, exclusion, and aggregate
   summary contracts.
2. Add deterministic packet planning and hashing with unit/smoke coverage.
3. Add server-only packet actions for plan, prepare, approve, and status.
4. Add the approval-packet UI above the existing campaign drill-down.
5. Prove duplicate-click safety, manifest drift rejection, expiration,
   partial continuation, refresh reconstruction, and exact per-CI correlation.
6. Run GET-only planning and non-mutating simulations first, then stop for an
   explicit packet-specific live authorization before any approval fan-out.

## Required regression gates

Preserve Phase A 34/34, Phase B3A 23/23, Phase B3B 41/41, Phase C 48/48,
Phase D 32/32, campaign/queue/playback smoke suites, typecheck, lint, and the
production build. Do not add ServiceNow schema or a direct CMDB-write API by
default.
