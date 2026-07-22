(function executeComprehendEvent() {
    var TEAM = 'THE_DOTWALKERS';
    var RUN_TABLE = 'x_kest_dotwalkers_migration_run';
    var LEDGER_TABLE = 'x_kest_dotwalkers_event_ledger';
    var runId = String(event.parm1 || '').trim();
    var correlationId = String(event.parm2 || '').trim();

    function isSysId(value) {
        return /^[0-9a-f]{32}$/i.test(String(value || ''));
    }

    function isCompletedState(state) {
        return [
            'awaiting_approval', 'simulated', 'approved', 'committed',
            'complete', 'completed'
        ].indexOf(String(state || '')) > -1;
    }

    function hasCompletedComprehend() {
        var ledger = new GlideRecord(LEDGER_TABLE);
        ledger.addQuery('migration_run', runId);
        ledger.addQuery('team_prefix', TEAM);
        ledger.addQuery('actor', 'Comprehend');
        var completion = ledger.addQuery('detail', 'STARTSWITH', 'Analysis completed.');
        completion.addOrCondition('detail', 'STARTSWITH', 'Deterministic specialist sequence completed.');
        ledger.setLimit(1);
        ledger.query();
        return ledger.hasNext();
    }

    function queueMaraRecovery(runRecord) {
        gs.eventQueue(
            'x_kest_dotwalkers.mara.requested',
            runRecord,
            runId,
            'mara_recovery'
        );
        new DotwalkersAgentSupport(runId).log(
            'analyzed',
            'Comprehend',
            'Handoff recovery queued. Completed Comprehend evidence will be reused; analysis will not run again.'
        );
        gs.info('[RUN_DOTWALKERS_COMPREHEND] Mara recovery queued for run=' + runId);
    }

    function recordFailure(message) {
        try {
            var support = new DotwalkersAgentSupport(runId);
            support.setRunState('failed');
            support.log(
                'error',
                'Comprehend',
                ('Queued Comprehend execution failed. Correlation: ' +
                    correlationId + '. ' + message).substring(0, 3900)
            );
        } catch (secondaryError) {
            gs.error('[RUN_DOTWALKERS_COMPREHEND] Could not record failure safely.');
        }
    }

    try {
        if (!isSysId(runId)) {
            throw new Error('event.parm1 is not a valid Migration Run sys_id.');
        }

        var run = new GlideRecord(RUN_TABLE);
        run.addQuery('sys_id', runId);
        if (run.isValidField('team_prefix')) run.addQuery('team_prefix', TEAM);
        run.query();
        if (!run.next()) {
            throw new Error('Migration Run was not found or belongs to another team.');
        }

        var state = String(run.getValue('state') || '');
        if (isCompletedState(state)) {
            gs.info('[RUN_DOTWALKERS_COMPREHEND] Duplicate event skipped for run=' + runId);
            return;
        }
        if (state !== 'draft' && state !== 'analyzing') {
            throw new Error('Comprehend cannot execute from state: ' + state);
        }

        /*
         * A completed analysis plus `analyzing` means the async CPR handoff
         * was lost. Resume at Mara; never rerun Comprehend or duplicate its
         * findings. Mara and Prioritize retain their own idempotency guards.
         */
        if (state === 'analyzing' && hasCompletedComprehend()) {
            queueMaraRecovery(run);
            return;
        }

        var result = new DotwalkersComprehendAgent().run(runId);
        if (!result || result.success !== true) {
            run.get(runId);
            if (isCompletedState(String(run.getValue('state') || ''))) return;
            throw new Error(result && result.error ? result.error : 'Comprehend did not complete');
        }

        gs.info(
            '[RUN_DOTWALKERS_COMPREHEND] Comprehend completed successfully. run=' +
            runId + ' | correlation_id=' + correlationId
        );
    } catch (error) {
        var message = error && error.message ? error.message : String(error);
        recordFailure(message);
        gs.error(
            '[RUN_DOTWALKERS_COMPREHEND] run=' + runId +
            ' | correlation_id=' + correlationId + ' | error=' + message
        );
    }
})();
