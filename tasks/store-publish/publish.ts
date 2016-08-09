/*
 * Behavior for the Publish task. Takes authentication information, app information, and packages,
 * and publishes to the Store.
 */

/// <reference path="../../typings/globals/node/index.d.ts" />
/// <reference path="../../typings/globals/jszip/index.d.ts" />
/// <reference path="../../typings/globals/request/index.d.ts" />
/// <reference path="node_modules/vsts-task-lib/task.d.ts" />

import api = require('./apiWrapper');

import fs = require('fs');
import path = require('path');
import os = require('os');

import JSZip = require('jszip');
import Q = require('q');
import request = require('request');
import tl = require('vsts-task-lib/task');

/** How to update the app metadata */
export enum MetadataUpdateType
{
    /**
        The metadata will not be updated.
    */
    NoUpdate,

    /**
        The metadata attributes are expected in a single json file.
    */
    JsonMetadata,

    /**
        The metadata attributes are expected in a collection of text files
        (one file per attribute).
    */
    TextMetadata
}

/** Core parameters for the publish task. */
export interface CorePublishParams
{
    endpoint: string;

    /** The credentials used to authenticate to the store. */
    authentication: api.Credentials;

    /**
     * If true, delete any pending submissions before starting a new one.
     * Otherwise, fail the task if a submission is pending.
     */
    force: boolean;

    metadataUpdateType: MetadataUpdateType;

    /**
     * If provided, points to a JSON file containing the metadata to use for
     * this submission. Otherwise the previous metadata is cloned.
     */
    metadataRoot?: string;

    /** A list of paths to the packages to be uploaded. */
    packages: string[];

