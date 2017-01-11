/*
 * Behavior for the Publish task. Takes authentication information, app information, and packages,
 * and publishes to the Store.
 */

/// <reference path="../../typings/index.d.ts" />
/// <reference path="../../node_modules/vsts-task-lib/task.d.ts" />

import api = require('../common/apiHelper');
import request = require('../common/requestHelper');

import fs = require('fs');
import path = require('path');

import Q = require('q');
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
    authentication: request.Credentials;

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

    /**
     * Whether images should also be updated when a submission updates metadata.
     */
    updateImages: boolean;

    /** A list of paths to the packages to be uploaded. */
    packages: string[];

    /** A path where the zip file to be uploaded to the dev center will be stored. */
    zipFilePath: string;

    /** 
     * If true, waiting to finish the submisons.
     * Otherwise, not.
     */
    waiting: boolean;
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
var currentToken: request.AccessToken;

/** The app ID we are publishing to */
var appId: string;

/**
 * The main task function.
 */
export async function publishTask(params: PublishParams)
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

    // Delete pending submission if force is turned on (only one pending submission can exist)
    if (taskParams.force && appResource.pendingApplicationSubmission != undefined)
    {
        console.log('Deleting existing submission...');
        await deleteAppSubmission(appResource.pendingApplicationSubmission.resourceLocation);
    }

    console.log('Creating submission...');
    var submissionResource = await createAppSubmission();

    console.log('Updating submission...');
    await putMetadata(submissionResource);

    console.log('Creating zip file...');
    var zip = api.createZipFromPackages(taskParams.packages);
    addImagesToZip(submissionResource, zip);

    // There might be no files in the zip if the user didn't supply any packages or images.
    // If there are files, persist the file.
    if (Object.keys(zip.files).length > 0)
    {
        await api.persistZip(zip, taskParams.zipFilePath, submissionResource.fileUploadUrl);
    }

    console.log('Committing submission...');
    await commitAppSubmission(submissionResource.id);

    if (taskParams.waiting)
    {
        console.log('Polling submission...');
        var resourceLocation = `applications/${appId}/submissions/${submissionResource.id}`;
        await api.pollSubmissionStatus(currentToken, resourceLocation, submissionResource.targetPublishMode);
    }

    tl.setResult(tl.TaskResult.Succeeded, 'Submission completed');
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

    tl.debug(`Getting app resource from ID ${appId}`);
    var requestParams = {
        url: api.ROOT + 'applications/' + appId,
        method: 'GET'
    };

    return request.performAuthenticatedRequest<any>(currentToken, requestParams);
}


/**
 * @return Promises the deletion of a resource
 */
function deleteAppSubmission(submissionLocation: string): Q.Promise<void>
{
    return api.deleteSubmission(currentToken, api.ROOT + submissionLocation);
}

/** 
 * Creates a submission for a given app.
 * @return Promises the new submission resource.
 */
function createAppSubmission(): Q.Promise<any>
{
    return api.createSubmission(currentToken, api.ROOT + 'applications/' + appId + '/submissions');
}

/**
 * Commits a submission, checking for any errors.
 * @return A promise for the commit of the submission
 */
function commitAppSubmission(submissionId: string): Q.Promise<void>
{
    return api.commitSubmission(currentToken, api.ROOT + 'applications/' + appId + '/submissions/' + submissionId + '/commit');
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
    api.includePackagesInSubmission(taskParams.packages, submissionResource.applicationPackages);

    var url = api.ROOT + 'applications/' + appId + '/submissions/' + submissionResource.id;

    return api.putSubmission(currentToken, url, submissionResource);
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
    var listings = fs.readdirSync(taskParams.metadataRoot);
    listings.forEach(listing =>
    {
        updateListingAttributes(submissionResource, listing);

        if (taskParams.updateImages)
        {
            updateListingImages(submissionResource, listing);
        }
    });
}

/**
 * Update the attributes of a listing in a submission (e.g. description, features, etc.)
 * @param submissionResource
 * @param listingPath
 */
function updateListingAttributes(submissionResource: any, listing: string)
{
    tl.debug(`Obtaining metadata for language ${listing}`);

    // Create the listing object if it is not present
    if (submissionResource.listings[listing] === undefined)
    {
        submissionResource.listings[listing] = {};
    }

    // Merge the existing listing object with the new listing made from the given path
    // Overrides are also checked in the makeListing call.
    var listingPath = path.join(taskParams.metadataRoot, listing);
    mergeObjects(submissionResource.listings[listing], makeListing(listingPath), true);
}

/**
 * Update the images (and their metadata) of a listing in a submission.
 * @param submissionResource
 * @param listingPath
 */
function updateListingImages(submissionResource: any, listing: string)
{
    tl.debug(`Obtaining images for language ${listing}`);

    var listingPath = path.join(taskParams.metadataRoot, listing);

    var base = submissionResource.listings[listing].baseListing;
    if (base != undefined)
    {
        if (base.images == undefined)
        {
            base.images = [];
        }
        tl.debug(`Updating images from ${listingPath}`);
        updateImageMetadata(base.images, path.join(listingPath, 'baseListing', 'images'));
    }

    // Do the same for all the platform overrides
    for (var platOverride in submissionResource.listings[listing].platformOverrides)
    {
        var platPath = path.join(listingPath, 'platformOverrides', platOverride, 'images');
        var platOverrideRef = submissionResource.listings[listing].platformOverrides[platOverride];
        if (platOverrideRef.images == undefined)
        {
            platOverrideRef.images = [];
        }
        tl.debug(`Updating platform override images from ${platPath}`);
        updateImageMetadata(platOverrideRef.images, platPath);
    }
}

