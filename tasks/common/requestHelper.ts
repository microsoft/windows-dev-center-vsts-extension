/*
 * A helper to perform various HTTP requests, with some default handling to manage errors.
 * This is mainly a wrapper for the 'request' npm module that uses promises instead of callbacks.
 */

/// <reference path="../../typings/index.d.ts" />

import http = require('http'); // Only used for types

import uuid = require('node-uuid');
import Q = require('q');
import request = require('request');
var streamifier = require('streamifier'); // streamifier has no typings

/** How long to wait between retries (in ms) */
const RETRY_DELAY = 5000;

/** After how long should a connection be given up (in ms). */
const TIMEOUT = 180000;

/** Block size of chunks uploaded to the blob (in bytes). */
const UPLOAD_BLOCK_SIZE_BYTES = 1024 * 1024; // 1Mb

/** Credentials used to gain access to a particular resource. */
export interface Credentials
{
    /** The tenant ID associated with these credentials. */
    tenant: string;

    clientId: string;
    clientSecret: string;
}

/** A token used to access a particular resource. */
export interface AccessToken
{
    /** Resource to which this token grants access. */
    resource: string

    /** Credentials used to obtain access. */
    credentials: Credentials;

    /** Expiration timestamp of the token */
    expiration: number;

    /** Actual token to be used in the request. */
    token: string;
}

/** Whether an access token should be renewed. */
function isExpired(token: AccessToken): boolean
{
    // Date.now() returns a number in miliseconds.
    // We say that a token is expired if its expiration date is at most five seconds in the future.
    return (Date.now() / 1000) + 5 > token.expiration;
}

/** All the information given to us by the request module along a response. */
export class ResponseInformation
{
    error: any;
    response: http.IncomingMessage;
    body: any;

    constructor(_err: any, _res: http.IncomingMessage, _bod: any)
    {
        this.error = _err;
        this.response = _res;
        this.body = _bod;
    }

    // For friendly logging
    toString(): string
    {
        if (this.error != undefined)
        {
            return `Error ${JSON.stringify(this.error)}`;
        }
        else
        {

            var bodyToPrint = this.body;
            if (typeof bodyToPrint != 'string')
            {
                bodyToPrint = JSON.stringify(bodyToPrint);
            }

            return `Status ${this.response.statusCode}: ${bodyToPrint}`;
        }
    }
}

/**
 * Perform a request with some default handling.
 *
 * For convenience, parses the body if the content-type is 'application/json'.
 * Further, examines the body and logs any errors or warnings.
 *
 * If an transport or application level error occurs, rejects the returned promise.
 * The reason given is an instance of @ResponseInformation@, containing the error
 * object, the response and the body.
 *
 * If no error occurs, resolves the returned promise with the body.
 *
 * @param options Options describing the request to execute.
 * @param stream If specified, pipe this stream into the request.
 */
export function performRequest<T>(
    options: (request.UriOptions | request.UrlOptions) & request.CoreOptions,
    stream?: NodeJS.ReadableStream):
    Q.Promise<T>
{
    var deferred = Q.defer<T>();

    if (options.timeout == undefined)
    {
        options.timeout = TIMEOUT;
    }

    var callback = function (error, response, body)
    {
        // For convenience, parse the body if it's JSON.
        if (response != undefined && // response is undefined if a transport-level error occurs
            response.headers['content-type'] != undefined &&   // content-type is undefined if there is no content
            response.headers['content-type'].indexOf('application/json') != -1 &&
            typeof body == 'string') // body might be an object if the options given to request already parsed it for us
        {
            body = JSON.parse(body);
            logErrorsAndWarnings(body);
        }

        if (error || (response && response.statusCode >= 400))
        {
            deferred.reject(new ResponseInformation(error, response, body));
        }
        else
        {
            deferred.resolve(body);
        }
    }

    if (!stream)
    {
        request(options, callback);
    }
    else
    {
        stream.pipe(request(options, callback));
    }

    return deferred.promise;
}

