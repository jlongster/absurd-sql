/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "../indexeddb/worker.js":
/*!******************************!*\
  !*** ../indexeddb/worker.js ***!
  \******************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ Worker_fn)\n/* harmony export */ });\nfunction Worker_fn() {\n  return new Worker(__webpack_require__.p + \"worker.worker.js\");\n}\n\n\n//# sourceURL=webpack:///../indexeddb/worker.js?");

/***/ }),

/***/ "../blocked-file.js":
/*!**************************!*\
  !*** ../blocked-file.js ***!
  \**************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"getBoundaryIndexes\": () => (/* binding */ getBoundaryIndexes),\n/* harmony export */   \"readChunks\": () => (/* binding */ readChunks),\n/* harmony export */   \"writeChunks\": () => (/* binding */ writeChunks),\n/* harmony export */   \"File\": () => (/* binding */ File)\n/* harmony export */ });\n/* harmony import */ var _perf__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./perf */ \"../perf.dev.js\");\n\n\nfunction range(start, end, step) {\n  let r = [];\n  for (let i = start; i <= end; i += step) {\n    r.push(i);\n  }\n  return r;\n}\n\nfunction getBoundaryIndexes(blockSize, start, end) {\n  let startC = start - (start % blockSize);\n  let endC = end - 1 - ((end - 1) % blockSize);\n\n  return range(startC, endC, blockSize);\n}\n\nfunction readChunks(chunks, start, end) {\n  let buffer = new ArrayBuffer(end - start);\n  let bufferView = new Uint8Array(buffer);\n\n  let cursor = 0;\n  for (let i = 0; i < chunks.length; i++) {\n    let chunk = chunks[i];\n\n    // TODO: jest has a bug where we can't do `instanceof ArrayBuffer`\n    if (chunk.data.constructor.name !== 'ArrayBuffer') {\n      throw new Error('Chunk data is not an ArrayBuffer');\n    }\n\n    let cstart = 0;\n    let cend = chunk.data.byteLength;\n\n    if (start > chunk.pos) {\n      cstart = start - chunk.pos;\n    }\n    if (end < chunk.pos + chunk.data.byteLength) {\n      cend = end - chunk.pos;\n    }\n\n    if (cstart > chunk.data.byteLength || cend < 0) {\n      continue;\n    }\n\n    let len = cend - cstart;\n\n    bufferView.set(\n      new Uint8Array(chunk.data, cstart, len),\n      chunk.pos - start + cstart\n    );\n    cursor += len;\n  }\n\n  return buffer;\n}\n\nfunction writeChunks(bufferView, blockSize, start, end) {\n  let indexes = getBoundaryIndexes(blockSize, start, end);\n  let cursor = 0;\n\n  return indexes\n    .map(index => {\n      let cstart = 0;\n      let cend = blockSize;\n      if (start > index && start < index + blockSize) {\n        cstart = start - index;\n      }\n      if (end > index && end < index + blockSize) {\n        cend = end - index;\n      }\n\n      let len = cend - cstart;\n      let chunkBuffer = new ArrayBuffer(blockSize);\n\n      if (start > index + blockSize || end <= index) {\n        return null;\n      }\n\n      let off = bufferView.byteOffset + cursor;\n\n      let available = bufferView.buffer.byteLength - off;\n      if (available <= 0) {\n        return null;\n      }\n\n      let readLength = Math.min(len, available);\n\n      new Uint8Array(chunkBuffer).set(\n        new Uint8Array(bufferView.buffer, off, readLength),\n        cstart\n      );\n      cursor += readLength;\n\n      return {\n        pos: index,\n        data: chunkBuffer,\n        offset: cstart,\n        length: readLength\n      };\n    })\n    .filter(Boolean);\n}\n\nclass File {\n  constructor(filename, defaultBlockSize, ops, meta = null) {\n    this.filename = filename;\n    this.defaultBlockSize = defaultBlockSize;\n    this.buffer = new Map();\n    this.ops = ops;\n    this.meta = meta;\n    this._metaDirty = false;\n  }\n\n  bufferChunks(chunks) {\n    for (let i = 0; i < chunks.length; i++) {\n      let chunk = chunks[i];\n      this.buffer.set(chunk.pos, chunk);\n    }\n  }\n\n  open() {\n    this.meta = this.ops.readMeta();\n\n    if (this.meta == null) {\n      this.meta = {};\n\n      // New file\n      this.setattr({\n        size: 0,\n        blockSize: this.defaultBlockSize\n      });\n\n      this.fsync();\n    }\n  }\n\n  close() {\n    this.fsync();\n  }\n\n  delete() {\n    this.ops.delete();\n  }\n\n  load(indexes) {\n    let status = indexes.reduce(\n      (acc, b) => {\n        let inMemory = this.buffer.get(b);\n        if (inMemory) {\n          acc.chunks.push(inMemory);\n        } else {\n          acc.missing.push(b);\n        }\n        return acc;\n      },\n      { chunks: [], missing: [] }\n    );\n\n    let missingChunks = [];\n    if (status.missing.length > 0) {\n      missingChunks = this.ops.readBlocks(status.missing, this.meta.blockSize);\n    }\n    return status.chunks.concat(missingChunks);\n  }\n\n  read(bufferView, offset, length, position) {\n    // console.log('reading', this.filename, offset, length, position);\n    let buffer = bufferView.buffer;\n\n    if (length <= 0) {\n      return 0;\n    }\n    if (position < 0) {\n      // TODO: is this right?\n      return 0;\n    }\n    if (position >= this.meta.size) {\n      let view = new Uint8Array(buffer, offset);\n      for (let i = 0; i < length; i++) {\n        view[i] = 0;\n      }\n\n      return length;\n    }\n\n    _perf__WEBPACK_IMPORTED_MODULE_0__.record('read');\n\n    position = Math.max(position, 0);\n    let dataLength = Math.min(length, this.meta.size - position);\n\n    let start = position;\n    let end = position + dataLength;\n\n    let indexes = getBoundaryIndexes(this.meta.blockSize, start, end);\n\n    let chunks = this.load(indexes);\n    let readBuffer = readChunks(chunks, start, end);\n\n    if (buffer.byteLength - offset < readBuffer.byteLength) {\n      throw new Error('Buffer given to `read` is too small');\n    }\n    let view = new Uint8Array(buffer);\n    view.set(new Uint8Array(readBuffer), offset);\n\n    // TODO: I don't need to do this. `unixRead` does this for us.\n    for (let i = dataLength; i < length; i++) {\n      view[offset + i] = 0;\n    }\n\n    _perf__WEBPACK_IMPORTED_MODULE_0__.endRecording('read');\n\n    return length;\n  }\n\n  write(bufferView, offset, length, position) {\n    // console.log('writing', this.filename, offset, length, position);\n    let buffer = bufferView.buffer;\n\n    if (length <= 0) {\n      return 0;\n    }\n    if (position < 0) {\n      return 0;\n    }\n    if (buffer.byteLength === 0) {\n      return 0;\n    }\n\n    length = Math.min(length, buffer.byteLength - offset);\n\n    let writes = writeChunks(\n      new Uint8Array(buffer, offset, length),\n      this.meta.blockSize,\n      position,\n      position + length\n    );\n\n    // Find any partial chunks and read them in and merge with\n    // existing data\n    let { partialWrites, fullWrites } = writes.reduce(\n      (state, write) => {\n        if (write.length !== this.meta.blockSize) {\n          state.partialWrites.push(write);\n        } else {\n          state.fullWrites.push({\n            pos: write.pos,\n            data: write.data\n          });\n        }\n        return state;\n      },\n      { fullWrites: [], partialWrites: [] }\n    );\n\n    let reads = [];\n    if (partialWrites.length > 0) {\n      reads = this.load(partialWrites.map(w => w.pos));\n    }\n\n    let allWrites = fullWrites.concat(\n      reads.map(read => {\n        let write = partialWrites.find(w => w.pos === read.pos);\n\n        // MuTatIoN!\n        new Uint8Array(read.data).set(\n          new Uint8Array(write.data, write.offset, write.length),\n          write.offset,\n          write.length\n        );\n\n        return read;\n      })\n    );\n\n    this.bufferChunks(allWrites);\n\n    if (position + length > this.meta.size) {\n      this.setattr({ size: position + length });\n    }\n\n    return length;\n  }\n\n  lock(lockType) {\n    return this.ops.lock(lockType);\n  }\n\n  unlock(lockType) {\n    return this.ops.unlock(lockType);\n  }\n\n  fsync() {\n    if (this.buffer.size > 0) {\n      this.ops.writeBlocks([...this.buffer.values()], this.meta.blockSize);\n    }\n\n    if (this._metaDirty) {\n      this.ops.writeMeta(this.meta);\n      this._metaDirty = false;\n    }\n\n    this.buffer = new Map();\n  }\n\n  setattr(attr) {\n    if (attr.mode !== undefined) {\n      this.meta.mode = attr.mode;\n      this._metaDirty = true;\n    }\n\n    if (attr.timestamp !== undefined) {\n      this.meta.timestamp = attr.timestamp;\n      this._metaDirty = true;\n    }\n\n    if (attr.size !== undefined) {\n      this.meta.size = attr.size;\n      this._metaDirty = true;\n    }\n\n    if (attr.blockSize !== undefined) {\n      if (this.meta.blockSize != null) {\n        throw new Error('Changing blockSize is not allowed yet');\n      }\n      this.meta.blockSize = attr.blockSize;\n      this._metaDirty = true;\n    }\n  }\n\n  getattr() {\n    return this.meta;\n  }\n\n  startStats() {\n    _perf__WEBPACK_IMPORTED_MODULE_0__.start();\n    this.ops.startStats();\n  }\n\n  stats() {\n    _perf__WEBPACK_IMPORTED_MODULE_0__.end();\n    this.ops.stats();\n  }\n}\n\n\n//# sourceURL=webpack:///../blocked-file.js?");

