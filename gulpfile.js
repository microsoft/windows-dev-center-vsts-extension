var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');

var argv = require('yargs').argv;
var del = require('del');
var gulp = require('gulp');
var download = require('gulp-download');
var decompress = require('gulp-decompress');
var gulp_exec = require('gulp-exec');
var gulpif = require('gulp-if');
var git = require('gulp-git');
var multidest = require('gulp-multi-dest');
var nuget = require('gulp-nuget');
var rename = require('gulp-rename');
var replace = require('gulp-replace');
var tsc = require('gulp-typescript');
var merge = require('merge-stream');
var spawn = require('child_process').spawn;
var request = require('request');

const EXTENSION_MANIFEST = 'vss-extension.json';
const BUILD_DIR = 'build/';
const COMMON_TASK_DIR = 'common';
const PS_COMMON_TASK_DIR = 'ps_common';
const TASKS_DIR = 'tasks';

const DEV_MANIFEST_OVERRIDE = {
    public: false,
    "id": "windows-store-publish-dev",
    "name": "Windows Store Dev",
};

// Get all task directories except common and transform them into gulp dests of the corresponding build directory
// This is not the most optimal, but the 'best' way barring having a dest-like plugin that takes a glob.
const TASK_DIRECTORIES_V1 = fs.readdirSync(TASKS_DIR)
    .filter(function(p) { return fs.statSync(path.join(TASKS_DIR, p)).isDirectory() && p.endsWith('V1');});

// Construct gulp destinations out of the task directories.
function getTaskV1Destinations() {
    return TASK_DIRECTORIES_V1.map(function(p) { return path.join(BUILD_DIR, p); });
}

