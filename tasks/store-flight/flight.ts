/*
 * Behavior for the Publish task. Takes authentication information, app information, and packages,
 * and flights to the Store.
 */

/// <reference path="../../typings/index.d.ts" />
/// <reference path="../../node_modules/vsts-task-lib/task.d.ts" />

import api = require('../common/apiHelper');
import request = require('../common/requestHelper');

import Q = require('q');
import tl = require('vsts-task-lib');

/** Core parameters for the flight task. */
export interface CoreFlightParams
{
    flightName: string;

    // Same parameters as the publish task
    endpoint: string;
    authentication: request.Credentials;
    force: boolean;
    packages: string[];
    zipFilePath: string;
}

export interface AppIdParam
{
    appId: string;
}

export interface AppNameParam
{
    appName: string;
}

export type ParamsWithAppId = AppIdParam & CoreFlightParams;
export type ParamsWithAppName = AppNameParam & CoreFlightParams;
export type FlightParams = ParamsWithAppId | ParamsWithAppName;

/**
 * Type guard: indicates whether these parameters contain an App Id or not.
 */
export function hasAppId(p: FlightParams): p is ParamsWithAppId
{
    return (<ParamsWithAppId>p).appId != undefined;
}

/**
 * The parameters given to the task. They're declared here to be
 * available to every step of the task without explicitly threading them through.
 */
var taskParams: FlightParams;

/** The current token used for authentication. */
var currentToken: request.AccessToken;

var appId: string;
var flightId: string;

export async function flightTask(params: FlightParams)
{
    taskParams = params;

    api.ROOT = taskParams.endpoint + api.API_URL_VERSION_PART;

    console.log('Authenticating...');
    currentToken = await request.authenticate(taskParams.endpoint, taskParams.authentication);

    if (hasAppId(taskParams))
    {
        appId = taskParams.appId;
    }
    else
    {
        console.log(`Obtaining app ID for name ${taskParams.appName}...`);
        appId = await api.getAppIdByName(currentToken, taskParams.appName);
    }

    console.log(`Obtaining flight resource for flight ${taskParams.flightName} in app ${appId}`);
    var flightResource = await getFlightResource(taskParams.flightName);
    flightId = flightResource.flightId;


    if (taskParams.force && flightResource.pendingFlightSubmission != undefined)
    {
        console.log('Deleting existing flight submission...');
        await deleteFlightSubmission(flightResource.pendingFlightSubmission.resourceLocation);
    }

    console.log('Creating flight submission...');
    var flightSubmissionResource = await createFlightSubmission();

    console.log('Updating flight submission...');
    await putFlightSubmission(flightSubmissionResource);

    console.log('Creating zip file...');
    var zip = api.createZipFromPackages(taskParams.packages);
    if (Object.keys(zip.files).length > 0)
    {
        await api.persistZip(zip, taskParams.zipFilePath, flightSubmissionResource.flieUploadUrl);
    }

    console.log('Committing flight submission...');
    await commitFlightSubmission(flightSubmissionResource.id);

    console.log('Polling flight submission...');
    var resourceLocation = `applications/${appId}/flights/${flightId}/submissions/${flightSubmissionResource.id}`;
    await api.pollSubmissionStatus(currentToken, resourceLocation, flightSubmissionResource.targetPublishMode);

    tl.setResult(tl.TaskResult.Succeeded, 'Flight submission completed');

}

function getFlightResource(flightName: string, currentPage?: string): Q.Promise<any>
{
    if (currentPage === undefined)
    {
        currentPage = `applications/${appId}/listflights`;
    }

    tl.debug(`\tSearching for flight ${flightName} on ${currentPage}`);

    var requestParams = {
        url: api.ROOT + currentPage,
        method: 'GET'
    };

    return request.performAuthenticatedRequest<any>(currentToken, requestParams).then(body =>
    {
        var foundFlightResource = (<any[]>body.value).find(x => x.friendlyName == flightName);
        if (foundFlightResource)
        {
            tl.debug(`Flight found with ID ${foundFlightResource.flightId}`);
            return foundFlightResource;
        }

        if (body['@nextLink'] === undefined)
        {
            throw new Error(`No flight with name "${flightName}" was found`);
        }

        return getFlightResource(flightName, body['@nextLink']);
    });
}

/** Promises the deletion of a flight submission resource */
function deleteFlightSubmission(location: string): Q.Promise<void>
{
    tl.debug(`Deleting flight submission at ${location}`);
    var requestParams = {
        url: api.ROOT + location,
        method: 'DELETE'
    };

    return request.performAuthenticatedRequest<void>(currentToken, requestParams);
}

/** Promises a resource for a new flight submission. */
function createFlightSubmission(): Q.Promise<any>
{
    tl.debug('Creating new flight submission');
    var requestParams = {
        url: `${api.ROOT}applications/${appId}/flights/${flightId}/submissions`,
        method: 'POST'
    };

    return request.performAuthenticatedRequest<any>(currentToken, requestParams);
}

/**
 * Adds packages to a flight submission resource as Pending Upload, then commits the submission.
 * @return Promises the update of the submission resource.
 */
function putFlightSubmission(flightSubmissionResource: any): Q.Promise<void>
{
    tl.debug(`Updating flight submission ${flightSubmissionResource.id}`);
    api.includePackagesInSubmission(taskParams.packages, flightSubmissionResource);

    var requestParams = {
        url: `${api.ROOT}applications/${appId}/flights/${flightId}/submissions/${flightSubmissionResource.id}`,
        method: 'PUT',
        json: true, // Sets content-type and length for us, and parses the request/response appropriately
        body: flightSubmissionResource
    };

    tl.debug(`Performing metadata update`);
    return request.performAuthenticatedRequest<void>(currentToken, requestParams);
}

/** Promises the committing of the given flight submission. */
function commitFlightSubmission(flightSubmissionId: string): Q.Promise<void>
{
    var requestParams = {
        url: `${api.ROOT}applications/${appId}/flights/${flightId}/submissions/${flightSubmissionId}`,
        method: 'POST'
    };

    return request.performAuthenticatedRequest<void>(currentToken, requestParams);
}