/***/ }),

/***/ "../blocked-fs.js":
/*!************************!*\
  !*** ../blocked-fs.js ***!
  \************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ BlockedFS)\n/* harmony export */ });\nconst ERRNO_CODES = {\n  EPERM: 63,\n  ENOENT: 44\n};\n\n// This implements an emscripten-compatible filesystem that is means\n// to be mounted to the one from `sql.js`. Example:\n//\n// let BFS = new BlockedFS(SQL.FS, idbBackend);\n// SQL.FS.mount(BFS, {}, '/blocked');\n//\n// Now any files created under '/blocked' will be handled by this\n// filesystem, which creates a special file that handles read/writes\n// in the way that we want.\nclass BlockedFS {\n  constructor(FS, backend) {\n    this.FS = FS;\n    this.backend = backend;\n\n    this.node_ops = {\n      getattr: node => {\n        let fileattr = FS.isFile(node.mode) ? node.contents.getattr() : null;\n\n        let attr = {};\n        attr.dev = 1;\n        attr.ino = node.id;\n        attr.mode = fileattr ? fileattr.mode : node.mode;\n        attr.nlink = 1;\n        attr.uid = 0;\n        attr.gid = 0;\n        attr.rdev = node.rdev;\n        attr.size = fileattr ? fileattr.size : FS.isDir(node.mode) ? 4096 : 0;\n        attr.atime = new Date(0);\n        attr.mtime = new Date(0);\n        attr.ctime = new Date(0);\n        attr.blksize = fileattr ? fileattr.blockSize : 4096;\n        attr.blocks = Math.ceil(attr.size / attr.blksize);\n        return attr;\n      },\n      setattr: (node, attr) => {\n        if (FS.isFile(node)) {\n          node.contents.setattr(attr);\n        } else {\n          if (attr.mode != null) {\n            node.mode = attr.mode;\n          }\n          if (attr.size != null) {\n            node.size = attr.size;\n          }\n        }\n      },\n      lookup: (parent, name) => {\n        throw new this.FS.ErrnoError(ERRNO_CODES.ENOENT);\n      },\n      mknod: (parent, name, mode, dev) => {\n        if (name.endsWith('.lock')) {\n          throw new Error('Locking via lockfiles is not supported');\n        }\n\n        return this.createNode(parent, name, mode, dev);\n      },\n      rename: (old_node, new_dir, new_name) => {\n        throw new Error('rename not implemented');\n      },\n      unlink: (parent, name) => {\n        let node = this.FS.lookupNode(parent, name);\n        node.contents.delete(name);\n      },\n      readdir: node => {\n        // We could list all the available databases here if `node` is\n        // the root directory. However Firefox does not implemented\n        // such a methods. Other browsers do, but since it's not\n        // supported on all browsers users will need to track it\n        // separate anyway right now\n\n        throw new Error('readdir not implemented');\n      },\n      symlink: (parent, newname, oldpath) => {\n        throw new Error('symlink not implemented');\n      },\n      readlink: node => {\n        throw new Error('symlink not implemented');\n      }\n    };\n\n    this.stream_ops = {\n      open: stream => {\n        if (this.FS.isFile(stream.node.mode)) {\n          stream.node.contents.open();\n        }\n      },\n\n      close: stream => {\n        if (this.FS.isFile(stream.node.mode)) {\n          stream.node.contents.close();\n        }\n      },\n\n      read: (stream, buffer, offset, length, position) => {\n        // console.log('read', offset, length, position)\n        return stream.node.contents.read(buffer, offset, length, position);\n      },\n\n      write: (stream, buffer, offset, length, position) => {\n        // console.log('write', offset, length, position);\n        return stream.node.contents.write(buffer, offset, length, position);\n      },\n\n      llseek: (stream, offset, whence) => {\n        // Copied from MEMFS\n        var position = offset;\n        if (whence === 1) {\n          position += stream.position;\n        } else if (whence === 2) {\n          if (FS.isFile(stream.node.mode)) {\n            position += stream.node.contents.getattr().size;\n          }\n        }\n        if (position < 0) {\n          throw new this.FS.ErrnoError(28);\n        }\n        return position;\n      },\n      allocate: (stream, offset, length) => {\n        stream.node.contents.setattr({ size: offset + length });\n      },\n      mmap: (stream, address, length, position, prot, flags) => {\n        throw new Error('mmap not implemented');\n      },\n      msync: (stream, buffer, offset, length, mmapFlags) => {\n        throw new Error('msync not implemented');\n      },\n      fsync: (stream, buffer, offset, length, mmapFlags) => {\n        stream.node.contents.fsync();\n      }\n    };\n  }\n\n  async init() {\n    await this.backend.init();\n  }\n\n  mount() {\n    return this.createNode(null, '/', 16384 /* dir */ | 511 /* 0777 */, 0);\n  }\n\n  lock(path, lockType) {\n    let { node } = this.FS.lookupPath(path);\n    return node.contents.lock(lockType);\n  }\n\n  unlock(path, lockType) {\n    let { node } = this.FS.lookupPath(path);\n    return node.contents.unlock(lockType);\n  }\n\n  createNode(parent, name, mode, dev) {\n    // Only files and directories supported\n    if (!(this.FS.isDir(mode) || this.FS.isFile(mode))) {\n      throw new this.FS.ErrnoError(ERRNO_CODES.EPERM);\n    }\n\n    var node = this.FS.createNode(parent, name, mode, dev);\n    if (this.FS.isDir(node.mode)) {\n      node.node_ops = {\n        mknod: this.node_ops.mknod,\n        lookup: this.node_ops.lookup,\n        unlink: this.node_ops.unlink,\n        setattr: this.node_ops.setattr\n      };\n      node.stream_ops = {};\n      node.contents = {};\n    } else if (this.FS.isFile(node.mode)) {\n      node.node_ops = this.node_ops;\n      node.stream_ops = this.stream_ops;\n\n      // Create file!\n      node.contents = this.backend.createFile(name);\n    }\n\n    // add the new node to the parent\n    if (parent) {\n      parent.contents[name] = node;\n      parent.timestamp = node.timestamp;\n    }\n\n    return node;\n  }\n}\n\n\n//# sourceURL=webpack:///../blocked-fs.js?");

