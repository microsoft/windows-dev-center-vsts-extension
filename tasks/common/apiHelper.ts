/*
 * A helper for the Store API. Contains logic to obtain App IDs from names, poll submissions,
 * create files required by the API, etc.
 */

/// <reference path="../../typings/index.d.ts" />

import request = require('./requestHelper');

import fs = require('fs');
import path = require('path');

var JSZip = require('jszip'); // JSZip typings have not been updated to the version we're using
import Q = require('q');
import stream = require('stream');
import tl = require('vsts-task-lib');

/**
 * A little part of the URL to the API that contains a version number.
 * This may need to be updated in the future to comply with the API.
 */
export const API_URL_VERSION_PART = '/v1.0/my/';

/** The root of all API requests. */
export var ROOT: string;

/** How many times should we retry. */
export const NUM_RETRIES = 5;

/**
 * The message used when a commit fails. Note that this does not need to be very
 * informative since the user will see more details in additional messages.
 */
const COMMIT_FAILED_MSG = 'Commit failed';

/**
 * Tries to obtain an app resource from the primary name of an app.
 * This will only work with the primary name.
 * @param givenAppName The app name for which we want to find the resource.
 * @param currentPage Bookkeeping parameter to indicate at which point of the search we are.
 *   This should not be given by the caller.
 */
export function getAppIdByName(token: request.AccessToken, appName: string, currentPage?: string): Q.Promise<string>
{
    if (currentPage === undefined)
    {
        currentPage = 'applications';
    }

    tl.debug(`\tSearching for app ${appName} on ${currentPage}`);

    var requestParams = {
        url: ROOT + currentPage,
        method: 'GET'
    };

    return request.performAuthenticatedRequest<any>(token, requestParams).then(body =>
    {
        var foundAppResource = (<any[]>body.value).find(x => x.primaryName == appName);
        if (foundAppResource)
        {
            tl.debug(`App found with ${foundAppResource.id}`);
            return foundAppResource.id;
        }

        if (body['@nextLink'] === undefined)
        {
            throw new Error(`No application with name "${appName}" was found`);
        }

        return getAppIdByName(token, appName, body['@nextLink']);
    });
}

export function includePackagesInSubmission(packages: string[], submissionResource: any): void
{
    tl.debug(`Adding ${packages.length} package(s)`);
    packages.map(makePackageEntry).forEach(packEntry =>
    {
        var entry = {
            fileName: packEntry,
            fileStatus: 'PendingUpload'
        };

        submissionResource.applicationPackages.push(entry);
    });
}

/**
 * Create a zip file containing the given list of packages.
 * @param submissionResource
 */
export function createZipFromPackages(packages: string[])
{
    tl.debug(`Creating zip file`);
    var zip = new JSZip();

    packages.forEach((aPath, i) =>
    {
        // According to JSZip documentation, the directory separator used is a forward slash.
        var entry = makePackageEntry(aPath, i).replace(/\\/g, '/');
        tl.debug(`Adding package path ${aPath} to zip as ${entry}`);
        zip.file(entry, fs.createReadStream(aPath), { compression: 'DEFLATE' });
    });

    return zip;
}

/**
 * Polls the status of a submission
 * @param submissionResource The submission to poll
 * @return A promise that will be fulfilled if the commit is successful, and rejected if the commit fails.
 */
export function pollSubmissionStatus(token: request.AccessToken, resourceLocation: string, publishMode: string): Q.Promise<void>
{
    const POLL_DELAY = 10000;
    var submissionCheckGenerator = () => checkSubmissionStatus(token, resourceLocation, publishMode);
    return request.withRetry(NUM_RETRIES, submissionCheckGenerator, err =>
        // Keep trying unless it's a 400 error or the message is the one we use for failed commits.
        !(request.is400Error(err) || (err != undefined && err.message == COMMIT_FAILED_MSG))).
        then(status =>
        {
            if (status)
            {
                return;
            }
            else
            {
                return Q.delay(POLL_DELAY).then(() => pollSubmissionStatus(token, resourceLocation, publishMode));
            }
        });
}