// Convert the override JavaScript object to a JSON string, adding a backslash before any double quotes as that's needed for the shell exec
function toOverrideString(object) {
    return JSON.stringify(object).replace(/"/g, '\\"');
}

/* *****
 "Internal" tasks below.
 There should be no need to call these tasks directly.
***** */
gulp.task('get_vsts_task_sdk', function(gulpCallBack) {
    child = spawn("powershell.exe", ["Save-Module -Name VstsTaskSdk -Path ./lib/ps_modules -RequiredVersion 0.21.0"]);

    child.stdout.on("data",function(data){
        console.log(data.toString());
    });

    child.stderr.on("data",function(data){
        throw(data.toString());
    });

    child.on("exit", function() {
        gulpCallBack();
    });
});

gulp.task('move_vsts_task_sdk', gulp.series('get_vsts_task_sdk', function() {
    var VstsSdkPath = __dirname + "/lib/ps_modules/VstsTaskSdk"
    return gulp.src([VstsSdkPath + "/0.21.0/**/*"])
        .pipe(gulp.dest(VstsSdkPath));
}));

gulp.task('get_ado_azurehelper_sdk', function(gulpCallBack) {
    child = spawn("powershell.exe", ["Save-Module -Name AdoAzureHelper -Path ./lib/ps_modules -RequiredVersion 1.0.12"]);

    child.stdout.on("data",function(data){
        console.log(data.toString());
    });

    child.stderr.on("data",function(data){
        throw(data.toString());
    });

    child.on("exit", function() {
        gulpCallBack();
    });
});

gulp.task('move_ado_azurehelper_sdk', gulp.series('get_ado_azurehelper_sdk', function() {
    var VstsSdkPath = __dirname + "/lib/ps_modules/AdoAzureHelper"
    return gulp.src([VstsSdkPath + "/1.0.12/**/*"])
        .pipe(gulp.dest(VstsSdkPath));
}));

gulp.task('remove_version_folder', gulp.series(gulp.series('move_vsts_task_sdk', 'move_ado_azurehelper_sdk'), function() {
    return del([__dirname + '/lib/ps_modules/VstsTaskSdk/0.21.0', __dirname + '/lib/ps_modules/AdoAzureHelper/1.0.12']);
}));

gulp.task('get_storebroker', function(done) {
    git.clone('https://github.com/microsoft/StoreBroker', {args: '--branch v2 --single-branch ./lib/ps_modules/StoreBroker'});
    done()
});

gulp.task('get_openssl', function(done) {
    download('https://vstsagenttools.blob.core.windows.net/tools/openssl/1.0.2/M153/openssl.zip')
    .pipe(decompress())
    // Replace any empty space in the file name with underscore because you can't have empty space in any dependency file name in the extension. Otherwise building the extension will fail.
    .pipe(rename(function(opt) {
        opt.basename = opt.basename.split(' ').join('_');
        return opt;
      }))
    .pipe(gulp.dest(path.join(__dirname, 'lib/ps_modules/openssl')));
    done();
});

gulp.task('nuget_download', function(done) {
    if (fs.existsSync('nuget.exe')) {
        done();
    }

    request.get('https://dist.nuget.org/win-x86-commandline/v4.9.0-rc1/nuget.exe')
        .pipe(fs.createWriteStream('nuget.exe'))
        .on('close', done);
});

gulp.task('nuget_restore', gulp.series('nuget_download', function() {
    var nugetPath = __dirname + '/nuget.exe'
    return gulp.src(__dirname + '/packages.config')
        .pipe(nuget.restore({ nuget: nugetPath, packagesDirectory: __dirname + '/packages'}));
}));

gulp.task('copy_nuget_dlls', gulp.series('nuget_restore', function() {
    var copyAzureStorage = gulp.src(['./packages/WindowsAzure.Storage.9.0.0/lib/net45/Microsoft.WindowsAzure.Storage.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyDataMovement = gulp.src(['./packages/Microsoft.Azure.Storage.DataMovement.0.7.1/lib/net45/Microsoft.WindowsAzure.Storage.DataMovement.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyApplicationsInsight = gulp.src(['./packages/Microsoft.ApplicationInsights.2.0.1/lib/net45/Microsoft.ApplicationInsights.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyTracingEventSource = gulp.src(['./packages/Microsoft.Diagnostics.Tracing.EventSource.Redist.1.1.24/lib/net40/Microsoft.Diagnostics.Tracing.EventSource.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyThreadingTasks = gulp.src(['./packages/Microsoft.Bcl.Async.1.0.168/lib/net40/Microsoft.Threading.Tasks.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyNewtonsoft = gulp.src(['./packages/Newtonsoft.Json.13.0.3/lib/net45/Newtonsoft.json.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyVstsClient = gulp.src(['./packages/Microsoft.VisualStudio.Services.Client.19.225.1/lib/net472/**/*']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyIdentityClient = gulp.src(['./packages/Microsoft.Identity.Client.4.73.1/lib/net462/Microsoft.Identity.Client.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyIdentityAbstraction = gulp.src(['./packages/Microsoft.IdentityModel.Abstractions.8.12.1/lib/net462/Microsoft.IdentityModel.Abstractions.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyTfsWebApi = gulp.src(['./packages/Microsoft.TeamFoundation.DistributedTask.WebApi.19.225.1/lib/net472/**/*']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyTfsCommonContract = gulp.src(['./packages/Microsoft.TeamFoundation.DistributedTask.Common.Contracts.19.225.1/lib/net472/Microsoft.TeamFoundation.DistributedTask.Common.Contracts.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    var copyAspNetWebApi = gulp.src(['./packages/Microsoft.AspNet.WebApi.Client.5.2.7/lib/net45/System.Net.Http.Formatting.dll']).pipe(gulp.dest('./lib/ps_modules/NugetPackages'));
    return merge(copyAzureStorage, copyDataMovement, copyApplicationsInsight, copyTracingEventSource, copyThreadingTasks, copyNewtonsoft, copyVstsClient, copyIdentityClient, copyIdentityAbstraction, copyTfsWebApi, copyTfsCommonContract, copyAspNetWebApi);
}));

/* When compiling, we want to go from the structure on the left to the one on the right.

  [SOURCE TREE]                     [BUILD TREE]
 tasks                              tasks
  \- store-publish-V1               \- store-publish
  |   \- publish.ts                 |  \- store-publish-V1 
  |   \- publishUi.ts               |  |   \- common 
  |   \- task.json                  |  |   |    \- common.js
  |                                 |  |   |    \- util.js
  \- store-publish-V3               |  |   |
  |   \- publish.psm1               |  |   \- local
  |   \- publishUi.ps1              |  |   |    \- publish.js
  |   \- task.json                  |  |   |    \- publishUi.js
  |                                 |  |   \- task.json 
  \- store-flight                   |  \- store-publish-V3
  |   \- flight.ts                  |  |   \- ps_common
  |   \- flightUi.ts                |  |   |    \- storeBrokerHelper.psm1
  |   \- task.json                  |  |   \- ps_modules
  |                                 |  |   \- publish.psm1
  \- store-rollout-V3               |  |   \- publishUi.ps1
  |   \- rollout.psm1               |  |   \- task.json    
  |   \- rolloutUi.ps1              \- store-flight          
  |   \- task.json                  |  \- store-flight-V1
  |                                 |      \....
  \- store-package-V3               |  \- store-flight-V3
  |   \-packageUI.ps1               |      \....
  |   \- task.json                  \- store-rollout-V3
  |   \...                          |   \....
  |                                 |
  \- ps_common                      \- store-package-V3
  |   \- storeBrokerHelper.psm1     |   \....
  |
  |- common
  |   \- common.ts
  |   \- util.ts
  |   \...

 The reasoning is:
    1) We want to have access to common code, so in the source tree we need a common directory.
    2) Tasks are self-contained, so the common code must be copied in each task in the build tree.
    3) The relative path between a task file and a common file should stay the same so that both our IDE and node can
       find the appropriate files. Therefore each task needs a 'local' directory in the build tree so that the relative
       path from <task-specific>.[ts|js] to <common>.[ts.js] is always '../common/'.
    4) By putting V1 task and V2 task together under the same task allows us to utilize the dropdown menu on VSTS extension UI. 
       We could easily switch the extension from V1 to V2

 The node_modules directory is populated by the 'dependencies' gulp task at the root of each task in the build
 tree (e.g. tasks/tasksA/). node will be smart enough to find that folder even from common/*.js and local/*.js

 Note that task metadata (task.json, icon.png, package.json, etc.) remain in the task root folder.

 The below tasks are in charge of creating that folder structure
*/

gulp.task('_compile_only', gulp.series(gulp.series('copy_nuget_dlls', 'get_storebroker', 'remove_version_folder', "get_openssl"), function() {
    var tsconfig = require('./tsconfig.json').compilerOptions;
    return gulp
        .src(['tasks/**/*.ts'])
        .pipe(tsc(tsconfig))
        .pipe(rename(p =>
        {
            // Redirect non-common task .ts files to a 'local' subdirectory. If the task is flight then append V1 at the end
            if (p.dirname.endsWith("V1"))
            {
                p.dirname = path.join(p.dirname, 'local');
            }
        }))
        .pipe(gulp.dest(BUILD_DIR));
}));

// Copy the code under common/ into every task directory.
gulp.task('_copy_common', function() {
    return gulp
        .src(path.join(BUILD_DIR, COMMON_TASK_DIR, '/*.js'), { base: BUILD_DIR }) // Note: already built, so .js and not .ts
        .pipe(multidest(getTaskV1Destinations()));
});

// Remove the common directory under the build tree, so that it doesn't get packaged in the VSIX file for nothing.
gulp.task('_remove_common', function() {
    return del([path.join(BUILD_DIR, COMMON_TASK_DIR)]);
});

gulp.task('_copy_ps_common', function() {
    var copy_ps_common = gulp
        .src(['tasks/ps_common/**'])
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-rollout-V3', PS_COMMON_TASK_DIR)))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-publish-V3', PS_COMMON_TASK_DIR)))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-flight-V3', PS_COMMON_TASK_DIR)))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-package-V3', PS_COMMON_TASK_DIR)));

    return merge(copy_ps_common);
});

gulp.task('_copy_ps', function() {
    var copyRolloutTask = gulp
        .src(['tasks/store-rollout-V3/*.ps1', 'tasks/store-rollout-V3/*.psm1'])
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-rollout-V3')));

    var copyPackageTask = gulp
        .src(['tasks/store-package-V3/*.ps1'])
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-package-V3')));

    var copyPublishTask = gulp
        .src(['tasks/store-publish-V3/*.ps1', 'tasks/store-publish-V3/*.psm1'])
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-publish-V3')))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-flight-V3')));

    return merge(copyRolloutTask, copyPackageTask, copyPublishTask);
});

gulp.task('_copy_lib', gulp.series('_copy_ps', function() {
    return gulp
        .src(['lib/**/*'])
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-publish-V3')))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-flight-V3')))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-rollout-V3')))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-package-V3')));
}));