/***/ }),

/***/ "./fts/main.worker.js":
/*!****************************!*\
  !*** ./fts/main.worker.js ***!
  \****************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony import */ var _jlongster_sql_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jlongster/sql.js */ \"../../node_modules/@jlongster/sql.js/dist/sql-wasm.js\");\n/* harmony import */ var _jlongster_sql_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jlongster_sql_js__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var ___WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../.. */ \"../index.js\");\n/* harmony import */ var _memory_backend__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../memory/backend */ \"../memory/backend.js\");\n/* harmony import */ var _indexeddb_backend__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../../indexeddb/backend */ \"../indexeddb/backend.js\");\n\n\n\n\n\n\n// Various global state for the demo\n\nlet currentBackendType = 'idb';\nlet cacheSize = 5000;\nlet pageSize = 4096;\nlet dbName = `fts.sqlite`;\n\nlet idbBackend = new _indexeddb_backend__WEBPACK_IMPORTED_MODULE_3__.default(4096 * 2);\nlet BFS;\n\n// Helper methods\n\nlet SQL = null;\nlet ready = null;\nasync function _init() {\n  SQL = await _jlongster_sql_js__WEBPACK_IMPORTED_MODULE_0___default()({ locateFile: file => file });\n  BFS = new ___WEBPACK_IMPORTED_MODULE_1__.BlockedFS(SQL.FS, idbBackend);\n  SQL.register_for_idb(BFS);\n\n  try {\n    await BFS.init();\n  } catch (e) {\n    if (e.message.includes('SharedArrayBuffer')) {\n      output(\n        '<code>SharedArrayBuffer</code> is not available in your browser. It is required, but in the future we will provide a fallback.'\n      );\n    }\n    throw e;\n  }\n\n  SQL.FS.mkdir('/blocked');\n  SQL.FS.mount(BFS, {}, '/blocked');\n}\n\nfunction init() {\n  if (ready) {\n    return ready;\n  }\n\n  ready = _init();\n}\n\nfunction output(msg) {\n  self.postMessage({ type: 'output', msg });\n}\n\nfunction getDBName() {\n  return dbName;\n}\n\nlet _db = null;\nfunction closeDatabase() {\n  if (_db) {\n    output(`Closed db`);\n    _db.close();\n    _db = null;\n  }\n}\n\nasync function getDatabase() {\n  await init();\n  if (_db == null) {\n    _db = new SQL.Database(`/blocked/${getDBName()}`, { filename: true });\n    // Should ALWAYS use the journal in memory mode. Doesn't make\n    // any sense at all to write the journal\n    //\n    // It's also important to use the same page size that our storage\n    // system uses. This will change in the future so that you don't\n    // have to worry about sqlite's page size (requires some\n    // optimizations)\n    _db.exec(`\n      PRAGMA cache_size=-${cacheSize};\n      PRAGMA page_size=${pageSize};\n      PRAGMA journal_mode=MEMORY;\n    `);\n    output(\n      `Opened ${getDBName()} (${currentBackendType}) cache size: ${cacheSize}`\n    );\n  }\n  return _db;\n}\n\nfunction formatNumber(num) {\n  return new Intl.NumberFormat('en-US').format(num);\n}\n\nasync function fetchJSON(url) {\n  let res = await fetch(url);\n  return res.json();\n}\n\nasync function load() {\n  let db = await getDatabase();\n\n  let storyIds = await fetchJSON(\n    'https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty'\n  );\n\n  let stories = await Promise.all(\n    storyIds\n      .slice(0, 10)\n      .map(storyId =>\n        fetchJSON(\n          `https://hacker-news.firebaseio.com/v0/item/${storyId}.json?print=pretty`\n        )\n      )\n  );\n\n  let results = [];\n  for (let story of stories) {\n    let comments = story.kids;\n\n    if (comments && comments.length > 0) {\n      for (let commentId of comments.slice(0, 10)) {\n        let comment = await fetchJSON(\n          `https://hacker-news.firebaseio.com/v0/item/${commentId}.json?print=pretty`\n        );\n\n        if (comment.text) {\n          results.push({\n            id: commentId,\n            text: comment.text,\n            storyId: story.id,\n            storyTitle: story.title\n          });\n        }\n      }\n    }\n  }\n\n  db.exec('BEGIN TRANSACTION');\n  let stmt = db.prepare(\n    'INSERT INTO comments (content, url, title) VALUES (?, ?, ?)'\n  );\n  for (let result of results) {\n    let url = `https://news.ycombinator.com/item?id=${result.id}`;\n    stmt.run([result.text, url, result.storyTitle]);\n  }\n  db.exec('COMMIT');\n  console.log('done!');\n\n  count();\n}\n\nasync function search(term) {\n  let db = await getDatabase();\n\n  if (!term.includes('NEAR') && !term.match(/\"\\*/)) {\n    term = `\"*${term}*\"`;\n  }\n\n  let results = [];\n\n  let stmt = db.prepare(\n    `SELECT snippet(comments) as content, url, title FROM comments WHERE content MATCH ?`\n  );\n  stmt.bind([term]);\n  while (stmt.step()) {\n    let row = stmt.getAsObject();\n    results.push(row);\n  }\n  stmt.free();\n\n  self.postMessage({ type: 'results', results });\n}\n\nasync function count() {\n  let db = await getDatabase();\n\n  db.exec(`\n    CREATE VIRTUAL TABLE IF NOT EXISTS comments USING fts3(content, title, url);\n  `);\n\n  let stmt = db.prepare('SELECT COUNT(*) as count FROM comments');\n  stmt.step();\n  let row = stmt.getAsObject();\n  self.postMessage({ type: 'count', count: row.count });\n\n  stmt.free();\n}\n\nlet methods = {\n  init,\n  load,\n  search,\n  count\n};\n\nif (typeof self !== 'undefined') {\n  self.onmessage = msg => {\n    switch (msg.data.type) {\n      case 'search':\n        search(msg.data.name);\n        break;\n\n      case 'ui-invoke':\n        if (methods[msg.data.name] == null) {\n          throw new Error('Unknown method: ' + msg.data.name);\n        }\n        methods[msg.data.name]();\n        break;\n    }\n  };\n} else {\n  for (let method of Object.keys(methods)) {\n    let btn = document.querySelector(`#${method}`);\n    if (btn) {\n      btn.addEventListener('click', methods[method]);\n    }\n  }\n  init();\n}\n\n\n//# sourceURL=webpack:///./fts/main.worker.js?");