/**
 * Checks the status of a submission.
 * @param submissionId
 * @return A promise for the status of the submission: true for completed, false for not completed yet.
 * The promise will be rejected if an error occurs in the submission.
 */
function checkSubmissionStatus(token: request.AccessToken, resourceLocation: string, publishMode: string): Q.Promise<boolean>
{
    const statusMsg = `Submission status for "${resourceLocation}"`;
    const requestParams = {
        url: ROOT + resourceLocation + '/status',
        method: 'GET'
    };

    return request.performAuthenticatedRequest<any>(token, requestParams).then(function (body)
    {
        /* Once the previous request has finished, examine the body to tell if we should start a new one. */
        if (!body.status.endsWith('Failed'))
        {
            var msg = statusMsg + body.status
            tl.debug(statusMsg + body.status);
            console.log(msg);

            /* In immediate mode, we expect to get all the way to "Published" status.
             * In other modes, we stop at "Release" status. */
            return body.status == 'Published'
                || (body.status == 'Release' && publishMode != 'Immediate');
        }
        else
        {
            tl.error(statusMsg + ' failed with ' + body.status);
            tl.error('Reported errors: ');
            for (var i = 0; i < body.statusDetails.errors.length; i++)
            {
                var errDetail = body.statusDetails.errors[i];
                tl.error('\t ' + errDetail.code + ': ' + errDetail.details);
            }
            throw new Error(COMMIT_FAILED_MSG);
        }
    });
}



/**
 * Creates a buffer to the given zip file.
 */
function createZipStream(zip): NodeJS.ReadableStream
{
    var zipGenerationOptions = {
        base64: false,
        compression: 'DEFLATE',
        type: 'nodebuffer',
        streamFiles: true
    };

    return zip.generateNodeStream(zipGenerationOptions);
}

/**
 * Write the given zip file to disk and to the given Azure blob.
 * @param zip
 * @param filePath
 * @param blobUrl
 */
export function persistZip(zip, filePath: string, blobUrl: string): Q.Promise<void>
{
    var buf: NodeJS.ReadableStream = createZipStream(zip);

    /* We want to pipe the zip stream to two different streams, since uploading the zip
       attaches events to the stream itself. */
    var netPassthrough = new stream.PassThrough();

    buf.pipe(fs.createWriteStream(filePath));

    console.log('Uploading zip file...');
    buf.pipe(netPassthrough)
    return uploadZip(netPassthrough, blobUrl);
}

/**
 * Uploads a zip file to the appropriate blob.
 * @param zip A buffer containing the zip file
 * @return A promise for the upload of the zip file.
 */
function uploadZip(zip: NodeJS.ReadableStream, blobUrl: string): Q.Promise<void>
{
    
    tl.debug(`Uploading zip file to ${blobUrl}`);

    /* The URL we get from the Store sometimes has unencoded '+' and '=' characters because of a
     * base64 parameter. There is no good way to fix this, because we don't really know how to
     * distinguish between 'correct' uses of those characters, and their spurious instances in
     * the base64 parameter. In our case, we just take the compromise of replacing every instance
     * of '+' with its url-encoded counterpart. */
    var dest = blobUrl.replace(/\+/g, '%2B');

    return request.uploadAzureFile(zip, dest);
}


/**
 * Transform a package path into a package entry for the zip file.
 * All leading directories are removed and replaced by the index. E.g.
 *
 * ['foo/anAppx', 'bar/anAppx', 'baz/quux/aXap'].map(makePackageEntry)
 *      => ['0/anAppx', '1/anAppx', '2/aXap']
 */
function makePackageEntry(pack: string, i: number): string
{
    return path.join(i.toString(), path.basename(pack));
}

