import fs = require('fs');
import path = require('path');

const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../tasks/store-publish-V1/task.json'),
    'utf8'
).replace(/^\uFEFF/, ''));

test.each(['Node20_1', 'Node24'])('store-publish V1 declares the %s handler', (handler) => {
    expect(manifest.execution[handler]).toEqual({
        target: 'local/publishUi.js',
        argumentFormat: ''
    });
});
