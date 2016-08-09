/*
 * A helper for the Store API. Allows one to authenticate and perform requests through the API.
 */

/// <reference path="../../typings/globals/form-data/index.d.ts" />
/// <reference path="../../typings/globals/request/index.d.ts" />
/// <reference path="../../typings/globals/q/index.d.ts" />

import Q = require('q');
import request = require('request');

export var VERBOSE = false;

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

/** 
 * A callback that expects a non-error response body and a deferred.
 * It should decide whether to resolve or reject the deferred promise
 * based on the body. */
export interface apiSuccessCallback<T>
{
    (body: any, deferred: Q.Deferred<T>): void
}

/**
 * Perform an API request. Provides some default error handling by rejecting its
   promise if an error in the API call occurs, or the status code returned is an error code.
 * @param options Options describing the request to execute.
 * @param callback If present, decides whether to resolve or reject the promise based on the reponse body.
 * If it is not present, the promise will be resolved with the body of the response.
 */
export function performRequest<T>(
        options: (request.UriOptions | request.UrlOptions) & request.CoreOptions,
        callback?: apiSuccessCallback<T>):
    Q.Promise<T>
{
    var deferred = Q.defer<T>();
    //VERBOSE = true;
    if (VERBOSE)
    {
        console.log("Performing request:\n" + JSON.stringify(options));
    }

    request(options, function (err, resp, body)
    {

        if (VERBOSE)
        {
            console.log('Completed with status ' + resp.statusCode);
            if (typeof body == 'string')
            {
                console.log('Body: ' + body + '\n\n');
            }
            else
            {
                console.log('Body: ' + JSON.stringify(body) + '\n\n');
            }
        }
        if (err) // A transport-level error occurred (i.e. the request could not be completed)
        {
            console.log('Error: ' + err);
            deferred.reject(err);
        }
        else if (resp.statusCode >= 400) // An application-level error occurred (i.e. the request was completed, but could not be fulfilled)
        {
            console.log('Error ' + resp.statusCode)
            deferred.reject(body);
        }
        else if (callback) // If a callback was provided, defer to it the decision of rejecting or resolving.
        {
            callback(body, deferred);
        }
        else // If no callback was provided, resolve with the body
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
        options: (request.UriOptions | request.UrlOptions) & request.CoreOptions,
        callback?: apiSuccessCallback<T>):
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

            return performRequest<T>(options, callback);
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

    return performRequest<AccessToken>(options, function (body, deferred)
    {
        var content = JSON.parse(body);
        var tok: AccessToken = {
            resource: resource,
            credentials: credentials,
            expiration: content.expires_on,
            token: content.access_token
        };

        deferred.resolve(tok);
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
