var exec = require('child_process').exec;

var argv = require('yargs').argv;
var del = require('del');
var gulp = require('gulp');
var tsc = require('gulp-tsc');


var EXTENSION_MANIFEST = 'vss-extension.json';
var BUILD_DIR = 'build/';

gulp.task('clean', function () {
    return del([BUILD_DIR + '**/*']);
});

gulp.task('compile', ['task-dependencies'], function () {
    var tsconfig = require('./tsconfig.json').compilerOptions;
    
    return gulp
        .src(['tasks/**/*.ts'])
        .pipe(tsc(tsconfig))
        .pipe(gulp.dest(BUILD_DIR))
});

gulp.task('task-metadata', function () {
    return gulp
        // Copy over non-code files of the extension
        .src(['tasks/**/*.png'          // Task icons
            , 'tasks/*/task.json'       // Task manifest
            , 'tasks/*/package.json'    // List of task dependencies
            ])
        .pipe(gulp.dest(BUILD_DIR));
});

gulp.task('extension-metadata', function() {
    return gulp
        .src([EXTENSION_MANIFEST
            , 'images/*.png'            // Extension logo
            , 'ThirdPartyNotices.txt'   // 3rd-party notices
            , 'vsts-details.md'         // Information to appear on the marketplace page
            ],
            { base: '.'})
        .pipe(gulp.dest(BUILD_DIR));
})

gulp.task('task-dependencies', ['task-metadata'], function (callback) {
    exec('npm install', { cwd: BUILD_DIR + 'store-publish/' }, callback);
});

gulp.task('package', ['compile', 'task-metadata', 'extension-metadata', 'task-dependencies'], function (callback) {
    var cmd = 'tfx extension create'
                + ' --root ' + BUILD_DIR 
                + ' --manifest-globs ' + EXTENSION_MANIFEST
                + ' --output-path ' + BUILD_DIR + 'extension';
    
    if (argv.publisher)
    {
        cmd += ' --publisher ' + argv.publisher;
    }

    exec(cmd, callback);
});

gulp.task('default', ['package']);