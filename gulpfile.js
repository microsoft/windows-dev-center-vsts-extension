var gulp = require('gulp');
var tsc = require('gulp-tsc');
var exec = require('child_process').exec;

var EXTENSION_MANIFEST = 'vss-extension.json';
var BUILD_DIR = 'build/';

gulp.task('compile', function () {
    var tsconfig = {
        target: 'ES6',
        module: 'commonjs'
    };
    
    return gulp
        .src(['tasks/**/*.ts'])
        .pipe(tsc(tsconfig))
        .pipe(gulp.dest(BUILD_DIR))
});

gulp.task('task-metadata', function () {
    return gulp
        // Copy over non-code files of the extension
        .src(['tasks/**/*.png'           // Task icons
            , 'tasks/**/task.json'       // Task manifest
            , 'tasks/**/node_modules/**' // Node modules used by the tasks
            ])
        .pipe(gulp.dest(BUILD_DIR));
});

gulp.task('extension-metadata', function() {
    return gulp
        .src([EXTENSION_MANIFEST, 'images/*.png'],
                { base: '.'})
        .pipe(gulp.dest(BUILD_DIR));
})

gulp.task('package', ['compile', 'task-metadata', 'extension-metadata'], function (callback) {
    var cmd = 'tfx extension create'
                + ' --root ' + BUILD_DIR 
                + ' --manifest-globs ' + EXTENSION_MANIFEST
                + ' --output-path ' + BUILD_DIR + 'extension';
    
    exec(cmd, function (err) {
        callback(err);
    });
});


gulp.task('default', ['package']);