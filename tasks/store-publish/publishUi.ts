/**
 * Entry point for the Publish task. Gathers parameters and performs validation.
 */

import api = require('./apiWrapper');
import pub = require('./publish');

import fs = require('fs');
import path = require('path');

import tl = require('vsts-task-lib');

/** Obtain and validate parameters from task UI. */
function gatherParams()
{
    var credentials: api.Credentials;
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

    var endpointUrl: string = tl.getEndpointUrl(endpointId, false);

    var taskParams: pub.PublishParams = {
        appName : '',
        authentication : credentials,
        endpoint : endpointUrl,
        force : tl.getBoolInput('force', true),
        metadataUpdateType : pub.MetadataUpdateType[<string>tl.getInput('metadataUpdateMethod', true)],
        zipFilePath : path.join(tl.getVariable('Agent.WorkFolder'), 'temp.zip'),
        packages : []
    };

    // Packages
    var packages: string[] = [];
    packages.push(getPathInputAsFile('packagePath', false));
    packages = packages.concat(tl.getDelimitedInput('additionalPackages', '\n', false));
    taskParams.packages = packages;

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

    taskParams.metadataRoot = canonicalizePath(tl.getPathInput('metadataPath', false, true));


    return taskParams;
}


/**
 * Creates a canonical version of a path. Separators are converted to the current platform,
 * '.'.and '..' segments are resolved, and multiple contiguous separators are combined in one.
 * If a path contains both kinds of separators, it will be parsed as a posix path (with '/' separators).
 * 
 * For example, the paths 'foo//bar/../quux.txt' and 'foo\\.\\quux.txt' should have the same canonical
 * representation.
 *
 * This function should be idempotent: canonicalizePath(canonicalizePath(x)) === canonicalizePath(x))
 * @param aPath
 */
function canonicalizePath(aPath: string): string
{
    var pathObj: path.ParsedPath;
    if (aPath.indexOf('/') != -1)
    {
        pathObj = path.posix.parse(aPath);
    }
    else
    {
        pathObj = path.win32.parse(aPath);
    }

    return path.normalize(path.format(pathObj));
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
        tl.debug(`App ID: ${taskParams.appName}`);
    }

    tl.debug(`Endpoint: ${taskParams.endpoint}`);
    tl.debug(`Force delete: ${taskParams.force}`);
    tl.debug(`Metadata update type: ${taskParams.metadataUpdateType}`);
    tl.debug(`Metadata root: ${taskParams.metadataRoot}`);
    tl.debug(`Packages: ${taskParams.packages.join(',')}`);
}

/**
 * Gets the value of a path input, and additionally checks that the path is a file. The task
 * fails if the path was not supplied, or if the supplied path is not an existing file.
 */
function getPathInputAsFile(name: string, required: boolean): string
{
    var filePath = tl.getPathInput(name, required, false);

    // It's an error if the file was required and stat failed (stat will fail if the path is empty)
    if (required && !fs.exists(filePath))
    {
        throw new Error('Parameter error for "' + name + '": cannot access path "' + filePath + '"');
    }

    // It's an error if the path is not empty but also not a file.
    if (filePath && !fs.statSync(filePath).isFile())
    {
        throw new Error('Parameter error for "' + name + '": path "' + filePath + '" is not a file');
    }

    return filePath;
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
        tl.error(err);
        tl.error(err.stack);
        tl.setResult(tl.TaskResult.Failed, err);
    }
}

main();