/**
 * Construct a listing whose root is in the given path. This listing includes a base listing and
 * potentially some platform overrides.
 * @param listingPath
 */
function makeListing(listingAbsPath: string): any
{
    var baseListing = undefined;
    var platformOverrides = undefined;

    // Check for a base listing.
    var basePath = path.join(listingAbsPath, 'baseListing');
    if (existsAndIsDir(basePath))
    {
        tl.debug('Obtaining base listing');
        baseListing = getListingAttributes(basePath);
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
            tl.debug(`Obtaining platform override ${overridePath}`);
            platformOverrides[overrideDir] = getListingAttributes(overridePath);
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
function getListingAttributes(listingWithPlatAbsPath: string): any
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
        var propFiles = fs.readdirSync(listingWithPlatAbsPath).filter(p =>
            fs.statSync(path.join(listingWithPlatAbsPath, p)).isFile() &&
            path.extname(p) == '.txt');

        propFiles.forEach(propPath =>
        {
            // Obtain the contents of the file as the value of the property
            var txtPath = path.join(listingWithPlatAbsPath, propPath);
            tl.debug(`Loading individual listing attribute from ${txtPath}`);
            var contents = fs.readFileSync(txtPath, 'utf-8');

            // Based on whether this is an array or string attribute, split or not.
            var propName = path.basename(propPath, '.txt');
            listing[propName] = STRING_ARRAY_ATTRIBUTES[propName.toLowerCase()] ? splitAnyNewline(contents) : contents;
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
 * Add any PendingUpload images in the given submission resource to the given zip file.
 */
function addImagesToZip(submissionResource: any, zip)
{
    for (var listingKey in submissionResource.listings)
    {
        tl.debug(`Checking for new images in listing ${listingKey}...`);
        var listing = submissionResource.listings[listingKey];

        if (listing.baseListing.images)
        {
            addImagesToZipFromListing(listing.baseListing.images, zip);
        }

        for (var platOverrideKey in listing.platformOverrides)
        {
            tl.debug(`Checking for new images in platform override ${listingKey}/${platOverrideKey}...`);
            var platOverride = listing.platformOverrides[platOverrideKey];

            if (platOverride.images)
            {
                addImagesToZipFromListing(platOverride.images, zip);
            }
        }
    }
}

function addImagesToZipFromListing(images: any[], zip)
{
    images.filter(image => image.fileStatus == 'PendingUpload').forEach(image =>
    {
        var imgPath = path.join(taskParams.metadataRoot, image.fileName);
        // According to JSZip documentation, the directory separator used is a forward slash.
        var filenameInZip = image.fileName.replace(/\\/g, '/');
        tl.debug(`Adding image path ${imgPath} to zip as ${filenameInZip}`);
        zip.file(filenameInZip, fs.createReadStream(imgPath), { compression: 'DEFLATE' });
    });
}




// ===
// The functions below, while general, are here because they only apply to dealing with metadata.
// As such, they don't need to accessible to other tasks.
// ===

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
 * The effect of ignoreCase is exemplified thus:
 *   mergeObjects( { ABC: 1 }, { abc: 2 }, true) -> dest is { ABC: 2 }          // case ignored
 *   mergeObjects( { ABC: 1 }, { abc: 2 }, false) -> dest is { ABC: 1, abc: 2 } // case preserved
 *
 * @param dest
 * @param source
 * @param ignoreCase
 */
function mergeObjects(dest: any, source: any, ignoreCase: boolean): void
{
    ignoreCase = ignoreCase == undefined ? true : ignoreCase;
    var destPropsCaseMapping = {};
    if (ignoreCase)
    {
        for (var prop in dest)
        {
            destPropsCaseMapping[prop.toLowerCase()] = prop;
        }
    }

    for (var sourceProp in source)
    {
        var destProp = sourceProp;
        if (ignoreCase && destPropsCaseMapping[sourceProp.toLowerCase()] != undefined)
        {
            destProp = destPropsCaseMapping[sourceProp.toLowerCase()];
        }


        if (!dest[destProp])
        {
            dest[destProp] = source[sourceProp];
        }
        else if (typeof source[sourceProp] != 'undefined')
        {
            if (typeof dest[destProp] != typeof source[sourceProp])
            {
                var error = `Could not merge objects: conflicting types for property ${sourceProp}: `
                    + `source has type ${typeof source[sourceProp]}, but dest has type ${typeof dest[destProp]}`;
                throw new Error(error);
            }

            if (typeof dest[destProp] == 'object' && !Array.isArray(dest[destProp]))
            {
                mergeObjects(dest[destProp], source[sourceProp], ignoreCase);
            }
            else
            {
                dest[destProp] = source[sourceProp];
            }
        }
    }
}

/** Split a string on both '\n' and '\r\n', removing empty or whitespace entries. */
function splitAnyNewline(str: string): string[]
{
    return str.replace(/\r\n/g, '\n').split('\n').filter(s => s.trim().length > 0);
}
