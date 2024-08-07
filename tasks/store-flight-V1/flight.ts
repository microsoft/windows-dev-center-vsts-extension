/*
 * Behavior for the Flight task. Takes authentication information, app information, and packages,
 * and flights to the Store.
 */

import api = require('../common/apiHelper');
import request = require('../common/requestHelper');

import Q = require('q');
import tl = require('azure-pipelines-task-lib');

/** Core parameters for the flight task. */
export interface CoreFlightParams
{
    endpoint: string;

    /**  Name of the flight we are publishing packages to */
    flightName: string;

    /** The credentials used to authenticate to the store. */
    authentication: request.Credentials;

    /**
     * If true, delete any pending submissions before starting a new one.
     * Otherwise, fail the task if a submission is pending.
     */
    force: boolean;

    /** A list of paths to the packages to be uploaded. */
    packages: string[];

    /** A path where the zip file to be uploaded to the dev center will be stored. */
    zipFilePath: string;

    /** If true, we will exit immediately after commit without polling submission till app is published. */
    skipPolling: boolean;

    /**If provided, specifies number of packages per unique target device family and target platform to keep in the flight group. */
    numberOfPackagesToKeep?: number;

    /** If provided, specified the number of hours to differ until the packages in this submission become mandatory. */
    mandatoryUpdateDifferHours?: number;
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

    /* We expect the endpoint part of this to not have a slash at the end.
     * This is because authenticating to 'endpoint/' will give us an
     * invalid token, while authenticating to 'endpoint' will work */
    api.ROOT = taskParams.endpoint + api.API_URL_VERSION_PART;

    console.log('Authenticating...');
    currentToken = await request.authenticate(taskParams.endpoint, taskParams.authentication);

    console.log('Obtaining app information...');
    var appResource = await getAppResource();

    appId = appResource.id; // Globally set app ID for future steps.

    console.log(`Obtaining flight resource for flight ${taskParams.flightName} in app ${appId}`);
    var flightResource = await getFlightResource(taskParams.flightName);

    flightId = flightResource.flightId; // Globally set app ID for future steps.

    // Delete pending submission if force is turned on (only one pending submission can exist)
    if (taskParams.force && flightResource.pendingFlightSubmission != undefined)
    {
        console.log('Deleting existing flight submission...');
        await deleteFlightSubmission(flightResource.pendingFlightSubmission.resourceLocation);
    }

    console.log('Creating flight submission...');
    var flightSubmissionResource = await createFlightSubmission();
    var submissionUrl = `https://developer.microsoft.com/en-us/dashboard/apps/${appId}/submissions/${flightSubmissionResource.id}`;
    console.log(`Submission ${submissionUrl} was created successfully`);

    if (taskParams.numberOfPackagesToKeep != null)
    {
        console.log('Deleting old packages...');
        api.deleteOldPackages(flightSubmissionResource.flightPackages, taskParams.numberOfPackagesToKeep);
    }

    console.log('Updating package delivery options...');
    await api.updatePackageDeliveryOptions( flightSubmissionResource, taskParams.mandatoryUpdateDifferHours);

    console.log('Updating flight submission...');
    await putFlightSubmission(flightSubmissionResource);

    console.log('Creating zip file...');
    var zip = api.createZipFromPackages(taskParams.packages);
    if (Object.keys(zip.files).length > 0)
    {
        await api.persistZip(zip, taskParams.zipFilePath, flightSubmissionResource.fileUploadUrl);
    }

    console.log('Committing flight submission...');
    await commitFlightSubmission(flightSubmissionResource.id);

    if (taskParams.skipPolling)
    {
        console.log('Skip polling option is checked. Skipping polling...');
        console.log(`Click here ${submissionUrl} to check the status of the submission in Dev Center`);
    }
    else
    {
        console.log('Polling flight submission...');
        var resourceLocation = `applications/${appId}/flights/${flightId}/submissions/${flightSubmissionResource.id}`;
        await api.pollSubmissionStatus(currentToken, resourceLocation, flightSubmissionResource.targetPublishMode);
    }

    // Attach summary file for easy access to submission on Dev Center from release Summary tab
    var summaryText = api.buildSummaryText(appResource.primaryName, flightResource.friendlyName, submissionUrl, taskParams.skipPolling ? 'publishing' : 'in the store');
    api.attachSubmissionSummary(summaryText);

    tl.setResult(tl.TaskResult.Succeeded, 'Flight submission completed');
}

/**
 * @return Promises the resource associated with the application given to the task.
 */
async function getAppResource()
{
    var appId;
    if (hasAppId(taskParams))
    {
        appId = taskParams.appId;
    }
    else
    {
        tl.debug(`Getting app ID from name ${taskParams.appName}`);
        appId = await api.getAppIdByName(currentToken, taskParams.appName);
    }

    return api.getAppResource(currentToken, appId);
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
    return api.deleteSubmission(currentToken, `${api.ROOT}applications/${appId}/${location}`);
}

/** Promises a resource for a new flight submission. */
function createFlightSubmission(): Q.Promise<any>
{
    return api.createSubmission(currentToken, `${api.ROOT}applications/${appId}/flights/${flightId}/submissions`);
}

/**
 * Adds packages to a flight submission resource as Pending Upload, then commits the submission.
 * @return Promises the update of the submission resource.
 */
function putFlightSubmission(flightSubmissionResource: any): Q.Promise<void>
{
    api.includePackagesInSubmission(taskParams.packages, flightSubmissionResource.flightPackages);

    var url = `${api.ROOT}applications/${appId}/flights/${flightId}/submissions/${flightSubmissionResource.id}`;
    return api.putSubmission(currentToken, url, flightSubmissionResource);
}

/** Promises the committing of the given flight submission. */
function commitFlightSubmission(flightSubmissionId: string): Q.Promise<void>
{
    return api.commitSubmission(currentToken, `${api.ROOT}applications/${appId}/flights/${flightId}/submissions/${flightSubmissionId}/commit`);
}
