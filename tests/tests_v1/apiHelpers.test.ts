import apiHelpers = require('../../tasks/common/apiHelper');
import request = require('../../tasks/common/requestHelper');

var submissionId;

test('getAppResource', async () => {
    const token: request.AccessToken = {
        resource: "",
        credentials: {
            tenant: "",
            clientId: "",
            clientSecret: ""
        },
        expiration: Date.now(),
        token: "XXXX"
    };

    apiHelpers.ROOT = "https://manage.devcenter.microsoft.com/v1.0/my/";
    const result = await apiHelpers.getAppResource(token, "9N1XVXWJ30RV");
    expect(result).toBeDefined();
    console.log ("Run getAppResource successfully with result:", result);
}, 100000);

test('createSubmission', async () => {
    const token: request.AccessToken = {
        resource: "",
        credentials: {
            tenant: "",
            clientId: "",
            clientSecret: ""
        },
        expiration: Date.now(),
        token: "XXXX"
    };

    var URL = "https://manage.devcenter.microsoft.com/v1.0/my/applications/9N1XVXWJ30RV/submissions";
    const result = await apiHelpers.createSubmission(token, URL);
    submissionId = result.id;
    expect(result).toBeDefined();
    console.log ("Run createSubmission successfully with result:", result);
}, 100000);

test('checkSubmissionStatus', async () => {
    const token: request.AccessToken = {
        resource: "",
        credentials: {
            tenant: "",
            clientId: "",
            clientSecret: ""
        },
        expiration: Date.now(),
        token: "XXXX"
    };

    apiHelpers.ROOT = "https://manage.devcenter.microsoft.com/v1.0/my/";
    var resourceLocation = `applications/9N1XVXWJ30RV/submissions/1152921505699754749`;
    const result = await apiHelpers.checkSubmissionStatus(token, resourceLocation, 'Immediate');
    expect(result).toBeDefined();
    console.log ("Run checkSubmissionStatus successfully with result:", result);
}, 100000);

test('deleteSubmission', async () => {
    const token: request.AccessToken = {
        resource: "",
        credentials: {
            tenant: "",
            clientId: "",
            clientSecret: ""
        },
        expiration: Date.now(),
        token: "XXXX"
    };

    var URL = `https://manage.devcenter.microsoft.com/v1.0/my/applications/9N1XVXWJ30RV/submissions/1152921505699754749`;
    const result = await apiHelpers.deleteSubmission(token, URL);
    expect(result).toBeDefined();
    console.log ("Run deleteSubmission successfully with result:", result);
}, 100000);