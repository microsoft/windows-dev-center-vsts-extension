/**
 * Entry point for the Publish task. Gathers parameters and performs validation.
 */

import inputHelper = require('../common/inputHelper');
import request = require('../common/requestHelper');
import pub = require('./publish');

import path = require('path');

import tl = require('vsts-task-lib');

/** Obtain and validate parameters from task UI. */
function gatherParams()
{
    var credentials: request.Credentials;
    var endpointId = tl.getInput('serviceEndpoint', true);

    /* Contrary to the other tl.get* functions, the boolean param here
        indicates whether the parameter is __optional__ */
    var endpointAuth = tl.getEndpointAuthorization(endpointId, false);
    credentials = 
    {
        tenant : endpointAuth.parameters['tenantId'],
        clientId : endpointAuth.parameters['servicePrincipalId'],
        clientSecret : endpointAuth.parameters['servicePrincipalKey']
    };

    var endpointUrl: string = endpointAuth.parameters['url'];
    if (endpointUrl.lastIndexOf('/') == endpointUrl.length - 1)
    {
        endpointUrl = endpointUrl.substring(0, endpointUrl.length - 1);
    }

    var taskParams: pub.PublishParams = {
        appName : '',
        authentication : credentials,
        endpoint : endpointUrl,
        force : tl.getBoolInput('force', true),
        metadataUpdateType: pub.MetadataUpdateType[<string>tl.getInput('metadataUpdateMethod', true)],
        updateImages: tl.getBoolInput('updateImages', false),
        zipFilePath : path.join(tl.getVariable('Agent.WorkFolder'), 'temp.zip'),
        packages : []
    };

    // Packages
    var packages: string[] = [];
    if (inputHelper.inputFilePathSupplied('packagePath', false))
    {
        packages = packages.concat(inputHelper.resolvePathPattern(tl.getInput('packagePath', false)));
    }
    var additionalPackages = tl.getDelimitedInput('additionalPackages', '\n', false);
    additionalPackages.forEach(packageInput =>
        {
            packages = packages.concat(inputHelper.resolvePathPattern(packageInput));
        }
    )

    taskParams.packages = packages.map(p => p.trim()).filter(p => p.length != 0);

    // App identification
    var nameType = tl.getInput('nameType', true);
    if (nameType == 'AppId')
    {
        (<pub.ParamsWithAppId>taskParams).appId = tl.getInput('appId', true);
    }
    else if (nameType == 'AppName')
    {
        (<pub.ParamsWithAppName>taskParams).appName = tl.getInput('appName', true);
    }
    else
    {
        throw new Error(`Invalid name type ${nameType}`);
    }

    taskParams.metadataRoot = inputHelper.canonicalizePath(tl.getPathInput('metadataPath', false, true));

    return taskParams;
}

function dumpParams(taskParams: pub.PublishParams): void
{
    // We won't log the credentials, as they get masked by VSTS anyways.
    if (pub.hasAppId(taskParams))
    {
        tl.debug(`App ID: ${taskParams.appId}`);
    }
    else
    {
        tl.debug(`App name: ${taskParams.appName}`);
    }

    tl.debug(`Endpoint: ${taskParams.endpoint}`);
    tl.debug(`Force delete: ${taskParams.force}`);
    tl.debug(`Metadata update type: ${taskParams.metadataUpdateType}`);
    tl.debug(`Update images: ${taskParams.updateImages}`);
    tl.debug(`Metadata root: ${taskParams.metadataRoot}`);
    tl.debug(`Packages: ${taskParams.packages.join(',')}`);
}

async function main()
{
    try
    {
        var taskParams: pub.PublishParams = gatherParams();
        dumpParams(taskParams);
        await pub.publishTask(taskParams);
    }
    catch (err)
    {
        if (err.stack != undefined)
        {
            tl.error(err.stack);
        }

        // This will also log the error for us.
        tl.setResult(tl.TaskResult.Failed, err);
    }
}

main();