/***/ }),

/***/ "../index.js":
/*!*******************!*\
  !*** ../index.js ***!
  \*******************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"BlockedFS\": () => (/* binding */ BlockedFS),\n/* harmony export */   \"supportNestedWorkers\": () => (/* binding */ supportNestedWorkers)\n/* harmony export */ });\n/* harmony import */ var _blocked_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./blocked-fs */ \"../blocked-fs.js\");\n/* harmony import */ var _indexeddb_start_indexeddb_worker__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./indexeddb/start-indexeddb-worker */ \"../indexeddb/start-indexeddb-worker.js\");\n\n\n\n// Right now we don't support `export from` so we do this manually\n//\n// TODO: This isn't packaged up the best. There will be duplicate code\n// across bundles and we need to separate things better\nconst BlockedFS = _blocked_fs__WEBPACK_IMPORTED_MODULE_0__.default;\nconst supportNestedWorkers = _indexeddb_start_indexeddb_worker__WEBPACK_IMPORTED_MODULE_1__.supportNestedWorkers;\n\n\n//# sourceURL=webpack:///../index.js?");

/***/ }),

/***/ "../indexeddb/backend.js":
/*!*******************************!*\
  !*** ../indexeddb/backend.js ***!
  \*******************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ IndexedDBBackend)\n/* harmony export */ });\n/* harmony import */ var _shared_channel__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./shared-channel */ \"../indexeddb/shared-channel.js\");\n/* harmony import */ var _blocked_file__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../blocked-file */ \"../blocked-file.js\");\n/* harmony import */ var _start_indexeddb_worker__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./start-indexeddb-worker */ \"../indexeddb/start-indexeddb-worker.js\");\n\n\n\n\n// These are temporarily global, but will be easy to clean up later\nlet reader, writer;\n\nfunction positionToKey(pos, blockSize) {\n  // We are forced to round because of floating point error. `pos`\n  // should always be divisible by `blockSize`\n  return Math.round(pos / blockSize);\n}\n\nfunction invokeWorker(method, args) {\n  switch (method) {\n    case 'stats-start': {\n      writer.string('stats-start');\n      writer.finalize();\n      reader.int32();\n      reader.done();\n      break;\n    }\n\n    case 'stats': {\n      writer.string('stats');\n      writer.finalize();\n      reader.int32();\n      reader.done();\n      break;\n    }\n\n    case 'readBlocks': {\n      let { name, positions, blockSize } = args;\n\n      let res = [];\n      for (let pos of positions) {\n        writer.string('readBlock');\n        writer.string(name);\n        writer.int32(positionToKey(pos, blockSize));\n        writer.finalize();\n\n        let data = reader.bytes();\n        reader.done();\n        res.push({\n          pos,\n          // If th length is 0, the block didn't exist. We return a\n          // blank block in that case\n          data: data.byteLength === 0 ? new ArrayBuffer(blockSize) : data\n        });\n      }\n\n      return res;\n    }\n\n    case 'writeBlocks': {\n      let { name, writes, blockSize } = args;\n      writer.string('writeBlocks');\n      writer.string(name);\n      for (let write of writes) {\n        writer.int32(positionToKey(write.pos, blockSize));\n        writer.bytes(write.data);\n      }\n      writer.finalize();\n\n      // Block for empty response\n\n      let res = reader.int32();\n      reader.done();\n      return res;\n    }\n\n    case 'readMeta': {\n      writer.string('readMeta');\n      writer.string(args.name);\n      writer.finalize();\n\n      let size = reader.int32();\n      let blockSize = reader.int32();\n      reader.done();\n      return size === -1 ? null : { size, blockSize };\n    }\n\n    case 'writeMeta': {\n      let { name, meta } = args;\n      writer.string('writeMeta');\n      writer.string(name);\n      writer.int32(meta.size);\n      writer.int32(meta.blockSize);\n      writer.finalize();\n\n      let res = reader.int32();\n      reader.done();\n      return res;\n    }\n\n    case 'deleteFile': {\n      writer.string('deleteFile');\n      writer.string(args.name);\n      writer.finalize();\n\n      let res = reader.int32();\n      reader.done();\n      return res;\n    }\n\n    case 'lockFile': {\n      writer.string('lockFile');\n      writer.string(args.name);\n      writer.int32(args.lockType);\n      writer.finalize();\n\n      let res = reader.int32();\n      reader.done();\n      return res === 0;\n    }\n\n    case 'unlockFile': {\n      writer.string('unlockFile');\n      writer.string(args.name);\n      writer.int32(args.lockType);\n      writer.finalize();\n\n      let res = reader.int32();\n      reader.done();\n      return res === 0;\n    }\n  }\n}\n\nclass FileOps {\n  constructor(filename) {\n    this.filename = filename;\n  }\n\n  startStats() {\n    return invokeWorker('stats-start');\n  }\n\n  stats() {\n    return invokeWorker('stats');\n  }\n\n  getStoreName() {\n    return this.filename.replace(/\\//g, '-');\n  }\n\n  lock(lockType) {\n    return invokeWorker('lockFile', { name: this.getStoreName(), lockType });\n  }\n\n  unlock(lockType) {\n    return invokeWorker('unlockFile', { name: this.getStoreName(), lockType });\n  }\n\n  delete() {\n    invokeWorker('deleteFile', { name: this.getStoreName() });\n  }\n\n  readMeta() {\n    return invokeWorker('readMeta', { name: this.getStoreName() });\n  }\n\n  writeMeta(meta) {\n    return invokeWorker('writeMeta', { name: this.getStoreName(), meta });\n  }\n\n  readBlocks(positions, blockSize) {\n    // if (Math.random() < 0.005) {\n    //   console.log('reading', positions);\n    // }\n\n    if (this.stats) {\n      this.stats.read += positions.length;\n    }\n\n    return invokeWorker('readBlocks', {\n      name: this.getStoreName(),\n      positions,\n      blockSize\n    });\n  }\n\n  writeBlocks(writes, blockSize) {\n    // console.log('_writing', this.filename, writes);\n    if (this.stats) {\n      this.stats.writes += writes.length;\n    }\n\n    return invokeWorker('writeBlocks', {\n      name: this.getStoreName(),\n      writes,\n      blockSize\n    });\n  }\n}\n\nclass IndexedDBBackend {\n  constructor(defaultBlockSize) {\n    this.defaultBlockSize = defaultBlockSize;\n  }\n\n  async init() {\n    let argBuffer = new SharedArrayBuffer(4096 * 9);\n    writer = new _shared_channel__WEBPACK_IMPORTED_MODULE_0__.Writer(argBuffer, { name: 'args (backend)', debug: false });\n\n    let resultBuffer = new SharedArrayBuffer(4096 * 9);\n    reader = new _shared_channel__WEBPACK_IMPORTED_MODULE_0__.Reader(resultBuffer, { name: 'results', debug: false });\n\n    await (0,_start_indexeddb_worker__WEBPACK_IMPORTED_MODULE_2__.startWorker)(argBuffer, resultBuffer);\n  }\n\n  createFile(filename) {\n    return new _blocked_file__WEBPACK_IMPORTED_MODULE_1__.File(filename, this.defaultBlockSize, new FileOps(filename));\n  }\n}\n\n\n//# sourceURL=webpack:///../indexeddb/backend.js?");

