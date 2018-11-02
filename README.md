# AceBase realtime database

A fast, low memory, transactional, index & query enabled JSON database server for node.js with realtime notifications of data changes. Built-in user authentication and authorization enables you to define rules on who and where users are allowed to read and/or write data. Inspired by the Firebase realtime database, with additional functionality and less data sharding/duplication. Capable of storing up to 2^48 (281 trillion) object nodes in a binary database file that can theoretically grow to a max filesize of 8PB (petabytes). AceBase can run anywhere: in the cloud, NAS, local server, your PC/Mac, Raspberry Pi, wherever you want. 

Natively supports storing of JSON objects, arrays, numbers, strings, booleans, dates and binary (ArrayBuffer) data. Custom classes can automatically be shape-shifted to and from plain objects by adding type mappings --> Store a ```User```, get a ```User```. Store a ```ChatMessage```, get a ```ChatMessage```!

## Getting Started

AceBase is split up into multiple repositories, more info and documentation can be found at:
* **acebase**: local AceBase database engine ([github](https://github.com/appy-one/acebase-core), [npm](https://www.npmjs.com/package/acebase))
* **acebase-server**: AceBase webserver endpoint to enable remote connections ([github](https://github.com/appy-one/acebase-server), [npm](https://www.npmjs.com/package/acebase-server))
* **acebase-client**: client to access an AceBase webserver ([github](https://github.com/appy-one/acebase-client), [npm](https://www.npmjs.com/package/acebase-client))
* **acebase-test**: Tests ([github](https://github.com/appy-one/acebase-test))