// Copy the master package.json file into each task folder in the build tree, so that
// packages can be properly installed for each task.
gulp.task('_copy_dependency_list', function () {
    return gulp
        .src(['package.json'])
        .pipe(multidest(getTaskV1Destinations()));
});

// Install node dependencies for each task that has been built.
gulp.task('dependencies', gulp.series('_copy_dependency_list', function () {
    var taskDirsInBuildTree = TASK_DIRECTORIES_V1.map(p => {
        return path.join(BUILD_DIR, p)
    });

    return gulp
        .src(taskDirsInBuildTree) // Any task directory...
        .pipe(gulp_exec('cd <%= file.path %> && npm install --production')); // ...go in and install
}));

gulp.task('_group_tasks', function() {
    var groupPublishTasks = gulp
        .src([BUILD_DIR + '/store-publish-V1/**/*', BUILD_DIR + '/store-publish-V3/**/*'], { base: BUILD_DIR })
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-publish')));
    
    var groupFlightTasks = gulp
        .src([BUILD_DIR + '/store-flight-V1/**/*', BUILD_DIR + '/store-flight-V3/**/*'], { base: BUILD_DIR })
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-flight')));

    var groupRolloutTasks = gulp
        .src([BUILD_DIR + '/store-rollout-V3/**/*'], { base: BUILD_DIR })
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-rollout')));

    var groupPackageTasks = gulp
        .src([BUILD_DIR + '/store-package-V3/**/*'], { base: BUILD_DIR })
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-package')));
    
    return merge(groupPublishTasks, groupFlightTasks, groupRolloutTasks, groupPackageTasks);
});

