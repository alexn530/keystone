(function process(request, response) {
    var body = request && request.body ? request.body.data : null;
    var result;

    try {
        result = new DotwalkersIreSimulationService().approve(body);
    } catch (ignored) {
        result = {
            success: false,
            http_status: 500,
            state: 'simulated_pending_approval',
            code: 'APPROVAL_FAILED',
            message: 'Approval could not be processed',
            retryable: false,
            cmdb_committed: false
        };
    }

    response.setStatus(result.http_status || (result.success ? 200 : 500));
    response.setBody(result);
})(request, response);