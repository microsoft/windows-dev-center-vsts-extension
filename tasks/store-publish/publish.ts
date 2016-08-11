/*
 * Behavior for the Publish task. Takes authentication information, app information, and packages,
 * and publishes to the Store.
 */

/// <reference path="../../typings/globals/node/index.d.ts" />
/// <reference path="../../typings/globals/jszip/index.d.ts" />
/// <reference path="../../typings/globals/request/index.d.ts" />
/// <reference path="../../node_modules/vsts-task-lib/task.d.ts" />

import api = require('./apiWrapper');

import fs = require('fs');
import path = require('path');
import os = require('os');

import JSZip = require('jszip');
import Q = require('q');
import request = require('request');
var streamifier = require('streamifier'); // streamifier has no typings
import tl = require('vsts-task-lib');

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

/**
 * Type guard: indicates whether these parameters contain an App Id or not.
 */
export function hasAppId(p: PublishParams): p is ParamsWithAppId
{
    return (<ParamsWithAppId>p).appId != undefined;
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
 * A little part of the URL to the API that contains a version number.
 * This may need to be updated in the future to comply with the API.
 */
const API_URL_VERSION_PART = '/v1.0/my/';

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
export async function publishTask(params: PublishParams)
{
    taskParams = params;

    /* We expect the endpoint part of this to have a slash at the end.
     * This is because authenticating to 'endpoint' will give us an
     * invalid token, while authenticating to 'endpoint/' will work */
    ROOT = taskParams.endpoint + API_URL_VERSION_PART;

    currentToken = await api.authenticate(taskParams.endpoint, taskParams.authentication);

    var appResource = await getAppResource();

    appId = appResource.id; // Globally set app ID for future steps.

    // Delete pending submission if force is turned on (only one pending submission can exist)
    if (taskParams.force && appResource.pendingApplicationSubmission != undefined)
    {
        await deleteSubmission(appResource.pendingApplicationSubmission.resourceLocation);
    }

    var submissionResource = await createSubmission();
    await putMetadata(submissionResource);

    var zip = createZip(taskParams.packages, submissionResource);
    // There might be no files in the zip if the user didn't supply any packages or images.
    // If there are files, write the file locally and also upload it.
    if (Object.keys(zip.files).length > 0)
    {
        var buf: Buffer = createZipBuffer(zip);
        fs.writeFileSync(taskParams.zipFilePath, buf);
        await uploadZip(buf, submissionResource.fileUploadUrl);
    }

    await commit(submissionResource.id);
    await pollSubmissionStatus(submissionResource.id);

    tl.setResult(tl.TaskResult.Succeeded, 'Submission completed');
}

/**
 * Obtain an app resource from the store, either from the app name or the app id
 * (depending on what was given to us)
 */
function getAppResource(): Q.Promise<any>
{
    if (hasAppId(taskParams))
    {
        // If we have an app ID then we can directly obtain its information
        tl.debug(`Getting app information (by app ID) for ${taskParams.appId}`);
        var requestParams = {
            url: ROOT + 'applications/' + taskParams.appId,
            method: 'GET'
        };

        return api.performAuthenticatedRequest<any>(currentToken, requestParams);
    }
    else 
    {
        // Otherwise go look for it through the pages of apps, using the primary name we got.
        tl.debug(`Getting app information (by app name) for ${taskParams.appName}`);
        return getAppResourceFromName(taskParams.appName);
    }
}

/**
 * Tries to obtain an app resource from the primary name of an app.
 * This will only work with the primary name.
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

    tl.debug(`\tSearching for app ${givenAppName} on ${currentPage}`);

    var requestParams = {
        url: ROOT + currentPage,
        method: 'GET'
    };

    return api.performAuthenticatedRequest<any>(currentToken, requestParams).then(body =>
    {
        var foundAppResource = (<any[]>body.value).find(x => x.primaryName == givenAppName);
        if (foundAppResource)
        {
            tl.debug(`App found with ${foundAppResource.id}`);
            return foundAppResource;
        }

        if (body['@nextLink'] === undefined)
        {
            throw new Error(`No application with name "${givenAppName}" was found`);
        }

        return getAppResourceFromName(givenAppName, body['@nextLink']);
    });
}

/**
 * If the 'force' parameter is turned on, checks whether a submission is already existing and
 * deletes it if it's the case.
 * @param appResource
 * @return A promise for the deletion of the submission
 */
function deleteSubmission(submissionLocation: string): Q.Promise<void>
{
    tl.debug(`Deleting submission ${submissionLocation}`);
    var requestParams = {
        url: ROOT + submissionLocation,
        method: 'DELETE'
    };

    return api.performAuthenticatedRequest<void>(currentToken, requestParams);
}

/** Creates a submission for a given app. Promises the submission resource. */
function createSubmission(): Q.Promise<any>
{
    tl.debug('Creating new submission');
    var requestParams = {
        url: ROOT + 'applications/' + appId + '/submissions',
        method: 'POST'
    };

    return api.performAuthenticatedRequest<any>(currentToken, requestParams);
}

/**
 * Adds the required metadata to the submission request, depending on the given parameters.
 * If no metadata update is to be perfomed, no changes are made. Otherwise, we look for the metadata
 * depending on the type of update (text or json).
 * @param submissionResource The current submission request
 * @returns A promise for the update of the submission on the server.
 */
function putMetadata(submissionResource: any): Q.Promise<void>
{
    tl.debug(`Adding metadata for new submission ${submissionResource.id}`);

    if (taskParams.metadataUpdateType != MetadataUpdateType.NoUpdate &&
        taskParams.metadataRoot)
    {
        updateMetadata(submissionResource);
    }

    // Also at this point add the given packages to the list of packages to upload.
    tl.debug(`Adding ${taskParams.packages.length} package(s)`);
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

    tl.debug(`Performing metadata update`);
    return api.performAuthenticatedRequest<void>(currentToken, requestParams);
}

/**
 * Updates the metadata information given in the metadata root.
 * The expected format is as follows:
 *
 *  <metadata root>
 *  |
 *  +-- <locale> (e.g. en-us)
 *      |
 *      +-- [baseListing]
 *      |    +-- metadata.json (or <attribute>.txt)
 *      |    +-- images
 *      |        |
 *      |        +-- <image type> (e.g. MobileScreenshot)
 *      |            +-- <image>.png
 *      |            +-- <image>.json (or <attribute>.<image>.txt)
 *      |
 *      +-- [platformOverrides]
 *           |
 *           +-- <platform> (e.g. Windows80)
 *               |
 *               +-- <same structure as 'baseListing'>
 *
 * If the task parameter for metadata update is "Text metadata", one
 * text file is expected for each attribute to be added. If it is
 * JSON metadata, one JSON file per listing and per image is expected.
 *
 * Both the baseListing and platformOverrides directory are optional.
 *
 * @param submissionResource A submission resource that will be modified in-place.
 */
function updateMetadata(submissionResource: any): void
{
    tl.debug(`Updating metadata of submission object from directory ${taskParams.metadataRoot}`);
    // Update metadata for listings
    var listingPaths = fs.readdirSync(taskParams.metadataRoot);
    listingPaths.forEach(listingPath =>
    {
        tl.debug(`Obtaining metadata for language ${listingPath}`);
        let listingAbsPath = path.join(taskParams.metadataRoot, listingPath);

        // Create the listing object if it is not present
        if (submissionResource.listings[listingPath] === undefined)
        {
            submissionResource.listings[listingPath] = {};
        }

        // Merge the existing listing object with the new listing made from the given path
        // Overrides are also checked in the makeListing call.
        mergeObjects(submissionResource.listings[listingPath], makeListing(listingAbsPath, submissionResource.listings[listingPath]));
    });

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
        tl.debug(`Updating images from ${listingAbsPath}`);
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
            tl.debug(`Updating platform override images from ${platPath}`);
            updateImageMetadata(platOverrideRef.images, platPath);
        }
    }
}