/**
 * Same as @performRequest@, but additionally requires an authentification token.
 * @param auth A token used to identify with the resource. If expired, it will be renewed before executing the request.
 */
export function performAuthenticatedRequest<T>(
    auth: AccessToken,
    options: (request.UriOptions | request.UrlOptions) & request.CoreOptions):
    Q.Promise<T>
{
    // The expiration check is a function that returns a promise
    var expirationCheck = function ()
    {
        if (isExpired(auth))
        {
            return authenticate(auth.resource, auth.credentials).then(function (newAuth)
            {
                auth.token = newAuth.token;
                auth.expiration = newAuth.expiration;
            });
        }
        else
        {
            /* This looks strange, but it returns a promise for void, which is exactly what we need. */
            return Q.when();
        }
    };


    return expirationCheck() // Call the expiration check to obtain a promise for it.
        .then<T>(function () // Chain the use of the token to that promise.
        {
            if (options.headers === undefined)
            {
                options.headers = {
                    'Authorization': 'Bearer ' + auth.token
                }
            }
            else
            {
                options.headers['Authorization'] = 'Bearer ' + auth.token;
            }

            return performRequest<T>(options);
        });
}

/**
 * @param resource The resource (URL) to authenticate to.
 * @param credentials Credentials to use for authentication.
 * @returns Promises an access token to use to communicate with the resource.
 */
export function authenticate(resource: string, credentials: Credentials): Q.Promise<AccessToken>
{
    var endpoint = 'https://login.microsoftonline.com/' + credentials.tenant + '/oauth2/token';
    var requestParams = {
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        resource: resource
    };

    var options = {
        url: endpoint,
        method: 'POST',
        form: requestParams
    };

    console.log('Authenticating with server...');
    return performRequest<any>(options).then<AccessToken>(body =>
    {
        var tok: AccessToken = {
            resource: resource,
            credentials: credentials,
            expiration: body.expires_on,
            token: body.access_token
        };

        return tok;
    });
}

/**
 * Transforms a promise so that it is tried again a specific number of times if it fails.
 *
 * A 'generator' of promises must be supplied. The reason is that if a promise fails,
 * then it will stay in a failed state and it won't be possible to await on it anymore.
 * Therefore a new promise must be returned every time.
 *
 * @param numRetries How many times should the promise be tried to be fulfilled.
 * @param promiseGenerator A function that will generate the promise to try to fulfill.
 * @param errPredicate In case an error occurs, receives the reason and returns whether to continue retrying
 */
export function withRetry<T>(
    numRetries: number,
    promiseGenerator: () => Q.Promise<T>,
    errPredicate?: ((err: any) => boolean)): Q.Promise<T>
{
    return promiseGenerator().fail(err =>
    {
        if (numRetries > 0 && (!errPredicate || errPredicate(err)))
        {
            console.log(`Operation failed with ${err}`);
            console.log(`Waiting ${RETRY_DELAY / 1000} seconds then retrying... (${numRetries - 1} retrie(s) left)`);
            return Q.delay(RETRY_DELAY).then(() => withRetry(numRetries - 1, promiseGenerator, errPredicate));
        }
        else
        {
            /* Don't wrap err in an error because it's already an error
            (.fail() is the equivalent of "catch" for promises) */
            throw err;
        }
    });
}

/**
 * Uploads a file to the given Azure blob.
 * @param fileContents
 * @param blobUrl
 */
export function uploadAzureFile(fileContents: NodeJS.ReadableStream, blobUrl: string): Q.Promise<void>
{
    var promisesForBlocks = Q(uploadAzureFileBlocks(fileContents, blobUrl));

    return promisesForBlocks.then(blockList =>
    {
        // Once all blocks have been uploaded, tell Azure the order they should be in.
        console.log('\t... All blocks uploaded.');

        var body =
              '<?xml version="1.0" encoding="utf-8"?><BlockList>'
            + blockList.map(s => `<Latest>${s}</Latest>`).join('')
            + '</BlockList>';

        var options = {
            url: blobUrl + '&comp=blocklist',
            body: body,
            method: 'PUT'
        }

        return withRetry(5, () => performRequest<void>(options));
    });
}

