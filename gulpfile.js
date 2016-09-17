var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');

var argv = require('yargs').argv;
var del = require('del');
var gulp = require('gulp');
var gulp_exec = require('gulp-exec');
var multistream = require('gulp-multistream');
var rename = require('gulp-rename');
var tsc = require('gulp-tsc');

const EXTENSION_MANIFEST = 'vss-extension.json';
const BUILD_DIR = 'build/';
const COMMON_TASK_DIR = 'common';
const TASKS_DIR = 'tasks';

// Get all task directories except common and transform them into gulp dests of the corresponding build directory
// This is not the most optimal, but the 'best' way barring having a dest-like plugin that takes a glob.
const TASK_DIRECTORIES = fs.readdirSync(TASKS_DIR)
    .filter(p => fs.statSync(path.join(TASKS_DIR, p)).isDirectory() && p != COMMON_TASK_DIR);

// Construct gulp destinations out of the task directories.
function getTaskDestinations()
{
    return TASK_DIRECTORIES.map(p => gulp.dest(path.join(BUILD_DIR, p)));
}

/* *****
 Main tasks (that you would want to typically run)
***** */

gulp.task('default', ['package']);
    
// Create a VSIX package for the extension. --publisher specifies the publisher to use, if different from the manifest.
gulp.task('package', ['compile', '_task_metadata', '_extension_metadata', 'dependencies'], function (callback)
{
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

    exec(cmd, callback);
});

// Compile all tasks 
gulp.task('compile', ['_compile_only', 'dependencies', '_copy_common', '_remove_common']);


// Install node dependencies for each task that has been built.
gulp.task('dependencies', ['_copy_dependency_list'], function ()
{
    var taskDirsInBuildTree = TASK_DIRECTORIES.map(p => path.join(BUILD_DIR, p));

    return gulp
        .src(taskDirsInBuildTree) // Any task directory...
        .pipe(gulp_exec('cd <%= file.path %> && npm install --production')); // ...go in and install
});


// Remove everything in the build directory.
gulp.task('clean', function ()
{
    return del([BUILD_DIR + '**/*']);
});


/* *****
 "Internal" tasks below.
 There should be no need to call these tasks directly.
***** */

gulp.task('_extension_metadata', function ()
{
    return gulp
        .src([EXTENSION_MANIFEST
            , 'images/*.png'            // Extension logo
            , 'ThirdPartyNotices.txt'   // 3rd-party notices
            , 'README.md'               // Information to appear on the marketplace page
            , 'docs/**/*'               // Copy all content to be addressed by documentation
            ],
            { base: '.'})
        .pipe(gulp.dest(BUILD_DIR));
})


gulp.task('_task_metadata', function ()
{
    return gulp
        // Copy over non-code files of the extension
        .src(['tasks/*/*.png'       // Task icons
            , 'tasks/*/task.json'   // Task manifest
            ])
        .pipe(gulp.dest(BUILD_DIR));
});

/* When compiling, we want to go from the structure on the left to the one on the right.
 
  [SOURCE TREE]               [BUILD TREE]
 tasks                        tasks
  \- TaskA                     \- TaskA
  |   \- a.ts                  |  \- common
  |   \- aHelper.ts            |   |   \- common.js
  |   \- task.json             |   |   \- util.js             
  |                            |   |
  \- TaskB                     |   \- local
  |   \...                     |   |   \- a.js
  |                            |   |   \- aHelper.js
  \- common                    |   \- task.json
      \- common.ts             \- TaskB
      \- util.ts                   \...
 
 The reasoning is:
    1) We want to have access to common code, so in the source tree we need a common directory.
    2) Tasks are self-contained, so the common code must be copied in each task in the build tree.
    3) The relative path between a task file and a common file should stay the same so that both our IDE and node can
       find the appropriate files. Therefore each task needs a 'local' directory in the build tree so that the relative
       path from <task-specific>.[ts|js] to <common>.[ts.js] is always '../common/'.
       
 The node_modules directory is populated by the 'dependencies' gulp task at the root of each task in the build
 tree (e.g. tasks/tasksA/). node will be smart enough to find that folder even from common/*.js and local/*.js
 
 Note that task metadata (task.json, icon.png, package.json, etc.) remain in the task root folder.
 
 The below tasks are in charge of creating that folder structure
*/

gulp.task('_compile_only', function ()
{
    var tsconfig = require('./tsconfig.json').compilerOptions;
    
    return gulp
        .src(['tasks/*/*.ts'])
        .pipe(tsc(tsconfig))
        .pipe(rename(p =>
        {
            // Redirect non-common task .ts files to a 'local' subdirectory
            if (!p.dirname.endsWith(COMMON_TASK_DIR))
            {
                p.dirname += '/local';
            }
        }))
        .pipe(gulp.dest(BUILD_DIR));
});

// Remove the common directory under the build tree, so that it doesn't get packaged in the VSIX file for nothing.
gulp.task('_remove_common', ['_copy_common'], function () {
    return del([BUILD_DIR + COMMON_TASK_DIR]);
});

// Copy the code under common/ into every task directory.
gulp.task('_copy_common', ['_compile_only'], function ()
{
    return gulp
        .src([BUILD_DIR + COMMON_TASK_DIR + '/*.js'], { base: BUILD_DIR }) // Note: already built, so .js and not .ts
        .pipe(multistream.apply(undefined, getTaskDestinations()));
});

// Copy the master package.json file into each task folder in the build tree, so that
// packages can be properly installed for each task.
gulp.task('_copy_dependency_list', function ()
{
    return gulp
        .src(['package.json'])
        .pipe(multistream.apply(undefined, getTaskDestinations()));
});