/***/ }),

/***/ "../indexeddb/shared-channel.js":
/*!**************************************!*\
  !*** ../indexeddb/shared-channel.js ***!
  \**************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"Reader\": () => (/* binding */ Reader),\n/* harmony export */   \"Writer\": () => (/* binding */ Writer)\n/* harmony export */ });\nlet FINALIZED = 0xdeadbeef;\n\nlet WRITEABLE = 0;\nlet READABLE = 1;\n\nclass Reader {\n  constructor(\n    buffer,\n    { initialOffset = 4, useAtomics = true, stream = true, debug, name } = {}\n  ) {\n    this.buffer = buffer;\n    this.atomicView = new Int32Array(buffer);\n    this.offset = initialOffset;\n    this.useAtomics = useAtomics;\n    this.stream = stream;\n    this.debug = debug;\n    this.name = name;\n  }\n\n  log(...args) {\n    if (this.debug) {\n      console.log(`[reader: ${this.name}]`, ...args);\n    }\n  }\n\n  waitWrite(name) {\n    if (this.useAtomics) {\n      this.log(`waiting for ${name}`);\n\n      while (Atomics.load(this.atomicView, 0) === WRITEABLE) {\n        // console.log('waiting for write...');\n        Atomics.wait(this.atomicView, 0, WRITEABLE, 500);\n      }\n\n      this.log(`resumed for ${name}`);\n    } else {\n      if (this.atomicView[0] !== READABLE) {\n        throw new Error('`waitWrite` expected array to be readable');\n      }\n    }\n  }\n\n  flip() {\n    this.log('flip');\n    if (this.useAtomics) {\n      let prev = Atomics.compareExchange(\n        this.atomicView,\n        0,\n        READABLE,\n        WRITEABLE\n      );\n\n      if (prev !== READABLE) {\n        throw new Error('Read data out of sync! This is disastrous');\n      }\n\n      Atomics.notify(this.atomicView, 0);\n    } else {\n      this.atomicView[0] = WRITEABLE;\n    }\n\n    this.offset = 4;\n  }\n\n  done() {\n    this.waitWrite('done');\n\n    let dataView = new DataView(this.buffer, this.offset);\n    let done = dataView.getUint32(0) === FINALIZED;\n\n    if (done) {\n      this.log('done');\n      this.flip();\n    }\n\n    return done;\n  }\n\n  peek(fn) {\n    this.peekOffset = this.offset;\n    let res = fn();\n    this.offset = this.peekOffset;\n    this.peekOffset = null;\n    return res;\n  }\n\n  string() {\n    this.waitWrite('string');\n\n    let byteLength = this._int32();\n    let length = byteLength / 2;\n\n    let dataView = new DataView(this.buffer, this.offset, byteLength);\n    let chars = [];\n    for (let i = 0; i < length; i++) {\n      chars.push(dataView.getUint16(i * 2));\n    }\n    let str = String.fromCharCode.apply(null, chars);\n    this.log('string', str);\n\n    this.offset += byteLength;\n\n    if (this.peekOffset == null) {\n      this.flip();\n    }\n    return str;\n  }\n\n  _int32() {\n    let byteLength = 4;\n\n    let dataView = new DataView(this.buffer, this.offset);\n    let num = dataView.getInt32();\n    this.log('_int32', num);\n\n    this.offset += byteLength;\n    return num;\n  }\n\n  int32() {\n    this.waitWrite('int32');\n    let num = this._int32();\n    this.log('int32', num);\n\n    if (this.peekOffset == null) {\n      this.flip();\n    }\n    return num;\n  }\n\n  bytes() {\n    this.waitWrite('bytes');\n\n    let byteLength = this._int32();\n\n    let bytes = new ArrayBuffer(byteLength);\n    new Uint8Array(bytes).set(\n      new Uint8Array(this.buffer, this.offset, byteLength)\n    );\n    this.log('bytes', bytes);\n\n    this.offset += byteLength;\n\n    if (this.peekOffset == null) {\n      this.flip();\n    }\n    return bytes;\n  }\n}\n\nclass Writer {\n  constructor(\n    buffer,\n    { initialOffset = 4, useAtomics = true, stream = true, debug, name } = {}\n  ) {\n    this.buffer = buffer;\n    this.atomicView = new Int32Array(buffer);\n    this.offset = initialOffset;\n    this.useAtomics = useAtomics;\n    this.stream = stream;\n\n    this.debug = debug;\n    this.name = name;\n\n    if (this.useAtomics) {\n      // The buffer starts out as writeable\n      Atomics.store(this.atomicView, 0, WRITEABLE);\n    } else {\n      this.atomicView[0] = WRITEABLE;\n    }\n  }\n\n  log(...args) {\n    if (this.debug) {\n      console.log(`[writer: ${this.name}]`, ...args);\n    }\n  }\n\n  waitRead(name) {\n    if (this.useAtomics) {\n      this.log(`waiting for ${name}`);\n      // Switch to writable\n      // Atomics.store(this.atomicView, 0, 1);\n\n      let prev = Atomics.compareExchange(\n        this.atomicView,\n        0,\n        WRITEABLE,\n        READABLE\n      );\n\n      if (prev !== WRITEABLE) {\n        throw new Error(\n          'Wrote something into unwritable buffer! This is disastrous'\n        );\n      }\n\n      Atomics.notify(this.atomicView, 0);\n\n      while (Atomics.load(this.atomicView, 0) === READABLE) {\n        // console.log('waiting to be read...');\n        Atomics.wait(this.atomicView, 0, READABLE, 500);\n      }\n\n      this.log(`resumed for ${name}`);\n    } else {\n      this.atomicView[0] = READABLE;\n    }\n\n    this.offset = 4;\n  }\n\n  finalize() {\n    this.log('finalizing');\n    let dataView = new DataView(this.buffer, this.offset);\n    dataView.setUint32(0, FINALIZED);\n    this.waitRead('finalize');\n  }\n\n  string(str) {\n    this.log('string', str);\n\n    let byteLength = str.length * 2;\n    this._int32(byteLength);\n\n    let dataView = new DataView(this.buffer, this.offset, byteLength);\n    for (let i = 0; i < str.length; i++) {\n      dataView.setUint16(i * 2, str.charCodeAt(i));\n    }\n\n    this.offset += byteLength;\n    this.waitRead('string');\n  }\n\n  _int32(num) {\n    let byteLength = 4;\n\n    let dataView = new DataView(this.buffer, this.offset);\n    dataView.setInt32(0, num);\n\n    this.offset += byteLength;\n  }\n\n  int32(num) {\n    this.log('int32', num);\n    this._int32(num);\n    this.waitRead('int32');\n  }\n\n  bytes(buffer) {\n    this.log('bytes', buffer);\n\n    let byteLength = buffer.byteLength;\n    this._int32(byteLength);\n    new Uint8Array(this.buffer, this.offset).set(new Uint8Array(buffer));\n\n    this.offset += byteLength;\n    this.waitRead('bytes');\n  }\n}\n\n\n//# sourceURL=webpack:///../indexeddb/shared-channel.js?");