/**
 * Uploads a file chunk by chunk to the given Azure blob.
 * @return A promise for the list of block IDs uploaded
 */
async function uploadAzureFileBlocks(fileContents: NodeJS.ReadableStream, blobUrl: string)
{
    var requestParams = {
        url: '',
        method: 'PUT',
        headers: {
            'x-ms-blob-type': 'BlockBlob'
        }
    }

    /* The reason why we have promises for promises here is because we're really doing two levels async operations at once.
       We're reading the file, and kicking off web requests as we go along.
       The 'outer' promise is for reading the file. This happens chunk by chunk, and each chunk is immediately sent off into
       a web request. The 'inner' promises are thus for the upload of each chunk.

       Thankfully this is hidden from users of this function.
    */
    var deferred = Q.defer<Q.Promise<string>[]>();

    const fileGuid = uuid.v4().replace(/\-/g, '');
    var blockPromises: Q.Promise<string>[] = [];
    var currentBlockId = 0;

    fileContents.on('readable', () =>
    {
        var block: string | Buffer;

        while ((block = fileContents.read(UPLOAD_BLOCK_SIZE_BYTES)) !== null)
        {
            requestParams.headers['content-length'] = block.length;

            // Sequence number with leading zeros.
            // Note: will not work if we need more than a million blocks
            // Note 2: with current block size, a million blocks is one terabyte.
            var sequence = ('000000' + currentBlockId).substr(-6);
            var base64Id = new Buffer(fileGuid + '-' + sequence).toString('base64');
            requestParams.url = blobUrl + '&comp=block&blockid=' + base64Id;

            console.log(`\tUploading block ${currentBlockId} (ID ${base64Id})`);
            currentBlockId++;

            /* When doing a multipart form request, the request module erroneously (?) adds some headers like
             * content-disposition to the __contents__ of the data, which corrupts the file. Therefore we have
             * to use this instead, where the block is piped from a stream to the put request. */
            var blockPromiseGenerator = () => performRequest(requestParams, streamifier.createReadStream(block)).thenResolve(base64Id);

            /* Also allow retries. We don't expect Azure to be down. If it is, we should normally have failed in a previous step. */
            var blockPromise = withRetry(5, blockPromiseGenerator);
            blockPromises.push(blockPromise);
        }
    }).on('end', () =>
    {
        deferred.resolve(blockPromises);
    });

    blockPromises = await deferred.promise;
    return Q.all(blockPromises);
}


/** Indicates whether the given object is an HTTP response for a 4xx error. */
export function is400Error(err): boolean
{
    // Does this look like a ResponseInformation?
    if (err != undefined && err.response != undefined && typeof err.response.statusCode == 'number')
    {
        return err.response.statusCode >= 400
            && err.response.statusCode < 500
    }

    return false;
}

/**
 * Examines a response body and logs errors and warnings.
 * @param body A body in the format given by the Store API
 * (Where body.errors and body.warnings are arrays of objects
 * containing a 'code' and 'details' attribute).
 */
function logErrorsAndWarnings(body: any)
{
    if (body.errors != undefined && body.errors.length > 0)
    {
        console.error('Errors occurred in request');
        (<any[]>body.errors).forEach(x => console.error(`\t[${x.code}]  ${x.details}`));
    }

    if (body.warnings != undefined && body.warnings.length > 0)
    {
        console.warn('Warnings occurred in request');
        (<any[]>body.warnings).forEach(x => console.warn(`\t[${x.code}]  ${x.details}`));
    }
}

