## How to use tests

To run all unit tests, from the root of the project:
* `npm run test`
* or: `npx jasmine`

To run a specific unit test:
* `npx jasmine ./dist/cjs/some.spec.js`
* or: `npx jasmine ./dist/cjs/test/some.spec.js --filter="[spec filter]"`

To DEBUG unit tests in VSCode:
* -> open a JavaScript Debug Terminal
* `npx jasmine`
* or: `npx jasmine ./dist/cjs/some.spec.js`
* or: `npx jasmine ./dist/cjs/test/some.spec.js --filter="[spec filter]"`

## CommonJS and ESM

Because AceBase now exports both CommonJS and ESM modules, all code must be tested twice too. 
Because Jasmine uses CommonJS, we have to jump through some hoops to test the ESM modules build.
* `cd ./spec/esm-test`, then `npm run test`
* or: `node ./spec/esm-test ./dist/esm/some.spec.js`
* or" `node ./spec/esm-test ./dist/esm/some.spec.js --filter="[spec filter]"`

## Contribute by creating tests

More tests are always better. Seen code that needs testing? Please write your test and submit a PR!