/***/ }),

/***/ "../indexeddb/start-indexeddb-worker.js":
/*!**********************************************!*\
  !*** ../indexeddb/start-indexeddb-worker.js ***!
  \**********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"startWorker\": () => (/* binding */ startWorker),\n/* harmony export */   \"supportNestedWorkers\": () => (/* binding */ supportNestedWorkers)\n/* harmony export */ });\n/* harmony import */ var _worker_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./worker.js */ \"../indexeddb/worker.js\");\n\n\nlet workerReady = null;\n\nfunction isWorker() {\n  return (\n    typeof WorkerGlobalScope !== 'undefined' &&\n    self instanceof WorkerGlobalScope\n  );\n}\n\nfunction startWorker(argBuffer, resultBuffer) {\n  if (workerReady) {\n    return workerReady;\n  }\n\n  let onReady;\n  workerReady = new Promise(resolve => (onReady = resolve));\n\n  if (typeof Worker === 'undefined') {\n    // No `Worker` available - this context does not support nested\n    // workers sadly. We need to proxy creating a worker to the main\n    // thread.\n    if (!isWorker()) {\n      // We're on the main thread? Weird: it doesn't have workers\n      throw new Error(\n        'Web workers not available, even from the main thread. sqlite3 requires web workers to work.'\n      );\n    }\n\n    self.postMessage({\n      type: 'spawn-idb-worker',\n      argBuffer,\n      resultBuffer\n    });\n\n    self.addEventListener('message', e => {\n      if (e.data.type === 'worker-ready') {\n        onReady();\n      }\n    });\n  } else {\n    let worker = new _worker_js__WEBPACK_IMPORTED_MODULE_0__.default();\n\n    // This is another way to load the worker. It won't be inlined\n    // into the script, which might be better for debugging, but makes\n    // it more difficult to distribute.\n    // let worker = new Worker(new URL('./indexeddb.worker.js', import.meta.url));\n\n    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });\n\n    worker.onmessage = msg => {\n      if (msg.data.type === 'worker-ready') {\n        onReady();\n      }\n    };\n\n    return workerReady;\n  }\n}\n\n// This is called from the main thread to setup a proxy for spawning\n// workers. It's necessary for browsers that don't support spawning\n// workers from workers (only Safari).\nfunction supportNestedWorkers(worker) {\n  worker.addEventListener('message', e => {\n    if (e.data.type === 'spawn-idb-worker') {\n      startWorker(e.data.argBuffer, e.data.resultBuffer).then(() => {\n        worker.postMessage({ type: 'worker-ready' });\n      });\n    }\n  });\n}\n\n\n//# sourceURL=webpack:///../indexeddb/start-indexeddb-worker.js?");

/***/ }),

