# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build
- `npm run build` - Complete build pipeline (clean, ESM, CJS, packages, browserify)
- `npm run build:clean` - Clean dist directories
- `npm run build:esm` - Build ES modules to `dist/esm`
- `npm run build:cjs` - Build CommonJS modules to `dist/cjs`
- `npm run build:packages` - Create package.json files for distribution
- `npm run browserify` - Create browser bundle at `dist/browser.js`

### Testing
- `npm test` - Run all tests using Jasmine
- `npm run test:esm` - Test ESM build specifically
- Tests are located in `src/test/` and compiled to `dist/cjs/` before execution
- Jasmine config in `spec/support/jasmine.json`

### Code Quality
- `npm run lint` - Check code style with ESLint
- `npm run lint:fix` - Auto-fix linting issues
- `npx tsc --noEmit` - Run TypeScript type checking without emitting files

### Build System
The project uses a dual-build system:
- **ESM build**: `tsconfig.json` → `dist/esm/` (ES2020 modules)
- **CJS build**: `tsconfig-cjs.json` → `dist/cjs/` (CommonJS)
- Both builds include TypeScript declarations in `dist/types/`

## Architecture Overview

### Core Structure
AceBase is a NoSQL realtime database engine with the following key architectural components:

**Main Entry Points:**
- `src/acebase-local.ts` - Primary AceBase class and local database implementation
- `src/acebase-browser.ts` - Browser-specific implementation
- `src/api-local.ts` - Local API implementation for database operations
- `src/index.ts` - Main exports and public API

**Storage Layer (`src/storage/`):**
- **Binary storage** (`storage/binary/`) - Primary file-based storage engine
- **Custom storage** (`storage/custom/`) - Pluggable storage implementations
  - IndexedDB adapter for browser environments
  - LocalStorage adapter for simple browser storage
- **SQLite/MSSQL** (`storage/sqlite/`, `storage/mssql/`) - SQL database backends
- Each storage type has browser-specific implementations via `browser.ts` files

**B-Tree Implementation (`src/btree/`):**
- High-performance binary tree implementation for indexing
- `binary-tree.ts` - Main binary tree with file-based storage
- `tree.ts` - In-memory tree implementation
- Separate builder, reader, writer, and transaction components
- Supports both memory and disk-based operations

**Data Indexing (`src/data-index/`):**
- `data-index.ts` - Main indexing coordinator
- `array-index.ts` - Specialized array value indexing
- `fulltext-index.ts` - Full-text search capabilities
- `geo-index.ts` - Geospatial indexing support
- Query optimization and hint system

**Core Database Primitives:**
- `node.ts` - Database node representation and operations
- `node-transaction.ts` - Transaction management
- `node-lock.ts` - Concurrency control
- `query.ts` - Query parsing and execution

### Multi-Environment Support

**Browser/Node.js Dual Targeting:**
- Each major module has a corresponding `browser.ts` file with browser-specific implementations
- Package.json includes browser field mappings to automatically use browser versions
- Build system creates separate browser bundles

**IPC Support (`src/ipc/`):**
- Inter-process communication for clustered deployments
- Service-based architecture for multi-process scenarios
- Socket-based communication between processes

### Key Design Patterns

**Storage Abstraction:**
- All storage engines implement common interfaces
- Pluggable architecture allows custom storage backends
- Consistent API across file, memory, and database storage

**Transaction System:**
- Node-level locking and transaction management
- ACID compliance with rollback capabilities
- Transaction logging for recovery

**Realtime Features:**
- Event-driven architecture for data change notifications
- Live data proxies for automatic synchronization
- Change tracking and mutation events

### Testing Strategy
- Unit tests co-located with source files (`.spec.ts` files)
- Integration tests in `src/test/` directory
- `tempdb.ts` provides test database utilities
- Comprehensive test coverage including performance, recovery, and edge cases

## Dependencies

**Runtime Dependencies:**
- `acebase-core` - Shared functionality and base classes
- `unidecode` - Text normalization for indexing

**Key Development Dependencies:**
- TypeScript 5.0+ for type checking and compilation
- ESLint with TypeScript support for code quality
- Jasmine for testing framework
- Browserify + Terser for browser bundle creation
- `tsc-esm-fix` for ESM compatibility fixes