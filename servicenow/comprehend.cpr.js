(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
    var TEAM = 'THE_DOTWALKERS';
    var RUN_TABLE = 'x_kest_dotwalkers_migration_run';
    var CI_TABLE = 'x_kest_dotwalkers_staged_ci_record';
    var LEDGER_TABLE = 'x_kest_dotwalkers_event_ledger';
    var COMPREHEND_EVENT = 'x_kest_dotwalkers.comprehend.requested';
    var MARA_EVENT = 'x_kest_dotwalkers.mara.requested';
    var run = null;

    function send(status, payload) {
        response.setStatus(status);
        response.setHeader('Content-Type', 'application/json');
        return payload;
    }

    function isSysId(value) {
        return /^[0-9a-f]{32}$/i.test(String(value || '').trim());
    }

    function isCompletedState(state) {
        return [
            'awaiting_approval', 'simulated', 'approved', 'committed',
            'complete', 'completed'
        ].indexOf(String(state || '')) > -1;
    }

    function hasCompletedComprehend(runId) {
        var ledger = new GlideRecord(LEDGER_TABLE);
        ledger.addQuery('migration_run', runId);
        if (ledger.isValidField('team_prefix')) ledger.addQuery('team_prefix', TEAM);
        ledger.addQuery('actor', 'Comprehend');
        ledger.addQuery('event_type', 'analyzed');
        var completion = ledger.addQuery('detail', 'STARTSWITH', 'Analysis completed.');
        completion.addOrCondition('detail', 'STARTSWITH', 'Deterministic specialist sequence completed.');
        ledger.setLimit(1);
        ledger.query();
        return ledger.hasNext();
    }

    function stagedCiCount(runId) {
        var aggregate = new GlideAggregate(CI_TABLE);
        aggregate.addQuery('migration_run', runId);
        if (aggregate.isValidField('team_prefix')) aggregate.addQuery('team_prefix', TEAM);
        aggregate.addAggregate('COUNT');
        aggregate.query();
        if (!aggregate.next()) return 0;
        return parseInt(aggregate.getAggregate('COUNT'), 10) || 0;
    }

    function markFailed(message) {
        if (!run || !run.isValidRecord()) return;
        try {
            if (run.isValidField('state')) {
                run.setValue('state', 'failed');
                run.update();
            }
            new DotwalkersAgentSupport(run.getUniqueValue()).log(
                'error',
                'Comprehend',
                String(message || '').substring(0, 3900)
            );
        } catch (secondaryError) {
            gs.error('[DOTWALKERS_COMPREHEND_API] Failure cleanup error.');
        }
    }

    try {
        var body = request.body && request.body.data ? request.body.data : {};
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (parseError) {
                return send(400, { success: false, error: 'Request body must contain valid JSON.' });
            }
        }

        var runId = String(body.migration_run_id || body.run_id || '').trim();
        if (!isSysId(runId)) {
            return send(400, { success: false, error: 'migration_run_id must be a valid 32-character sys_id.' });
        }

        run = new GlideRecord(RUN_TABLE);
        if (!run.get(runId)) {
            return send(404, { success: false, migration_run_id: runId, error: 'Migration Run was not found.' });
        }
        if (run.isValidField('team_prefix') && String(run.getValue('team_prefix') || '') !== TEAM) {
            return send(403, { success: false, migration_run_id: runId, error: 'Migration Run does not belong to THE_DOTWALKERS.' });
        }
        if (typeof run.canWrite === 'function' && !run.canWrite()) {
            return send(403, { success: false, migration_run_id: runId, error: 'The authenticated user cannot update this Migration Run.' });
        }

        var currentState = String(run.getValue('state') || '');
        var comprehendCompleted = hasCompletedComprehend(runId);

        /*
         * Recover only the missing asynchronous handoff. The request still
         * carries one run id; no browser-owned class, payload, mapping,
         * operation, approval, or target value crosses this boundary.
         */
        if (currentState === 'analyzing' && comprehendCompleted) {
            gs.eventQueue(MARA_EVENT, run, runId, 'mara_recovery');
            new DotwalkersAgentSupport(runId).log(
                'analyzed',
                'Comprehend',
                'Handoff recovery queued. Completed Comprehend evidence will be reused; analysis will not run again.'
            );
            return send(202, {
                success: true,
                accepted: true,
                recovery: true,
                migration_run_id: runId,
                state: currentState,
                message: 'Mara recovery was queued from completed Comprehend evidence.'
            });
        }

        if (comprehendCompleted || isCompletedState(currentState)) {
            return send(200, {
                success: true,
                accepted: false,
                already_completed: true,
                migration_run_id: runId,
                state: currentState,
                message: 'Comprehend has already completed for this run.'
            });
        }
        if (currentState === 'analyzing') {
            return send(409, {
                success: true,
                accepted: false,
                already_running: true,
                migration_run_id: runId,
                state: currentState,
                message: 'Comprehend is already running for this migration run.'
            });
        }
        if (currentState === 'failed') {
            return send(409, {
                success: false,
                accepted: false,
                migration_run_id: runId,
                state: currentState,
                error: 'The migration run is failed. Reset or investigate it before retrying.'
            });
        }
        if (currentState !== 'draft') {
            return send(409, {
                success: false,
                accepted: false,
                migration_run_id: runId,
                state: currentState,
                error: 'Comprehend cannot start from state: ' + currentState
            });
        }

        var ciCount = stagedCiCount(runId);
        if (ciCount < 1) {
            return send(409, {
                success: false,
                accepted: false,
                migration_run_id: runId,
                state: currentState,
                staged_ci_count: 0,
                error: 'This migration run contains no staged CI records.'
            });
        }

        run.setValue('state', 'analyzing');
        if (!run.update()) {
            return send(500, {
                success: false,
                migration_run_id: runId,
                error: 'Could not reserve the migration run for analysis.'
            });
        }

        var suppliedCorrelationId = String(body.correlation_id || '').trim();
        var correlationId = suppliedCorrelationId || ('ks-comprehend-' + gs.generateGUID());
        gs.eventQueue(COMPREHEND_EVENT, run, runId, correlationId);
        gs.info('[DOTWALKERS_COMPREHEND_API] Queued Comprehend for run=' + runId);
        return send(202, {
            success: true,
            accepted: true,
            migration_run_id: runId,
            correlation_id: correlationId,
            state: 'analyzing',
            staged_ci_count: ciCount,
            message: 'Comprehend analysis was queued.'
        });
    } catch (error) {
        var message = error && error.message ? error.message : String(error);
        markFailed('Comprehend API failed before execution: ' + message);
        gs.error('[DOTWALKERS_COMPREHEND_API] ' + message);
        return send(500, {
            success: false,
            error: 'Unable to queue Comprehend analysis.',
            detail: message
        });
    }
})(request, response);