/***/ "../memory/backend.js":
/*!****************************!*\
  !*** ../memory/backend.js ***!
  \****************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"FileOps\": () => (/* binding */ FileOps),\n/* harmony export */   \"default\": () => (/* binding */ MemoryBackend)\n/* harmony export */ });\n/* harmony import */ var _blocked_file__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../blocked-file */ \"../blocked-file.js\");\n\n\nclass FileOps {\n  constructor(filename, meta = null, data) {\n    this.filename = filename;\n    this.locked = false;\n    this.meta = meta;\n    this.data = data || new ArrayBuffer(0);\n  }\n\n  lock() {\n    return true;\n  }\n\n  unlock() {\n    return true;\n  }\n\n  delete() {\n    // in-memory noop\n  }\n\n  startStats() {}\n  stats() {}\n\n  readMeta() {\n    return this.meta;\n  }\n\n  writeMeta(meta) {\n    if (this.meta == null) {\n      this.meta = {};\n    }\n    this.meta.size = meta.size;\n    this.meta.blockSize = meta.blockSize;\n  }\n\n  readBlocks(positions, blockSize) {\n    // console.log('_reading', this.filename, positions);\n    let data = this.data;\n\n    return positions.map(pos => {\n      let buffer = new ArrayBuffer(blockSize);\n\n      if (pos < data.byteLength) {\n        new Uint8Array(buffer).set(\n          new Uint8Array(data, pos, Math.min(blockSize, data.byteLength - pos))\n        );\n      }\n\n      return { pos, data: buffer };\n    });\n  }\n\n  writeBlocks(writes, blockSize) {\n    // console.log('_writing', this.filename, writes);\n    let data = this.data;\n\n    console.log('writes', writes.length);\n    let i = 0;\n    for (let write of writes) {\n      if (i % 1000 === 0) {\n        console.log('write');\n      }\n      i++;\n      let fullLength = write.pos + write.data.byteLength;\n\n      if (fullLength > data.byteLength) {\n        // Resize file\n        let buffer = new ArrayBuffer(fullLength);\n        new Uint8Array(buffer).set(new Uint8Array(data));\n        this.data = data = buffer;\n      }\n\n      new Uint8Array(data).set(new Uint8Array(write.data), write.pos);\n    }\n  }\n}\n\nclass MemoryBackend {\n  constructor(defaultBlockSize, fileData) {\n    this.fileData = Object.fromEntries(\n      Object.entries(fileData).map(([name, data]) => {\n        return [name, data];\n      })\n    );\n    this.files = {};\n    this.defaultBlockSize = defaultBlockSize;\n  }\n\n  async init() {}\n\n  createFile(filename) {\n    console.log('creating', filename);\n    if (this.files[filename] == null) {\n      let data = this.fileData[filename];\n\n      this.files[filename] = new _blocked_file__WEBPACK_IMPORTED_MODULE_0__.File(\n        filename,\n        this.defaultBlockSize,\n        new FileOps(\n          filename,\n          data\n            ? {\n                size: data.byteLength,\n                blockSize: this.defaultBlockSize\n              }\n            : null\n        )\n      );\n    }\n    return this.files[filename];\n  }\n\n  getFile(filename) {\n    return this.files[filename];\n  }\n}\n\n\n//# sourceURL=webpack:///../memory/backend.js?");

/***/ }),

/***/ "../perf.dev.js":
/*!**********************!*\
  !*** ../perf.dev.js ***!
  \**********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"end\": () => (/* binding */ end),\n/* harmony export */   \"start\": () => (/* binding */ start),\n/* harmony export */   \"record\": () => (/* binding */ record),\n/* harmony export */   \"endRecording\": () => (/* binding */ endRecording)\n/* harmony export */ });\n/* harmony import */ var detect_browser__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! detect-browser */ \"../../node_modules/detect-browser/es/index.js\");\n\n\nconst browser = (0,detect_browser__WEBPACK_IMPORTED_MODULE_0__.detect)();\n\nlet token = '';\nlet sheetId = '1p1isUZkWe8oc12LL0kqaT3UFT_MR8vEoEieEruHW-xE';\n\nlet buffer = 40000;\nlet baseTime;\nlet timings = {};\n\nlet range;\nif (browser.name === 'chrome') {\n  range = 'A3';\n} else if (browser.name === 'safari') {\n  range = 'D3';\n} else if (browser.name === 'firefox') {\n  range = 'G3';\n} else {\n  throw new Error('Unknown browser: ' + browser.name);\n}\n\nconst descriptions = {\n  get: 'Calls to `store.get`',\n  'stream-next': 'Advancing a cursor',\n  stream: 'Opening a cursor',\n  read: 'Full process for reading a block'\n};\n\nfunction last(arr) {\n  return arr.length === 0 ? null : arr[arr.length - 1];\n}\n\nfunction percentile(data, p) {\n  let sorted = [...data];\n  sorted.sort((n1, n2) => n1[1] - n2[1]);\n  return sorted.slice(0, Math.ceil(sorted.length * p) | 0);\n}\n\nlet showWarning = true;\n\nasync function writeData(sheetName, data) {\n  let arr = percentile(data, 0.95);\n\n  if (arr.length > buffer) {\n    arr = arr.slice(-buffer);\n  } else {\n    while (arr.length < buffer) {\n      arr.push(['', '']);\n    }\n  }\n\n  let res = await fetch(\n    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!${range}?valueInputOption=USER_ENTERED`,\n    {\n      method: 'PUT',\n      headers: {\n        'Content-Type': 'application/json',\n        Authorization: `Bearer ${token}`\n      },\n      body: JSON.stringify({ values: arr })\n    }\n  );\n  if (res.status == 200) {\n    console.log(`Logged timings to spreadsheet (${sheetName}))`);\n  } else {\n    if (showWarning) {\n      showWarning = false;\n      console.warn(\n        'Unable to log perf data to spreadsheet. Is the OAuth token expired?'\n      );\n    }\n\n    console.log(`--- ${sheetName} (${descriptions[sheetName]}) ---`);\n    console.log(`Count: ${data.length}`);\n    console.log(`p50: ${last(percentile(data, 0.5))[1]}`);\n    console.log(`p95: ${last(percentile(data, 0.95))[1]}`);\n  }\n}\n\nasync function end() {\n  await Promise.all(\n    Object.keys(timings).map(name => {\n      let timing = timings[name];\n      return writeData(name, timing.data.map(x => [x.start + x.took, x.took]));\n    })\n  );\n}\n\nfunction start() {\n  timings = {};\n  baseTime = performance.now();\n}\n\nfunction record(name) {\n  if (timings[name] == null) {\n    timings[name] = { start: null, data: [] };\n  }\n  let timer = timings[name];\n\n  if (timer.start != null) {\n    throw new Error(`timer already started ${name}`);\n  }\n  timer.start = performance.now();\n}\n\nfunction endRecording(name) {\n  let now = performance.now();\n  let timer = timings[name];\n\n  if (timer && timer.start != null) {\n    let took = now - timer.start;\n    let start = timer.start - baseTime;\n    timer.start = null;\n\n    if (timer.data.length < buffer) {\n      timer.data.push({ start, took });\n    }\n  }\n}\n\n\n//# sourceURL=webpack:///../perf.dev.js?");

/***/ }),

/***/ "?ed39":
/*!************************!*\
  !*** crypto (ignored) ***!
  \************************/
