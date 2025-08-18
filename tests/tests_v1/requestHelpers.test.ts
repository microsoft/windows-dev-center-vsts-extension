import requestHelpers = require('../../tasks/common/requestHelper');

// Test function performAuthenticatedRequest
test('performAuthenticatedRequest', async () => {
    const cred: requestHelpers.Credentials = {
        tenant: "",
        clientId: "",
        clientSecret: ""
    }

    const tok: requestHelpers.AccessToken = {
        resource: "",
        credentials: cred,
        expiration: Date.now(),
        token: "<<Replace this with any test token>>"
     };

    var requestParams = {
        url: '<<Replace this with any test URL>>',
        method: 'GET',
        headers: {}
    };

    console.log("Begin running performAuthenticatedRequest");

    var response = await requestHelpers.performAuthenticatedRequest<any>(tok, requestParams);
    // Depending on the API request you are testing you can add what you expect from the response.
    // e.g. expect(response).toEqual({ success: true });
});

// Test function performAuthenticatedRequestWithRetry
test('performAuthenticatedRequestWithRetry', async () => {
    const cred: requestHelpers.Credentials = {
        tenant: "",
        clientId: "",
        clientSecret: ""
    }

    const tok: requestHelpers.AccessToken = {
        resource: "",
        credentials: cred,
        expiration: Date.now(),
        token: "<<Replace this with any test token>>"
     };

    var requestParams = {
        url: '<<Replace this with any test URL>>',
        method: 'GET',
        headers: {}
    };

    console.log("Begin running performAuthenticatedRequest");

    var getGenerator = () => requestHelpers.performAuthenticatedRequest<any>(tok, requestParams);
    var response = await requestHelpers.withRetry(3, getGenerator, err => requestHelpers.isRetryableError(err));
    // Depending on the API request you are testing you can add what you expect from the response.
    // e.g. expect(response).toEqual({ success: true });
});