gulp.task('_remove_tasks', gulp.series('_group_tasks', function() {
    return del([path.join(BUILD_DIR, 'store-publish-V1'), path.join(BUILD_DIR, 'store-publish-V2'), path.join(BUILD_DIR, 'store-publish-V3'),
    path.join(BUILD_DIR, 'store-flight-V1'), path.join(BUILD_DIR, 'store-flight-V2'), path.join(BUILD_DIR, 'store-flight-V3'),
    path.join(BUILD_DIR, 'store-rollout-V2'), path.join(BUILD_DIR, 'store-rollout-V3'),
    path.join(BUILD_DIR, 'store-package-V2'), path.join(BUILD_DIR, 'store-package-V3')]);
}));

gulp.task('_task_metadata', function () {
    // Copy over non-code files of the extension
    var copyRolloutV3Metadata = gulp
        .src(['tasks/store-rollout-V3/*.png'       // Task icons
            , 'tasks/store-rollout-V3/task.json'   // Task manifest
            ])
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('b278571a-a422-432c-873a-780b98240596','e3f06e65-081e-460d-ae29-5b84e425f8b4')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"friendlyName": "Windows Store - Rollout V3"','"friendlyName": "Windows Store - Rollout V3 Dev"')))        
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-rollout-V3')));

    var copyPublishV1Metadata = gulp
        .src(['tasks/store-publish-V1/*.png'       // Task icons
            , 'tasks/store-publish-V1/task.json'   // Task manifest
            ])
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('8e70da9d-532d-4416-a07f-5ec10f84339f','81e53284-f02d-4878-abca-20f08327121c')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"friendlyName": "Windows Store - Publish V1"','"friendlyName": "Windows Store - Publish V1 Dev"')))        
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"connectedService:devCenter"','"connectedService:devCenter-dev"')))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-publish-V1')));

    var copyFlightV1Metadata = gulp
        .src(['tasks/store-flight-V1/*.png'       // Task icons
            , 'tasks/store-flight-V1/task.json'   // Task manifest
            ])
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('13dee6a7-3698-4b12-bbb4-b393560a3ebc','91c056be-bd43-4b3f-a4bf-6eb489bc121d')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"friendlyName": "Windows Store - Flight V1"','"friendlyName": "Windows Store - Flight V1 Dev"')))        
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"connectedService:devCenter"','"connectedService:devCenter-dev"')))
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-flight-V1')));

    var copyPublishV3Metadata = gulp
        .src(['tasks/store-publish-V3/*.png'       // Task icons
            , 'tasks/store-publish-V3/task.json'   // Task manifest
            ])
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"name": "TO_BE_SET"','"name": "store-publish"'))) 
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"id": "TO_BE_SET"','"id": "8e70da9d-532d-4416-a07f-5ec10f84339f"')))
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"friendlyName": "TO_BE_SET"','"friendlyName": "Windows Store - Publish V3"')))
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"defaultValue": "TO_BE_SET"','"defaultValue": "Production"')))
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"description": "TO_BE_SET"','"description": "Publish your app to the Windows Store"')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"id": "8e70da9d-532d-4416-a07f-5ec10f84339f"','"id": "81e53284-f02d-4878-abca-20f08327121c"')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"friendlyName": "Windows Store - Publish V3"','"friendlyName": "Windows Store - Publish V3 Dev"')))        
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-publish-V3')));

    var copyFlightV3Metadata = gulp
        .src(['tasks/store-publish-V3/*.png'       // Task icons
            , 'tasks/store-publish-V3/task.json'   // Task manifest
            ])
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"name": "TO_BE_SET"','"name": "store-flight"'))) 
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"id": "TO_BE_SET"','"id": "13dee6a7-3698-4b12-bbb4-b393560a3ebc"')))
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"friendlyName": "TO_BE_SET"','"friendlyName": "Windows Store - Flight V3"')))
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"defaultValue": "TO_BE_SET"','"defaultValue": "Flight"')))
        .pipe(gulpif(function(file) { return file.path.match(/task\.json/); }, replace('"description": "TO_BE_SET"','"description": "Make a flight submission to the Windows Store"')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"id": "13dee6a7-3698-4b12-bbb4-b393560a3ebc"','"id": "91c056be-bd43-4b3f-a4bf-6eb489bc121d"')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"friendlyName": "Windows Store - Flight V3"','"friendlyName": "Windows Store - Flight V3 Dev"')))        
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-flight-V3')));

    var copyPackageV3Metadata = gulp
        .src(['tasks/store-package-V3/*.png'       // Task icons
        , 'tasks/store-package-V3/task.json'   // Task manifest
        ])
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('96d0c453-efe7-4c9b-8b0c-fde9a356a5cd','91973c55-0ce6-4779-9669-b63cc6adfed3')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/task\.json/); }, replace('"friendlyName": "Windows Store - Package V3"','"friendlyName": "Windows Store - Package V3 Dev"')))        
        .pipe(gulp.dest(path.join(BUILD_DIR, 'store-package-V3')));
    
    return merge(copyRolloutV3Metadata, copyPublishV1Metadata, copyFlightV1Metadata, copyPublishV3Metadata, copyFlightV3Metadata, copyPackageV3Metadata);
});