/***/ (() => {

eval("/* (ignored) */\n\n//# sourceURL=webpack:///crypto_(ignored)?");

/***/ }),

/***/ "?d20d":
/*!********************!*\
  !*** fs (ignored) ***!
  \********************/
/***/ (() => {

eval("/* (ignored) */\n\n//# sourceURL=webpack:///fs_(ignored)?");

/***/ }),

/***/ "?8329":
/*!**********************!*\
  !*** path (ignored) ***!
  \**********************/
/***/ (() => {

eval("/* (ignored) */\n\n//# sourceURL=webpack:///path_(ignored)?");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			loaded: false,
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/******/ 	// the startup function
/******/ 	__webpack_require__.x = () => {
/******/ 		// Load entry module and return exports
/******/ 		// This entry module depends on other loaded chunks and execution need to be delayed
/******/ 		var __webpack_exports__ = __webpack_require__.O(undefined, ["vendors-node_modules_jlongster_sql_js_dist_sql-wasm_js-node_modules_detect-browser_es_index_js"], () => (__webpack_require__("./fts/main.worker.js")))
/******/ 		__webpack_exports__ = __webpack_require__.O(__webpack_exports__);
/******/ 		return __webpack_exports__;
/******/ 	};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/chunk loaded */
/******/ 	(() => {
/******/ 		var deferred = [];
/******/ 		__webpack_require__.O = (result, chunkIds, fn, priority) => {
/******/ 			if(chunkIds) {
/******/ 				priority = priority || 0;
/******/ 				for(var i = deferred.length; i > 0 && deferred[i - 1][2] > priority; i--) deferred[i] = deferred[i - 1];
/******/ 				deferred[i] = [chunkIds, fn, priority];
/******/ 				return;
/******/ 			}
/******/ 			var notFulfilled = Infinity;
/******/ 			for (var i = 0; i < deferred.length; i++) {
/******/ 				var [chunkIds, fn, priority] = deferred[i];
/******/ 				var fulfilled = true;
/******/ 				for (var j = 0; j < chunkIds.length; j++) {
/******/ 					if ((priority & 1 === 0 || notFulfilled >= priority) && Object.keys(__webpack_require__.O).every((key) => (__webpack_require__.O[key](chunkIds[j])))) {
/******/ 						chunkIds.splice(j--, 1);
/******/ 					} else {
/******/ 						fulfilled = false;
/******/ 						if(priority < notFulfilled) notFulfilled = priority;
/******/ 					}
/******/ 				}
/******/ 				if(fulfilled) {
/******/ 					deferred.splice(i--, 1)
/******/ 					result = fn();
/******/ 				}
/******/ 			}
/******/ 			return result;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/ensure chunk */
/******/ 	(() => {
/******/ 		__webpack_require__.f = {};
/******/ 		// This file contains only the entry chunk.
/******/ 		// The chunk loading function for additional chunks
/******/ 		__webpack_require__.e = (chunkId) => {
/******/ 			return Promise.all(Object.keys(__webpack_require__.f).reduce((promises, key) => {
/******/ 				__webpack_require__.f[key](chunkId, promises);
/******/ 				return promises;
/******/ 			}, []));
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/get javascript chunk filename */
/******/ 	(() => {
/******/ 		// This function allow to reference async chunks and sibling chunks for the entrypoint
/******/ 		__webpack_require__.u = (chunkId) => {
/******/ 			// return url for filenames based on template
/******/ 			return "" + chunkId + ".js";
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/node module decorator */
/******/ 	(() => {
/******/ 		__webpack_require__.nmd = (module) => {
/******/ 			module.paths = [];
/******/ 			if (!module.children) module.children = [];
/******/ 			return module;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/publicPath */
/******/ 	(() => {
/******/ 		var scriptUrl;
/******/ 		if (__webpack_require__.g.importScripts) scriptUrl = __webpack_require__.g.location + "";
/******/ 		var document = __webpack_require__.g.document;
/******/ 		if (!scriptUrl && document) {
/******/ 			if (document.currentScript)
/******/ 				scriptUrl = document.currentScript.src
/******/ 			if (!scriptUrl) {
/******/ 				var scripts = document.getElementsByTagName("script");
/******/ 				if(scripts.length) scriptUrl = scripts[scripts.length - 1].src
/******/ 			}
/******/ 		}
/******/ 		// When supporting browsers where an automatic publicPath is not supported you must specify an output.publicPath manually via configuration
/******/ 		// or pass an empty string ("") and set the __webpack_public_path__ variable from your code to use your own logic.
/******/ 		if (!scriptUrl) throw new Error("Automatic publicPath is not supported in this browser");
/******/ 		scriptUrl = scriptUrl.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/[^\/]+$/, "/");
/******/ 		__webpack_require__.p = scriptUrl;
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/importScripts chunk loading */
/******/ 	(() => {
/******/ 		// no baseURI
/******/ 		
/******/ 		// object to store loaded chunks
/******/ 		// "1" means "already loaded"
/******/ 		var installedChunks = {
/******/ 			"fts_main_worker_js": 1
/******/ 		};
/******/ 		
/******/ 		// importScripts chunk loading
/******/ 		var installChunk = (data) => {
/******/ 			var [chunkIds, moreModules, runtime] = data;
/******/ 			for(var moduleId in moreModules) {
/******/ 				if(__webpack_require__.o(moreModules, moduleId)) {
/******/ 					__webpack_require__.m[moduleId] = moreModules[moduleId];
/******/ 				}
/******/ 			}
/******/ 			if(runtime) runtime(__webpack_require__);
/******/ 			while(chunkIds.length)
/******/ 				installedChunks[chunkIds.pop()] = 1;
/******/ 			parentChunkLoadingFunction(data);
/******/ 		};
/******/ 		__webpack_require__.f.i = (chunkId, promises) => {
/******/ 			// "1" is the signal for "already loaded"
/******/ 			if(!installedChunks[chunkId]) {
/******/ 				if(true) { // all chunks have JS
/******/ 					importScripts(__webpack_require__.p + __webpack_require__.u(chunkId));
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 		
/******/ 		var chunkLoadingGlobal = self["webpackChunk"] = self["webpackChunk"] || [];
/******/ 		var parentChunkLoadingFunction = chunkLoadingGlobal.push.bind(chunkLoadingGlobal);
/******/ 		chunkLoadingGlobal.push = installChunk;
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/startup chunk dependencies */
/******/ 	(() => {
/******/ 		var next = __webpack_require__.x;
/******/ 		__webpack_require__.x = () => {
/******/ 			return __webpack_require__.e("vendors-node_modules_jlongster_sql_js_dist_sql-wasm_js-node_modules_detect-browser_es_index_js").then(next);
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// run startup
/******/ 	var __webpack_exports__ = __webpack_require__.x();
/******/ 	
/******/ })()
;