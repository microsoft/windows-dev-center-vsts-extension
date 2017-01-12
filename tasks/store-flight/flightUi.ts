/**
 * Entry point for the Flight task. Gathers parameters and performs validation.
 */

import inputHelper = require('../common/inputHelper');
import request = require('../common/requestHelper');
import fli = require('./flight');

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

    var taskParams: fli.FlightParams = {
        appId: '',        
        appName: '',
        flightName: tl.getInput('flightName', true),
        authentication: credentials,
        endpoint: endpointUrl,
        force: tl.getBoolInput('force', true),
        zipFilePath: path.join(tl.getVariable('Agent.WorkFolder'), 'temp.zip'),
        packages: [],
        waiting: tl.getBoolInput('waiting', true)
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

    if (taskParams.packages.length == 0)
    {
        throw new Error(`At least one package must be provided`);
    }

    // App identification
    var nameType = tl.getInput('nameType', true);
    if (nameType == 'AppId')
    {
        (<fli.ParamsWithAppId>taskParams).appId = tl.getInput('appId', true);
    }
    else if (nameType == 'AppName')
    {
        (<fli.ParamsWithAppName>taskParams).appName = tl.getInput('appName', true);
    }
    else
    {
        throw new Error(`Invalid name type ${nameType}`);
    }

    return taskParams;
}

function dumpParams(taskParams: fli.FlightParams): void
{
    // We won't log the credentials, as they get masked by VSTS anyways.
    if (fli.hasAppId(taskParams))
    {
        tl.debug(`App ID: ${taskParams.appId}`);
    }
    else
    {
        tl.debug(`App name: ${taskParams.appName}`);
    }

    tl.debug(`Flight name: ${taskParams.flightName}`);
    tl.debug(`Force delete: ${taskParams.force}`);
    tl.debug(`Packages: ${taskParams.packages.join(',')}`);
    tl.debug(`Local ZIP file path: ${taskParams.zipFilePath}`);
    tl.debug(`Waiting: ${taskParams.waiting}`);
}

async function main()
{
    try
    {
        var taskParams: fli.FlightParams = gatherParams();
        dumpParams(taskParams);
        await fli.flightTask(taskParams);
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