/**
 * Construct a listing whose root is in the given path. This listing includes a base listing and
 * potentially some platform overrides.
 * @param listingPath
 */
function makeListing(listingAbsPath: string, languageJsonObj: any): any
{
    var baseListing = undefined;
    var platformOverrides = undefined;

    // Check for a base listing.
    var basePath = path.join(listingAbsPath, 'baseListing');
    if (existsAndIsDir(basePath))
    {
        tl.debug('Obtaining base listing');
        baseListing = getListingAttributes(basePath, languageJsonObj.baseListing);
    }
    

    // Check for platform overrides.
    var overridesPath = path.join(listingAbsPath, 'platformOverrides');
    if (existsAndIsDir(overridesPath))
    {
        platformOverrides = {};
        // If we do, consider each directory in the platformOverrides directory as a platform.
        var allOverrideDirs = fs.readdirSync(overridesPath).filter((x) =>
            fs.statSync(path.join(overridesPath, x)).isDirectory());

        allOverrideDirs.forEach(overrideDir =>
        {
            var overridePath = path.join(overridesPath, overrideDir);
            console.log(`Obtaining platform override ${overridePath}`);
            platformOverrides[overrideDir] = getListingAttributes(overridePath, languageJsonObj.platformOverrides);
        });
    }

    // Avoid creating spurious properties on the return if they are undefined.
    var ret: any = {};
    if (baseListing != undefined)
    {
        ret.baseListing = baseListing;
    }
    if (platformOverrides != undefined)
    {
        ret.platformOverrides = platformOverrides;
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
            tl.debug(`Loading listing attributes from ${jsonPath}`);
            listing = requireAbsoluteOrRelative(jsonPath);
        }
    }
    else
    {
        // Mapping from all-lowercase prop. names to their real casing in the json object
        var jsonPropCaseMapping = {};
        for (var prop in jsonObj)
        {
            jsonPropCaseMapping[prop.toLowerCase()] = prop;
        }

        var propFiles = fs.readdirSync(listingWithPlatAbsPath).filter(p =>
            fs.statSync(path.join(listingWithPlatAbsPath, p)).isFile() &&
            path.extname(p) == '.txt');

        propFiles.forEach(propPath =>
        {
            /* If this filename compares case-insensitive to an existing property, set
             * that particular property. Preserve the name if the property does not exist already.*/
            var originalPropName = path.basename(propPath, '.txt'); 
            var normalizedPropertyName = originalPropName.toLocaleLowerCase();
            if (jsonPropCaseMapping[normalizedPropertyName] != undefined)
            {
                originalPropName = jsonPropCaseMapping[normalizedPropertyName];
            }

            // Obtain the contents of the file as the value of the property
            var txtPath = path.join(listingWithPlatAbsPath, propPath);
            console.log(`Loading individual listing attribute from ${txtPath}`);
            var contents = fs.readFileSync(txtPath, 'utf-8');

            // Based on whether this is an array or string attribute, split or not.
            listing[originalPropName] = STRING_ARRAY_ATTRIBUTES[normalizedPropertyName] ? splitAnyNewline(contents) : contents;
        });

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
    imageArray.forEach(img => img.fileStatus = 'PendingDelete');

    if (existsAndIsDir(imagesAbsPath))
    {
        var imageTypeDirs = fs.readdirSync(imagesAbsPath).filter(x =>
            fs.statSync(path.join(imagesAbsPath, x)).isDirectory());

        // Check all subdirectories for image types.
        imageTypeDirs.forEach(imageTypeDir =>
        {
            var imageTypeAbs = path.join(imagesAbsPath, imageTypeDir);
            var currentFiles = fs.readdirSync(imageTypeAbs);
            var imageFiles = currentFiles.filter(p =>
                !fs.statSync(path.join(imageTypeAbs, p)).isDirectory() &&
                path.extname(p) == '.png') // Store only supports png

            imageFiles.forEach(img =>
            {
                var imageName = path.parse(img).name;
                var imageData = getImageAttributes(imageTypeAbs, imageName, currentFiles);
                if (imageData != undefined)
                {
                    imageArray.push(imageData);
                }
            });
        });
    }
}