    /** A path where the zip file to be uploaded to the dev center will be stored. */
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

export type ParamsWithAppId = AppIdParam & CorePublishParams;
export type ParamsWithAppName = AppNameParam & CorePublishParams;
export type PublishParams = ParamsWithAppId | ParamsWithAppName;

interface FileEntryDict
{
    // Dictionary of strings to pairs of object arrays and numbers
    [filePath: string]: { arr: any[], i: number }
}

/**
 * Type guard: indicates whether these parameters contain an App Id or not.
 */
function hasAppId(p: PublishParams): p is ParamsWithAppId
{
    return (<ParamsWithAppId>p).appId !== undefined;
}

/** The root of all API requests */
var ROOT: string;

/** The delay between requests when polling for the submission status, in miliseconds. */
const POLL_DELAY = 10000;

/** The following attributes are considered as lists of strings and not just strings. */
const STRING_ARRAY_ATTRIBUTES =
    {
        keywords: true,
        features: true,
        recommendedhardware: true
    };

/**
 * The parameters given to the task. They're declared here to be
 * available to every step of the task without explicitly threading them through.
 */
var taskParams: PublishParams;

/** The current token used for authentication. */
var currentToken: api.AccessToken;

/** The app ID we are publishing to */
var appId: string;

/**
 * The main task function.
 */
export function publishTask(params: PublishParams): void
{
    taskParams = params;
    ROOT = taskParams.endpoint + 'v1.0/my/';

    api.authenticate(taskParams.endpoint, taskParams.authentication)
        .then(tok => currentToken = tok) // Globally set token for future steps.
        .then(getAppResource)
        .then(deleteIfForce)
        .then(appRes => appId = appRes.id) // Globally set app ID for future steps.
        .then(createSubmission)
        .then(putMetadata)
        .then((submissionResource) => uploadZip(submissionResource, taskParams.zipFilePath))
        .then(commit)
        .then(pollStatus)
        .done(
            () => tl.setResult(tl.TaskResult.Succeeded, 'Submission completed'),
            (err) => {
                tl.error(err);
                tl.setResult(tl.TaskResult.Failed, JSON.stringify(err))
            }
        );
}

/**
 * Obtain an app resource from the store, either from the app name or the app id
 * (depending on what was given to us)
 */
function getAppResource(): Q.Promise<any>
{
    console.log('Getting app information...');
    if (hasAppId(taskParams))
    {
        var requestParams = {
            url: ROOT + 'applications/' + taskParams.appId,
            method: 'GET'
        };

        return api.performAuthenticatedRequest<any>(currentToken, requestParams).then(JSON.parse);
    }
    else 
    {
        // Otherwise go look for it through the pages of apps, using the primary name we got.
        return getAppResourceFromName(taskParams.appName);
    }
}

/**
 * Tries to obtain an app resource from an app name.
 * @param givenAppName The app name for which we want to find the resource.
 * @param currentPage Bookkeeping parameter to indicate at which point of the search we are.
 *   This should not be given by the caller.
 */
function getAppResourceFromName(givenAppName: string, currentPage?: string): Q.Promise<any>
{
    if (currentPage === undefined)
    {
        currentPage = 'applications';
    }

    console.log('\tSearching for app on ' + currentPage);

    var requestParams = {
        url: ROOT + currentPage,
        method: 'GET'
    };

    return api.performAuthenticatedRequest<string>(currentToken, requestParams, function (body, deferred)
    {
        var jbody = JSON.parse(body);
        var foundAppResource = undefined;

        // Check through the apps returned in this page.
        for (var i = 0 ; i < jbody.value.length ; i++)
        {
            if (jbody.value[i].primaryName == givenAppName)
            {
                foundAppResource = jbody.value[i];
                break;
            }
        }

        if (foundAppResource)
        {
            deferred.resolve(foundAppResource);
        }
        else
        {
            /* If we didn't find the object, try with the next page and hope we can
               fulfill the current promise that way. If there is no next page, reject
               the promise. */
            if (jbody['@nextLink'] === undefined)
            {
                deferred.reject(new Error('No application with name "' + givenAppName + '" was found'));
            }
            else
            {
                getAppResourceFromName(givenAppName, jbody['@nextLink']).then(res => deferred.resolve(res)).done();
            }
        }
    });
}

/**
 * If the 'force' parameter is turned on, checks whether a submission is already existing and
 * deletes it if it's the case.
 * @param appResource
 * @returns Promises back the app resource (in other words, the app resource is chained to the next caller)
 */
function deleteIfForce(appResource: any): Q.Promise<any>
{
    if (taskParams.force && appResource.pendingApplicationSubmission !== undefined)
    {
        console.log('Force-deleting existing submission...');
        var requestParams = {
            url: ROOT + appResource.pendingApplicationSubmission.resourceLocation,
            method: 'DELETE'
        };

        return api.performAuthenticatedRequest(currentToken, requestParams).thenResolve(appResource);
    }
    else
    {
        return Q.fcall(() => appResource);
    }
}

/** Creates a submission for a given app. Promises the information about the submission. */
function createSubmission(): Q.Promise<any>
{
    console.log('Creating new submission...');
    var requestParams = {
        url: ROOT + 'applications/' + appId + '/submissions',
        method: 'POST'
    };

    return api.performAuthenticatedRequest<any>(currentToken, requestParams).then(JSON.parse);
}

/**
 * Adds the required metadata to the submission request, depending on the given parameters.
 * If no metadata update is to be perfomed, no changes are made. Otherwise, we look for the metadata
 * depending on the type of update (text or json).
 * @param submissionResource The current submission request
 * @returns Promises the submission resource that was sent to the API.
 */
function putMetadata(submissionResource: any): Q.Promise<any>
{
    console.log('Adding submission metadata...');

    if (taskParams.metadataUpdateType != MetadataUpdateType.NoUpdate &&
        taskParams.metadataRoot)
    {
        updateMetadata(submissionResource);
    }

    // Also at this point add the given packages to the list of packages to upload.
    console.log(`Adding ${taskParams.packages.length} package(s)`);
    taskParams.packages.map(makePackageEntry).forEach(packEntry =>
    {
        var entry = {
            fileName: packEntry,
            fileStatus: 'PendingUpload'
        };

        submissionResource.applicationPackages.push(entry);
    });

    var requestParams = {
        url: ROOT + 'applications/' + appId + '/submissions/' + submissionResource.id,
        method: 'PUT',
        json: true, // Sets content-type and length for us, and parses the request/response appropriately
        body: submissionResource
    };

    console.log('Updating submission in the server');
    return api.performAuthenticatedRequest<any>(currentToken, requestParams).thenResolve(submissionResource);
}

/**
 * Updates the metadata information given in the metadata root
 * @param submissionResource
 */

function updateMetadata(submissionResource: any): void
{
    console.log(`Updating metadata of submission object from directory ${taskParams.metadataRoot}`);
    // Update metadata for listings
    var listingPaths = fs.readdirSync(taskParams.metadataRoot);
    for (var i = 0; i < listingPaths.length; i++)
    {
        // Update metadata for this listing.
        console.log(`Obtaining metadata for language ${listingPaths[i]}`);
        let listingAbsPath = path.join(taskParams.metadataRoot, listingPaths[i]);
        if (existsAndIsDir(path.join(listingAbsPath, 'baseListing')))
        {
            if (submissionResource.listings[listingPaths[i]] === undefined)
            {
                submissionResource.listings[listingPaths[i]] = {};
            }
            mergeObjects(submissionResource.listings[listingPaths[i]], makeListing(listingAbsPath, submissionResource.listings[listingPaths[i]]));
        }
        else
        {
            tl.warning('Listing ' + listingPaths[i] + ' has no baseListing subdirectory. Skipping...');
        }
        console.log(`Finished parsing metadata for language ${listingPaths[i]}`)
    }

    // Update images from listings
    for (var listing in submissionResource.listings)
    {
        // Update image metadata for the base listing.
        let listingAbsPath = path.join(taskParams.metadataRoot, listing);
        var base = submissionResource.listings[listing].baseListing;
        if (base.images === undefined)
        {
            base.images = [];
        }
        console.log(`Updating images from ${listingAbsPath}`);
        updateImageMetadata(base.images, path.join(listingAbsPath, 'baseListing', 'images'));

        // Do the same for all the platform overrides
        for (var platOverride in submissionResource.listings[listing].platformOverrides)
        {
            var platPath = path.join(listingAbsPath, 'platformOverrides', platOverride, 'images');
            var platOverrideRef = submissionResource.listings[listing].platformOverrides[platOverride];
            if (platOverrideRef.images === undefined)
            {
                platOverrideRef.images = [];
            }
            console.log(`Updating platform override images from ${platPath}`);
            updateImageMetadata(platOverrideRef.images, platPath);
        }
    }

    console.log('Finished updating metadata');
}

/**
 * Construct a listing whose root is in the given path. This listing includes a base listing and
 * potentially some platform overrides.
 * @param listingPath
 */
function makeListing(listingAbsPath: string, languageJsonObj: any): any
{
    // Obtain base listing
    console.log('Obtaining base listings metadata...');
    var baseListing = getListingAttributes(path.join(listingAbsPath, 'baseListing'), languageJsonObj.baseListing);
    console.log('Done!');

    // Check if we have platform overrides
    console.log('Verifying platform overrides directory...');
    var platformOverrides = {};
    var overridesPath = path.join(listingAbsPath, 'platformOverrides');
    console.log(`Looking for directory ${overridesPath}`)
    if (existsAndIsDir(overridesPath))
    {
        console.log('Found platform overrides directory. Analyzing...');
        // If we do, consider each directory in the platformOverrides directory as a platform.
        var allOverrideDirs = fs.readdirSync(overridesPath).filter((x) =>
            { try {fs.statSync(path.join(overridesPath, x)).isDirectory()} catch (e) { return false;} });
        for (var i = 0; i < allOverrideDirs.length; i++)
        {
            var overridePath = path.join(overridesPath, allOverrideDirs[i]);
            console.log(`Obtaining listing metadata from folder ${overridePath}`);
            platformOverrides[allOverrideDirs[i]] = getListingAttributes(overridePath, languageJsonObj.platformOverrides);
        }
        console.log('Done!');
    }
    else
    {
        // Avoid creating an attribute for platform overrides if they're not there
        console.log('No platform overrides folder found.');
        platformOverrides = undefined;
    }

    return {
        baseListing: baseListing,
        platformOverrides: platformOverrides
    };
}

/**
 * Obtain listing attributes from the given directory. If the metadata update type given in the task
 * params is "Json update", it is expected that a file named "metadata.json" will be present at the
 * given path, and will contain the attributes to update. If the metadata update type is "Text update",
 * the listing path will be scanned for .txt files. Any .txt file will be added to the listing; the name
 * of the file will be the attribute and the contents will be the value.
 * @param listingPath
 */
function getListingAttributes(listingWithPlatAbsPath: string, jsonObj: any): any
{
    var listing = {};

    if (taskParams.metadataUpdateType == MetadataUpdateType.JsonMetadata)
    {
        var jsonPath = path.join(listingWithPlatAbsPath, 'metadata.json');
        if (existsAndIsFile(jsonPath))
        {
            listing = requireAbsoluteOrRelative(jsonPath);
        }
        else
        {
            tl.warning('No metadata.json found for ' + listingWithPlatAbsPath +
                '. Attributes from the last submission will be used.');
        }
    }
    else
    {
        for(var prop in jsonObj)
        {
            console.log(`Looking for corresponding file for property ${prop}`);
            var propFiles = fs.readdirSync(listingWithPlatAbsPath).filter(p =>
            !fs.statSync(path.join(listingWithPlatAbsPath, p)).isDirectory() &&
            p.substring(p.length - 4) == '.txt' &&
            path.parse(p).name.toUpperCase() === prop.toUpperCase());

            if (propFiles === undefined || propFiles.length == 0)
            {
                console.warn(`No file found for property ${prop}`);
                continue;
            }

            // Default to grab the first file that matches the property name.
            var txtPath = path.join(listingWithPlatAbsPath, propFiles[0]);
            console.log(`Working with file ${txtPath}`);
            var contents = fs.readFileSync(txtPath, 'utf-8');

            console.log(`Assigning contents to property`);
            listing[prop] = STRING_ARRAY_ATTRIBUTES[prop.toLowerCase()] ? splitAnyNewline(contents) : contents;
        }
    }

    return listing;
}

/**
 * Update the given image information. All existing images in the array will be marked as
 * pending delete. Then, the given path will be scanned for images, which will themselves
 * be added to the array and marked as pending upload with the proper path.
 * @param listing
 * @param path
 */
function updateImageMetadata(imageArray: any[], imagesAbsPath: string): void
{
    for (var i = 0; i < imageArray.length; i++)
    {
        imageArray[i].fileStatus = 'PendingDelete';
    }

    if (existsAndIsDir(imagesAbsPath))
    {
        var imageTypeDirs = fs.readdirSync(imagesAbsPath).filter(x =>
            fs.statSync(path.join(imagesAbsPath, x)).isDirectory());


        // Check all subdirectories for image types.
        for (var i = 0; i < imageTypeDirs.length; i++)
        {
            var imageTypeAbs = path.join(imagesAbsPath, imageTypeDirs[i]);
            console.log(`Reading images from ${imageTypeAbs}`);
            var currentFiles = fs.readdirSync(imageTypeAbs);
            var imageFiles = currentFiles.filter(p =>
                !fs.statSync(path.join(imageTypeAbs, p)).isDirectory() &&
                p.substring(p.length - 4) == '.png') // Store only supports png

            imageFiles.forEach((img) =>
            {
                var imageName = path.parse(img).name;
                var imageData = getImageAttributes(imageTypeAbs, imageName, currentFiles);
                if (imageData != undefined)
                {
                    imageArray.push(imageData);
                }
            });
        }
    }
}

/**
 * Obtain listing attributes from the given directory. If the metadata update type given in the task
 * params is "Json update", it is expected that a file named "<image>.json" will be present at the
 * given path, and will contain the attributes to update. If the metadata update type is "Text update",
 * the listing path will be scanned for *.<image>.txt files. Any .txt file will be added to the attributes.
 * The name of the file will indicate the name of the attribute.
 * @param imagesAbsPath The absolute path to the current image directory.
 * @param imageName The filename of the image, without its extension.
 * @param currentFiles A list of files in the directory.
 */
function getImageAttributes(imagesAbsPath: string, imageName: string, currentFiles: string[]): any
{
    if (taskParams.metadataUpdateType == MetadataUpdateType.JsonMetadata)
    {
        var jsonPath = path.join(imagesAbsPath, imageName + '.metadata.json');
        if (existsAndIsFile(jsonPath))
        {
            return requireAbsoluteOrRelative(jsonPath);
        }
        else
        {
            tl.warning('No metadata.json found for image ' + path.join(imagesAbsPath, imageName) +
                '. Image will be ignored');
            return undefined;
        }
    }
    else
    {
        var image: any = {};
        // Obtain *.<imageName>.txt files and add them as attributes
        var txtFiles = currentFiles.filter(p =>
            !fs.statSync(path.join(imagesAbsPath, p)).isDirectory() &&
            p.substring(p.length - 4 - imageName.length) == imageName + '.txt');

        for (var i = 0; i < txtFiles.length; i++)
        {
            var txtPath = path.join(imagesAbsPath, txtFiles[i]);
            var attrib = txtFiles[i].substring(0, txtFiles[i].length - 4);
            image[attrib] = fs.readFileSync(txtPath, 'utf-8');
        }

        // The type of image is the name of the directory in which we find the image.
        image.imageType = path.basename(imagesAbsPath);
        image.fileStatus = 'PendingUpload';

        // The filename we use is relative from the metadata root.
        var filenameForMetadata = path.join(imagesAbsPath.replace(taskParams.metadataRoot, ''), imageName + '.png');
        if (filenameForMetadata.charAt(0) == path.sep)
        {
            filenameForMetadata = filenameForMetadata.substring(1);
        }

        image.fileName = filenameForMetadata;
        return image;
    }

}

/**
 * Creates and uploads a zip file to the blob in the submissionResource.
 * @param submissionResource
 * @return Promises back the submission resource.
 */
function uploadZip(submissionResource: any, zipFilePath: string): any
{
    console.log(`Creating zip file into ${zipFilePath}`);

    var zip = new JSZip();
    console.log('Adding packages to zip');
    addPackagesToZip(zip);
    console.log('Adding images to zip');
    addImagesToZip(submissionResource, zip);

    var zipGenerationOptions = {
        base64: false,
        compression: 'DEFLATE',
        type: 'nodebuffer',
        streamFiles: true
    };

    console.log('Generating zip file');
    var buffer = zip.generate(zipGenerationOptions)
    fs.writeFileSync(zipFilePath, buffer);

    var requestParams = {
        headers: {
            'Content-Length': buffer.length,
            'x-ms-blob-type': 'BlockBlob'
        }
    }
    var deferred = Q.defer<any>();

    /* When doing a multipart form request, the request module erroneously (?) adds some headers like content-disposition
     * to the __contents__ of the file, which corrupts it. Therefore we have to use this instead, where the file is
     * piped from a stream to the put request. */
    fs.createReadStream(zipFilePath).pipe(request.put(submissionResource.fileUploadUrl, requestParams, function (err, resp, body)
    {
        if (err)
        {
            deferred.reject(err);
        }
        else if (resp.statusCode >= 400)
        {
            deferred.reject(new Error('Status code: ' + resp.statusCode + '. Body: ' + JSON.stringify(body)));
        }
        else
        {
            deferred.resolve(submissionResource);
        }
    }));

    return deferred.promise;
}

/**
 * Add the packages given as parameters to the task to the given zip file.
 * @param zip
 */
function addPackagesToZip(zip: JSZip): void
{
    var currentFiles = {};

    taskParams.packages.forEach((aPath, i) =>
    {
        if (!existsAndIsFile(aPath))
        {
            tl.warning('Supplied package ' + aPath + ' does not exist or is not a file. Skipping...');
        }
        else
        {
            // According to JSZip documentation, the directory separator used is a forward slash.
            var entry = makePackageEntry(aPath, i).replace('\\', '/');
            console.log(`Adding entry ${entry} to zip file from path ${aPath}`);
            zip.file(entry, fs.readFileSync(aPath), { compression: 'DEFLATE' });
        }
    });
}

/**
 * Add any PendingUpload images in the given submission resource to the given zip file.
 */
function addImagesToZip(submissionResource: any, zip: JSZip): void
{
    for (var listingKey in submissionResource.listings)
    {
        console.log(`Adding images for listing ${listingKey}`);
        var listing = submissionResource.listings[listingKey];
        addImagesToZipFromListing(listing.baseListing.images, zip);

        for (var platOverrideKey in listing.platformOverrides)
        {
            console.log(`Adding images for platform override ${platOverrideKey}`);
            var platOverride = listing.platformOverrides[platOverrideKey];
            addImagesToZipFromListing(platOverride.images, zip);
        }
    }
}

function addImagesToZipFromListing(images: any[], zip: JSZip): void
{
    for (var i = 0; i < images.length; i++)
    {
        if (images[i].fileStatus == 'PendingUpload')
        {
            var imgPath = path.join(taskParams.metadataRoot, images[i].fileName);
            // According to JSZip documentation, the directory separator used is a forward slash.
            var filenameInZip = images[i].fileName.replace('\\', '/');
            console.log(`Adding image path ${imgPath} into zip as ${filenameInZip}`);
            zip.file(filenameInZip, fs.readFileSync(imgPath), { compression: 'DEFLATE' });
        }
        else
        {
            console.log(`Skipping file ${images[i].fileName} with status ${images[i].fileStatus}`);
        }
    }
}


/**
 * Commits a submission, checking for any errors.
 * @param submissionResource
 */
function commit(submissionResource: any): any
{
    console.log('Committing submission...');
    var requestParams = {
        url: ROOT + 'applications/' + appId + '/submissions/' + submissionResource.id + '/commit',
        method: 'POST'
    };

    return api.performAuthenticatedRequest<any>(currentToken, requestParams, function (body, deferred)
    {
        var jbody = JSON.parse(body);
        if (jbody.errors !== undefined && jbody.errors.length > 0)
        {
            var errs = 'Errors occurred when committing:';
            for (var i = 0; i < jbody.errors.length; i++)
            {
                errs += '\n\t[' + jbody.errors[i].code + '] ' + jbody.errors[i].details;
            }

            deferred.reject(new Error(errs));
        }
        else
        {
            if (jbody.warnings !== undefined && jbody.warnings.length > 0)
            {
                var warns = 'Warnings occurred when committing:';
                for (var i = 0; i < jbody.warnings.length; i++)
                {
                    warns += '\n\t[' + jbody.warnings[i].code + '] ' + jbody.warnings[i].details;
                }

                tl.warning(warns);
            }

            deferred.resolve(submissionResource);
        }
    });
}

/**
 * Polls the status of a submission
 * @param submissionResource The submission to poll
 * @return A promise that will be fulfilled if the commit is successful, and rejected if the commit fails.
 */
function pollStatus(submissionResource: any): Q.Promise<void>
{
    const statusMsg = 'Submission ' + submissionResource.id + ' status for App ' + appId + ': ';
    const requestParams = {
        url: ROOT + 'applications/' + appId + '/submissions/' + submissionResource.id,
        method: 'GET'
    };

    var requestPromise = api.performAuthenticatedRequest<any>(currentToken, requestParams).then(function (body)
    {
        /* Once the previous request has finished, examine the body to tell if we should start a new one. */
        var jbody = JSON.parse(body);
        if (!jbody.status.endsWith('Failed'))
        {
            console.log(statusMsg + jbody.status);

            /* In immediate mode, we expect to get all the way to "Published" status.
             * In other modes, we stop at "Release" status. */
            if (    jbody.status == 'Published'
                || (jbody.status == 'Release' && jbody.targetPublishMode != 'Immediate'))
            {
                // Note that the fulfillment handler can either return a promise to a value (as below)
                // or a value itself (as here).
                return;
            }
            else
            {
                // Delay for some amount of time then try again.
                return Q.delay(POLL_DELAY).then<void>(() => pollStatus(submissionResource));
            }
        }
        else
        {
            tl.error(statusMsg + ' failed with ' + jbody.status);
            tl.error('Reported errors: ');
            for (var i = 0; i < jbody.statusDetails.errors.length; i++)
            {
                var errDetail = jbody.statusDetails.errors[i];
                tl.error('\t ' + errDetail.code + ': ' + errDetail.details);
            }
            throw new Error('Commit failed');
        }
    });

    return api.withRetry(5, requestPromise);
}



function existsAndIsDir(aPath: string)
{
    return fs.existsSync(aPath) && fs.statSync(aPath).isDirectory();
}

function existsAndIsFile(aPath: string)
{
    return fs.existsSync(aPath) && fs.statSync(aPath).isFile();
}

/**
 * Requires a file, making sure that the given path begins with a '.' if it is not absolute.
 */
function requireAbsoluteOrRelative(aPath: string): any
{
    if (path.isAbsolute(aPath))
    {
        return require(aPath);
    }
    else
    {
        /* If a path is not absolute, we must prefix it with the current directory.
        Otherwise require('some/module') will attempt to load from a __directory__
        called some/module */
        return require(path.join('.', aPath));
    }
}


/**
 * Recursively merge source and dest into dest. The properties exclusive to dest are conserved.
 * The properties exclusive to source are copied over to dest. The shared properties are
 * given source's value. For properties with object type, a recursive merge is done.
 * If a property is shared but has conflicting types, an error is thrown.
 *
 * N.B. Shared arrays simply get source's value copied to dest. There is no attempt to perform
 * element-wise merging, or union/intersection of the arrays.
 *
 * mergeObjects(x, x) and mergeObjects(x, undefined) have no effect on x
 * If a === {}, then after mergeObjects(a, x), we have a === x
 *
 * @param dest
 * @param source
 */
function mergeObjects(dest: any, source: any): void
{
    for (var prop in source)
    {
        console.log(`Merging property ${prop}`);
        if (!dest[prop])
        {
            console.log(`Property ${prop} does not exist in destination object, adding it.`);
            dest[prop] = source[prop];
        }
        else if (typeof source[prop] != 'undefined')
        {
            if (typeof dest[prop] != typeof source[prop])
            {
                var error = `Could not merge objects: conflicting types for property ${prop}: `
                    + `source has type ${typeof source[prop]}, but dest has type ${typeof dest[prop]}`;
                console.log(error);
                throw new Error(error);
            }

            if (typeof dest[prop] == 'object' && !Array.isArray(dest[prop]))
            {
                console.log(`Property ${prop} is an object, merging internal properties...`);
                mergeObjects(dest[prop], source[prop]);
            }
            else
            {
                console.log(`Overriding destination value:`)
                console.log(`<${dest[prop]}>`);
                console.log(`with source value `);
                console.log(`<${source[prop]}>`);
                dest[prop] = source[prop];
            }
        }
        else
        {
            console.log(`Property ${prop} is undefined in source, skipping.`);
        }
        console.log(`Done merging property ${prop}`);
    }
}

/** Split a string on both '\n' and '\r\n', removing empty entries. */
function splitAnyNewline(str: string): string[]
{
    return str.replace('\r\n', '\n').split('\n').filter(s => s.length > 0);
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