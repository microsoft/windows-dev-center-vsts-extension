/**
 * Entry point for the Flight task. Gathers parameters and performs validation.
 */

import request = require('../common/requestHelper');
import fli = require('./flight');

import path = require('path');

import tl = require('vsts-task-lib');

function gatherParams()
{
    var credentials: request.Credentials;
    var endpointId = tl.getInput('serviceEndpoint', true);

    /* Contrary to the other tl.get* functions, the boolean param here
        indicates whether the parameter is __optional__ */
    var endpointAuth = tl.getEndpointAuthorization(endpointId, false);
    credentials =
        {
            tenant: endpointAuth.parameters['tenantId'],
            clientId: endpointAuth.parameters['servicePrincipalId'],
            clientSecret: endpointAuth.parameters['servicePrincipalKey']
        };

    var endpointUrl: string = endpointAuth.parameters['url'];
    if (endpointUrl.lastIndexOf('/') == endpointUrl.length - 1)
    {
        endpointUrl = endpointUrl.substring(0, endpointUrl.length - 1);
    }

    var taskParams: fli.FlightParams = {
        appName: '',
        flightName: tl.getInput('flightName', true),
        authentication: credentials,
        endpoint: endpointUrl,
        force: tl.getBoolInput('force', true),
        zipFilePath: path.join(tl.getVariable('Agent.WorkFolder'), 'temp.zip'),
        packages: []
    };

    // Packages
    var packages: string[] = [];
    if (inputFilePathSupplied('packagePath', false))
    {
        packages.push(tl.getInput('packagePath', false));
    }
    packages = packages.concat(tl.getDelimitedInput('additionalPackages', '\n', false));
    taskParams.packages = packages.filter(p => p.trim().length != 0);

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

function inputFilePathSupplied(name: string, required: boolean): boolean
{
    var path = tl.getInput(name, required);
    return path != tl.getVariable('Agent.ReleaseDirectory');
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