gulp.task('_extension_metadata', function () {
    return gulp
        .src([EXTENSION_MANIFEST
            , 'images/*.png'            // Extension logo
            , 'ThirdPartyNotices.txt'   // 3rd-party notices
            , 'README.md'               // Information to appear on the marketplace page
            , 'docs/**/*'               // Copy all content to be addressed by documentation
            ],
            { base: '.'})
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/vss-extension\.json/); }, replace('devCenterApiEndpoint','devCenterApiEndpoint-dev')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/vss-extension\.json/); }, replace('"displayName": "Windows Dev Center V1"','"displayName": "Windows Dev Center V1 Dev"')))
        .pipe(gulpif(function(file) { return argv.dev && file.path.match(/vss-extension\.json/); }, replace('"name": "devCenter"','"name": "devCenter-dev"')))
        .pipe(gulp.dest(BUILD_DIR));
});

// Compile all tasks
gulp.task('compile', gulp.series('_compile_only', 'dependencies', '_copy_common', '_remove_common', '_copy_lib', '_copy_ps_common'));

/* *****
 Main tasks (that you would want to typically run)
***** */

// Remove everything in the build directory.
gulp.task('clean', function () {
    return del([BUILD_DIR + '**/*']);
});

// Remove all tasks and dependencies from the build directory, so that we can start fresh.
gulp.task('clean_dependencies', function () {
    return del(['./lib/ps_modules/**/*', './packages/**/*', './nuget.exe']);
});

// Create a VSIX package for the extension. --publisher specifies the publisher to use, if different from the manifest.
gulp.task('package', gulp.series(gulp.series('compile', '_task_metadata', '_extension_metadata', 'dependencies', '_remove_tasks', 'clean_dependencies'), function (callback) {
    var cmd = 'tfx extension create'
                + ' --root ' + BUILD_DIR
                + ' --manifest-globs ' + EXTENSION_MANIFEST
                + ' --output-path ' + BUILD_DIR + 'extension';

    if (argv.publisher)
    {
        cmd += ' --publisher ' + argv.publisher;
    }

    if (argv.public)
    {
        cmd += ' --override {\\"public\\": true}';
    }
    else if (argv.dev)
    {
        cmd += ' --override ' + toOverrideString(DEV_MANIFEST_OVERRIDE);
    }

    exec(cmd, callback);
}));

gulp.task('default', gulp.series('package'));