/**
 * Obtain image attributes from the given directory. If the metadata update type given in the task
 * params is "Json update", it is expected that a file named "<image>.json" will be present at the
 * given path, and will contain the attributes to update. If the metadata update type is "Text update",
 * the listing path will be scanned for *.<image>.txt files. Any .txt file will be added to the attributes.
 * The name of the file will indicate the name of the attribute.
 *
 * In addition, the image will be marked as pending upload, and its image type will be given by the name
 * of the directory it's in.
 *
 * @param imagesAbsPath The absolute path to the current image directory.
 * @param imageName The filename of the image, without its extension.
 * @param currentFiles A list of files in the directory.
 */
function getImageAttributes(imagesAbsPath: string, imageName: string, currentFiles: string[]): any
{
    var image: any = {};
    var imageAbsName = path.join(imagesAbsPath, imageName);

    if (taskParams.metadataUpdateType == MetadataUpdateType.JsonMetadata)
    {
        
        var jsonPath = path.join(imagesAbsPath, imageName + '.metadata.json');
        tl.debug(`Loading attributes for ${imageAbsName} from ${jsonPath}`);
        image = requireAbsoluteOrRelative(jsonPath);
    }
    else
    {
        // Obtain *.<imageName>.txt files and add them as attributes
        var txtFiles = currentFiles.filter(p =>
            !fs.statSync(path.join(imagesAbsPath, p)).isDirectory() &&
            p.substring(p.length - 4 - imageName.length) == imageName + '.txt');

        txtFiles.forEach(txtFile =>
        {
            var txtPath = path.join(imagesAbsPath, txtFile);
            tl.debug(`Loading individual attribute for ${imageAbsName} from ${txtPath}`);
            var attrib = txtFile.substring(0, txtFile.indexOf('.'));
            image[attrib] = fs.readFileSync(txtPath, 'utf-8');
        });
    }

    // The type of image is the name of the directory in which we find the image.
    image.imageType = path.basename(imagesAbsPath);
    image.fileStatus = 'PendingUpload';

    // The filename we use is relative from the metadata root.
    // Surprisingly, there is no proper way to do this, so we use a dumb replace.
    var filenameForMetadata = path.join(imagesAbsPath.replace(taskParams.metadataRoot, ''), imageName + '.png');
    if (filenameForMetadata.charAt(0) == path.sep)
    {
        filenameForMetadata = filenameForMetadata.substring(1);
    }

    image.fileName = filenameForMetadata;
    return image;

}

