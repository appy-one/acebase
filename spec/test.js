 // To run the unit tests, from the root of the project:
 //
 // - install jasmine:
 //     -> npm i jasmine -g
 //     -> jasmine (or: npm run test)
 //
 // - Or, install jasmine locally:
 //     -> npm i jasmine --save-dev
 //     -> npx jasmine

 // To debug the unit tests: 
 //     -> npm i jasmine --save-dev
 //     -> launch debugger with this file

const Jasmine = require('jasmine');
const jasmine = new Jasmine();
jasmine.loadConfigFile('spec/support/jasmine.json'); // Default
jasmine.onComplete(function(passed) {
    if(passed) {
        console.log('All specs have passed');
    }
    else {
        console.log('At least one spec has failed');
    }
});
jasmine.configureDefaultReporter({
    // The `timer` passed to the reporter will determine the mechanism for seeing how long the suite takes to run.
    timer: new jasmine.jasmine.Timer(),
    // The `print` function passed the reporter will be called to print its results.
    print: function() {
        console.log(...arguments); //process.stdout.write(arguments);
    },
    // `showColors` determines whether or not the reporter should use ANSI color codes.
    showColors: true
});
// jasmine.execute(['./spec/include-exclude-filters.spec.js']);
// jasmine.execute(['./spec/arrays.spec.js']);
// jasmine.execute(['./spec/examples.spec.js']);
// jasmine.execute(['./spec/query.spec.js']);
// jasmine.execute(['./spec/bulk-import.spec.js']);
// jasmine.execute(['./spec/indexes.spec.js']);
// jasmine.execute(['./spec/node-lock.spec.js']);
jasmine.execute();