/*
 * A helper for the Store API. Allows one to authenticate and perform requests through the API.
 */

/// <reference path="../../typings/globals/form-data/index.d.ts" />
/// <reference path="../../typings/globals/request/index.d.ts" />
/// <reference path="../../typings/globals/q/index.d.ts" />

import http = require('http'); // Only used for types

import Q = require('q');
import request = require('request');

/** How long to wait between retries. */
const RETRY_DELAY = 5000;

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

    // For friendly logging
    toString(): string
    {
        var preamble = 'Status';

        if (this.error !== undefined)
        {
            preamble = 'Error';
        }

        var bodyToPrint = this.body;
        if (typeof bodyToPrint != 'string')
        {
            bodyToPrint = JSON.stringify(bodyToPrint);
        }

        return `${preamble} ${this.response.statusCode}: ${bodyToPrint}`;
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
 */
export function performRequest<T>(options: (request.UriOptions | request.UrlOptions) & request.CoreOptions):
    Q.Promise<T>
{
    var deferred = Q.defer<T>();
    
    request(options, function (error, response, body)
    {
        // For convenience, parse the body if it's JSON.
        if (response.headers['content-type'].indexOf('application/json') != -1)
        {
            body = JSON.parse(body);
            logErrorsAndWarnings(body);
        }

        var respInfo: ResponseInformation = {
            error: error,
            response: response,
            body: body
        }

        if (error) // A transport-level error occurred (i.e. the request could not be completed)
        {
            console.log('Error: ' + error);
            deferred.reject(respInfo);
        }
        else if (response.statusCode >= 400) // An application-level error occurred (i.e. the request was completed, but could not be fulfilled)
        {
            console.log('Error ' + response.statusCode)
            deferred.reject(respInfo);
        }
        else
        {
            deferred.resolve(body);
        }
    });

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
    var newString = encodeURIComponent(credentials.clientSecret);
    var requestParams = {
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        resource: resource.substr(0, resource.length -1)
    };

    var options = {
        url: endpoint,
        method: 'POST',
        form: requestParams
    };

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
 * @param numRetries How many times should the promise be tried to be fulfilled.
 * @param promise The promise to fulfill
 * @param callback In case of rejection, receives the reason. Should return false to abort retrying.
 */
export function withRetry<T>(
    numRetries: number,
    promise: Q.Promise<T>,
    callback?: ((err: any) => boolean)): Q.Promise<T>
{
    return promise.fail<T>(function (err)
    {
        if (numRetries > 0 && (!callback || callback(err)))
        {
            return Q.delay(withRetry(numRetries - 1, promise, callback), RETRY_DELAY);
        }
        else
        {
            throw err;
        }
    });
}

/** 
 * Examines a response body and logs errors and warnings.
 * @param body A body in the format given by the Store API
 * (Where body.errors and body.warnings are arrays of objects
 * containing a 'code' and 'details' attribute).
 */
function logErrorsAndWarnings(body: any)
{
    if (body.errors !== undefined && body.errors.length > 0)
    {
        console.error('Errors occurred in request');
        (<any[]>body.errors).forEach(x => console.error(`\t[${x.code}]  ${x.details}`));
    }

    if (body.warnings !== undefined && body.warnings.length > 0)
    {
        console.warn('Warnings occurred in request');
        (<any[]>body.warnings).forEach(x => console.warn(`\t[${x.code}]  ${x.details}`));
    }
}