/**
 * Create a zip file containing the information 
 * @param submissionResource
 */
function createZip(packages: string[], submissionResource: any): JSZip
{
    tl.debug(`Creating zip file`);
    var zip = new JSZip();
    addPackagesToZip(packages, zip);
    addImagesToZip(submissionResource, zip);
    return zip;
}

/**
 * Add the given packages to the given zip file.
 * Each package is placed under its own directory that is named by the index of the
 * package in this list. This is to prevent name collisions.
 * @see makePackageEntry
 */
function addPackagesToZip(packages: string[], zip: JSZip): void
{
    var currentFiles = {};

    packages.forEach((aPath, i) =>
    {
        // According to JSZip documentation, the directory separator used is a forward slash.
        var entry = makePackageEntry(aPath, i).replace('\\', '/');
        console.log(`Adding package path ${aPath} to zip as ${entry}`);
        zip.file(entry, fs.readFileSync(aPath), { compression: 'DEFLATE' });
    });
}

/**
 * Add any PendingUpload images in the given submission resource to the given zip file.
 */
function addImagesToZip(submissionResource: any, zip: JSZip)
{
    for (var listingKey in submissionResource.listings)
    {
        console.log(`Adding images for listing ${listingKey}`);
        var listing = submissionResource.listings[listingKey];
        addImagesToZipFromListing(listing.baseListing.images, zip);

        for (var platOverrideKey in listing.platformOverrides)
        {
            console.log(`Adding images for platform override ${listingKey}/${platOverrideKey}`);
            var platOverride = listing.platformOverrides[platOverrideKey];
            addImagesToZipFromListing(platOverride.images, zip);
        }
    }
}

function addImagesToZipFromListing(images: any[], zip: JSZip)
{
    images.filter(image => image.fileStatus == 'PendingUpload').forEach(image =>
    {
        var imgPath = path.join(taskParams.metadataRoot, image.fileName);
        // According to JSZip documentation, the directory separator used is a forward slash.
        var filenameInZip = image.fileName.replace('\\', '/');
        console.log(`Adding image path ${imgPath} to zip as ${filenameInZip}`);
        zip.file(filenameInZip, fs.readFileSync(imgPath), { compression: 'DEFLATE' });
    });
}

/**
 * Creates a buffer to the given zip file.
 */
function createZipBuffer(zip: JSZip): Buffer
{
    var zipGenerationOptions = {
        base64: false,
        compression: 'DEFLATE',
        type: 'nodebuffer',
        streamFiles: true
    };

    return zip.generate(zipGenerationOptions);
}

