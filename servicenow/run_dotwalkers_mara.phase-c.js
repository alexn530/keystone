(function executeDotwalkersMara() {
    var runId = String(event.parm1 || '').trim();
    var continuationToken = String(event.parm2 || '').trim();

    function isSysId(value) {
        return /^[0-9a-f]{32}$/i.test(String(value || ''));
    }

    /*
     * This registered event is shared deliberately:
     *
     * - Comprehend queues `comprehend_complete` to start the normal Mara
     *   supervisor. Mara then owns the deterministic Prioritize handoff.
     * - Phase C queues a canonical approval Event Ledger sys_id to resume the
     *   fingerprint-bound Phase D Execute + Verify continuation.
     *
     * Dispatch before constructing the approval service. Treating a normal
     * Comprehend token as an approval id strands the run in `analyzing`.
     */
    if (continuationToken === 'comprehend_complete' ||
        continuationToken === 'mara_recovery') {
        try {
            if (!isSysId(runId)) {
                throw new Error('Migration Run sys_id is invalid');
            }

            var supervised = new DotwalkersMaraAgent().run(runId);
            if (!supervised || supervised.success !== true) {
                gs.error('Dotwalkers Mara supervision stopped safely.');
                return;
            }

            gs.info('Dotwalkers Mara supervision completed; Prioritize handoff is owned by Mara.');
        } catch (ignoredSupervisionFailure) {
            gs.error('Dotwalkers Mara supervision failed safely.');
        }
        return;
    }

    if (!isSysId(runId) || !isSysId(continuationToken)) {
        gs.error('Dotwalkers Mara event rejected: unsupported continuation token.');
        return;
    }

    var approvalEventId = continuationToken;
    var service = new DotwalkersIreSimulationService();
    var claim;

    try {
        claim = service.validateAndClaimApprovalResume(runId, approvalEventId);
    } catch (ignoredValidationFailure) {
        gs.error('Dotwalkers Mara approval resume rejected safely.');
        return;
    }

    if (!claim || claim.success !== true || claim.claimed !== true) {
        gs.info('Dotwalkers Mara approval resume stopped: ' +
            (claim && claim.state ? claim.state : 'invalid_token'));
        return;
    }

    try {
        var prepared = new DotwalkersMaraAgent().prepareApprovalResume(claim.binding);
        if (!prepared || prepared.success !== true) {
            throw new Error('Preparation did not complete');
        }

        if (!service.recordApprovalResumePrepared(claim.binding, claim.claim_event_id)) {
            throw new Error('Prepared marker was not recorded');
        }
        gs.info('Dotwalkers Mara approval continuation prepared.');
    } catch (ignoredPreparationFailure) {
        try {
            service.recordApprovalResumeFailure(claim.binding, claim.claim_event_id);
        } catch (ignoredFailureRecording) {
            gs.error('Dotwalkers Mara preparation failed and its compact marker could not be recorded.');
            return;
        }
        gs.error('Dotwalkers Mara approval continuation preparation failed safely.');
        return;
    }

    try {
        var continuation = new DotwalkersMaraAgent().continueApprovalResume(prepared);
        if (!continuation || continuation.success !== true) {
            gs.error('Dotwalkers Mara Phase D continuation stopped safely.');
            return;
        }
        gs.info('Dotwalkers Mara Phase D continuation reached its terminal verification state.');
    } catch (ignoredContinuationFailure) {
        gs.error('Dotwalkers Mara Phase D continuation stopped safely.');
    }
})();