/**
 * Creates and uploads a zip file to the appropriate blob.
 * @param zip A buffer containing the zip file
 * @return A promise for the upload of the zip file.
 */
function uploadZip(zip: Buffer, blobUrl: string): Q.Promise<void>
{
    var requestParams = {
        headers: {
            'Content-Length': zip.length,
            'x-ms-blob-type': 'BlockBlob'
        }
    }
    var deferred = Q.defer<void>();
    
    /* The URL we get from the Store sometimes has unencoded '+' and '=' characters because of a
     * base64 parameter. There is no good way to fix this, because we don't really know how to
     * distinguish between 'correct' uses of those characters, and their spurious instances in
     * the base64 parameter. In our case, we just take the compromise of replacing every instance
     * of '+' with its url-encoded counterpart. */
    var dest = /*submissionResource.fileUploadUrl*/ blobUrl.replace(/\+/g, '%2B');
    console.log(`Uploading to ${dest}`);

    /* When doing a multipart form request, the request module erroneously (?) adds some headers like content-disposition
     * to the __contents__ of the file, which corrupts it. Therefore we have to use this instead, where the zip is
     * piped from a stream to the put request. */
    streamifier.createReadStream(zip).pipe(request.put(dest, requestParams, function (err, resp, body)
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
            deferred.resolve();
        }
    }));

    return deferred.promise;
}

/**
 * Commits a submission, checking for any errors.
 * @return A promise for the commit of the submission
 */
function commit(submissionId: string): Q.Promise<void>
{
    console.log('Committing submission...');
    var requestParams = {
        url: ROOT + 'applications/' + appId + '/submissions/' + submissionId + '/commit',
        method: 'POST'
    };

    return api.performAuthenticatedRequest<void>(currentToken, requestParams);
}

/**
 * Polls the status of a submission
 * @param submissionResource The submission to poll
 * @return A promise that will be fulfilled if the commit is successful, and rejected if the commit fails.
 */
function pollSubmissionStatus(submissionId: string): Q.Promise<void>
{
    var submissionCheckGenerator = () => checkSubmissionStatus(submissionId);
    return api.withRetry(5, submissionCheckGenerator, err => !is400Error(err)).then(status =>
    {
        if (status)
        {
            return;
        }
        else
        {
            return Q.delay(POLL_DELAY).then(() => pollSubmissionStatus(submissionId));
        }
    });
}

/** Indicates whether the given object is an HTTP response for a 4xx error. */
function is400Error(err): boolean
{
    // Does this look like a ResponseInformation?
    if (err.response != undefined && typeof err.response.statusCode == 'number')
    {
        return err.response.statusCode >= 400
            && err.response.statusCode < 500
    }

    return false;
}

/**
 * Checks the status of a submission.
 * @param submissionId
 * @return A promise for the status of the submission: true for completed, false for not completed yet.
 * The promise will be rejected if an error occurs in the submission.
 */
function checkSubmissionStatus(submissionId: string): Q.Promise<boolean>
{
    const statusMsg = 'Submission ' + submissionId + ' status for App ' + appId + ': ';
    const requestParams = {
        url: ROOT + 'applications/' + appId + '/submissions/' + submissionId,
        method: 'GET'
    };

    return api.performAuthenticatedRequest<any>(currentToken, requestParams).then(function (body)
    {
        /* Once the previous request has finished, examine the body to tell if we should start a new one. */
        if (!body.status.endsWith('Failed'))
        {
            tl.debug(statusMsg + body.status);

            /* In immediate mode, we expect to get all the way to "Published" status.
             * In other modes, we stop at "Release" status. */
            return body.status == 'Published'
                || (body.status == 'Release' && body.targetPublishMode != 'Immediate');
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
            throw new Error('Commit failed');
        }
    });
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
        if (!dest[prop])
        {
            dest[prop] = source[prop];
        }
        else if (typeof source[prop] != 'undefined')
        {
            if (typeof dest[prop] != typeof source[prop])
            {
                var error = `Could not merge objects: conflicting types for property ${prop}: `
                    + `source has type ${typeof source[prop]}, but dest has type ${typeof dest[prop]}`;
                throw new Error(error);
            }

            if (typeof dest[prop] == 'object' && !Array.isArray(dest[prop]))
            {
                mergeObjects(dest[prop], source[prop]);
            }
            else
            {
                dest[prop] = source[prop];
            }
        }
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