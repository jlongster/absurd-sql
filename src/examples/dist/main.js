/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "../indexeddb/worker.js":
/*!******************************!*\
  !*** ../indexeddb/worker.js ***!
  \******************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ Worker_fn)\n/* harmony export */ });\nfunction Worker_fn() {\n  return new Worker(__webpack_require__.p + \"worker.worker.js\");\n}\n\n\n//# sourceURL=webpack:///../indexeddb/worker.js?");

/***/ }),

/***/ "../blocked-fs.js":
/*!************************!*\
  !*** ../blocked-fs.js ***!
  \************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ BlockedFS)\n/* harmony export */ });\nconst ERRNO_CODES = {\n  EPERM: 63,\n  ENOENT: 44\n};\n\n// This implements an emscripten-compatible filesystem that is means\n// to be mounted to the one from `sql.js`. Example:\n//\n// let BFS = new BlockedFS(SQL.FS, idbBackend);\n// SQL.FS.mount(BFS, {}, '/blocked');\n//\n// Now any files created under '/blocked' will be handled by this\n// filesystem, which creates a special file that handles read/writes\n// in the way that we want.\nclass BlockedFS {\n  constructor(FS, backend) {\n    this.FS = FS;\n    this.backend = backend;\n\n    this.node_ops = {\n      getattr: node => {\n        let fileattr = FS.isFile(node.mode) ? node.contents.getattr() : null;\n\n        let attr = {};\n        attr.dev = 1;\n        attr.ino = node.id;\n        attr.mode = fileattr ? fileattr.mode : node.mode;\n        attr.nlink = 1;\n        attr.uid = 0;\n        attr.gid = 0;\n        attr.rdev = node.rdev;\n        attr.size = fileattr ? fileattr.size : FS.isDir(node.mode) ? 4096 : 0;\n        attr.atime = new Date(0);\n        attr.mtime = new Date(0);\n        attr.ctime = new Date(0);\n        attr.blksize = fileattr ? fileattr.blockSize : 4096;\n        attr.blocks = Math.ceil(attr.size / attr.blksize);\n        return attr;\n      },\n      setattr: (node, attr) => {\n        if (FS.isFile(node)) {\n          node.contents.setattr(attr);\n        } else {\n          if (attr.mode != null) {\n            node.mode = attr.mode;\n          }\n          if (attr.size != null) {\n            node.size = attr.size;\n          }\n        }\n      },\n      lookup: (parent, name) => {\n        throw new this.FS.ErrnoError(ERRNO_CODES.ENOENT);\n      },\n      mknod: (parent, name, mode, dev) => {\n        if (name.endsWith('.lock')) {\n          throw new Error('Locking via lockfiles is not supported');\n        }\n\n        return this.createNode(parent, name, mode, dev);\n      },\n      rename: (old_node, new_dir, new_name) => {\n        throw new Error('rename not implemented');\n      },\n      unlink: (parent, name) => {\n        let node = this.FS.lookupNode(parent, name);\n        node.contents.delete(name);\n      },\n      readdir: node => {\n        // We could list all the available databases here if `node` is\n        // the root directory. However Firefox does not implemented\n        // such a methods. Other browsers do, but since it's not\n        // supported on all browsers users will need to track it\n        // separate anyway right now\n\n        throw new Error('readdir not implemented');\n      },\n      symlink: (parent, newname, oldpath) => {\n        throw new Error('symlink not implemented');\n      },\n      readlink: node => {\n        throw new Error('symlink not implemented');\n      }\n    };\n\n    this.stream_ops = {\n      open: stream => {\n        if (this.FS.isFile(stream.node.mode)) {\n          stream.node.contents.open();\n        }\n      },\n\n      close: stream => {\n        if (this.FS.isFile(stream.node.mode)) {\n          stream.node.contents.close();\n        }\n      },\n\n      read: (stream, buffer, offset, length, position) => {\n        // console.log('read', offset, length, position)\n        return stream.node.contents.read(buffer, offset, length, position);\n      },\n\n      write: (stream, buffer, offset, length, position) => {\n        // console.log('write', offset, length, position);\n        return stream.node.contents.write(buffer, offset, length, position);\n      },\n\n      llseek: (stream, offset, whence) => {\n        // Copied from MEMFS\n        var position = offset;\n        if (whence === 1) {\n          position += stream.position;\n        } else if (whence === 2) {\n          if (FS.isFile(stream.node.mode)) {\n            position += stream.node.contents.getattr().size;\n          }\n        }\n        if (position < 0) {\n          throw new this.FS.ErrnoError(28);\n        }\n        return position;\n      },\n      allocate: (stream, offset, length) => {\n        stream.node.contents.setattr({ size: offset + length });\n      },\n      mmap: (stream, address, length, position, prot, flags) => {\n        throw new Error('mmap not implemented');\n      },\n      msync: (stream, buffer, offset, length, mmapFlags) => {\n        throw new Error('msync not implemented');\n      },\n      fsync: (stream, buffer, offset, length, mmapFlags) => {\n        stream.node.contents.fsync();\n      }\n    };\n  }\n\n  async init() {\n    await this.backend.init();\n  }\n\n  mount() {\n    return this.createNode(null, '/', 16384 /* dir */ | 511 /* 0777 */, 0);\n  }\n\n  lock(path, lockType) {\n    let { node } = this.FS.lookupPath(path);\n    return node.contents.lock(lockType);\n  }\n\n  unlock(path, lockType) {\n    let { node } = this.FS.lookupPath(path);\n    return node.contents.unlock(lockType);\n  }\n\n  createNode(parent, name, mode, dev) {\n    // Only files and directories supported\n    if (!(this.FS.isDir(mode) || this.FS.isFile(mode))) {\n      throw new this.FS.ErrnoError(ERRNO_CODES.EPERM);\n    }\n\n    var node = this.FS.createNode(parent, name, mode, dev);\n    if (this.FS.isDir(node.mode)) {\n      node.node_ops = {\n        mknod: this.node_ops.mknod,\n        lookup: this.node_ops.lookup,\n        unlink: this.node_ops.unlink,\n        setattr: this.node_ops.setattr\n      };\n      node.stream_ops = {};\n      node.contents = {};\n    } else if (this.FS.isFile(node.mode)) {\n      node.node_ops = this.node_ops;\n      node.stream_ops = this.stream_ops;\n\n      // Create file!\n      node.contents = this.backend.createFile(name);\n    }\n\n    // add the new node to the parent\n    if (parent) {\n      parent.contents[name] = node;\n      parent.timestamp = node.timestamp;\n    }\n\n    return node;\n  }\n}\n\n\n//# sourceURL=webpack:///../blocked-fs.js?");

/***/ }),

/***/ "./fts/main.js":
/*!*********************!*\
  !*** ./fts/main.js ***!
  \*********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony import */ var ___WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../.. */ \"../index.js\");\n\n\nlet worker;\n\nfunction init() {\n  worker = new Worker(new URL(/* worker import */ __webpack_require__.p + __webpack_require__.u(\"fts_main_worker_js\"), __webpack_require__.b));\n  worker.postMessage({ type: 'ui-invoke', name: 'init' });\n\n  let output = document.querySelector('.output');\n  worker.addEventListener('message', e => {\n    switch (e.data.type) {\n      case 'output': {\n        let el = document.createElement('div');\n        el.innerHTML = e.data.msg;\n        output.append(el);\n        output.scrollTop = 100000;\n        break;\n      }\n      case 'results': {\n        output.innerHTML = '';\n        for (let result of e.data.results) {\n          let el = document.createElement('div');\n          el.innerHTML = `<div style=\"margin-bottom: 5px\"><a href=\"${result.url}\">${result.title}</a></div> ${result.content}`;\n          el.className = 'comment';\n          output.append(el);\n        }\n        break;\n      }\n      case 'count': {\n        document.querySelector('.count').textContent = e.data.count;\n        document.querySelector('#load').textContent = 'Load data';\n      }\n    }\n  });\n\n  document.querySelector('.search').addEventListener('input', e => {\n    worker.postMessage({ type: 'search', name: e.target.value });\n  });\n\n  worker.postMessage({ type: 'ui-invoke', name: 'count' });\n\n  (0,___WEBPACK_IMPORTED_MODULE_0__.supportNestedWorkers)(worker);\n}\n\nlet methods = ['load'];\n\nfor (let method of methods) {\n  let btn = document.querySelector(`#${method}`);\n  if (btn) {\n    btn.addEventListener('click', () => {\n      if(method === 'load') {\n        document.querySelector('#load').textContent = 'Loading...';\n      }\n      worker.postMessage({ type: 'ui-invoke', name: method });\n    });\n  }\n}\n\ninit();\n\n\n//# sourceURL=webpack:///./fts/main.js?");

/***/ }),

/***/ "../index.js":
/*!*******************!*\
  !*** ../index.js ***!
  \*******************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"BlockedFS\": () => (/* binding */ BlockedFS),\n/* harmony export */   \"supportNestedWorkers\": () => (/* binding */ supportNestedWorkers)\n/* harmony export */ });\n/* harmony import */ var _blocked_fs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./blocked-fs */ \"../blocked-fs.js\");\n/* harmony import */ var _indexeddb_start_indexeddb_worker__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./indexeddb/start-indexeddb-worker */ \"../indexeddb/start-indexeddb-worker.js\");\n\n\n\n// Right now we don't support `export from` so we do this manually\n//\n// TODO: This isn't packaged up the best. There will be duplicate code\n// across bundles and we need to separate things better\nconst BlockedFS = _blocked_fs__WEBPACK_IMPORTED_MODULE_0__.default;\nconst supportNestedWorkers = _indexeddb_start_indexeddb_worker__WEBPACK_IMPORTED_MODULE_1__.supportNestedWorkers;\n\n\n//# sourceURL=webpack:///../index.js?");

/***/ }),

/***/ "../indexeddb/start-indexeddb-worker.js":
/*!**********************************************!*\
  !*** ../indexeddb/start-indexeddb-worker.js ***!
  \**********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"startWorker\": () => (/* binding */ startWorker),\n/* harmony export */   \"supportNestedWorkers\": () => (/* binding */ supportNestedWorkers)\n/* harmony export */ });\n/* harmony import */ var _worker_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./worker.js */ \"../indexeddb/worker.js\");\n\n\nlet workerReady = null;\n\nfunction isWorker() {\n  return (\n    typeof WorkerGlobalScope !== 'undefined' &&\n    self instanceof WorkerGlobalScope\n  );\n}\n\nfunction startWorker(argBuffer, resultBuffer) {\n  if (workerReady) {\n    return workerReady;\n  }\n\n  let onReady;\n  workerReady = new Promise(resolve => (onReady = resolve));\n\n  if (typeof Worker === 'undefined') {\n    // No `Worker` available - this context does not support nested\n    // workers sadly. We need to proxy creating a worker to the main\n    // thread.\n    if (!isWorker()) {\n      // We're on the main thread? Weird: it doesn't have workers\n      throw new Error(\n        'Web workers not available, even from the main thread. sqlite3 requires web workers to work.'\n      );\n    }\n\n    self.postMessage({\n      type: 'spawn-idb-worker',\n      argBuffer,\n      resultBuffer\n    });\n\n    self.addEventListener('message', e => {\n      if (e.data.type === 'worker-ready') {\n        onReady();\n      }\n    });\n  } else {\n    let worker = new _worker_js__WEBPACK_IMPORTED_MODULE_0__.default();\n\n    // This is another way to load the worker. It won't be inlined\n    // into the script, which might be better for debugging, but makes\n    // it more difficult to distribute.\n    // let worker = new Worker(new URL('./indexeddb.worker.js', import.meta.url));\n\n    worker.postMessage({ type: 'init', buffers: [argBuffer, resultBuffer] });\n\n    worker.onmessage = msg => {\n      if (msg.data.type === 'worker-ready') {\n        onReady();\n      }\n    };\n\n    return workerReady;\n  }\n}\n\n// This is called from the main thread to setup a proxy for spawning\n// workers. It's necessary for browsers that don't support spawning\n// workers from workers (only Safari).\nfunction supportNestedWorkers(worker) {\n  worker.addEventListener('message', e => {\n    if (e.data.type === 'spawn-idb-worker') {\n      startWorker(e.data.argBuffer, e.data.resultBuffer).then(() => {\n        worker.postMessage({ type: 'worker-ready' });\n      });\n    }\n  });\n}\n\n\n//# sourceURL=webpack:///../indexeddb/start-indexeddb-worker.js?");

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
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
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
/******/ 	/* webpack/runtime/get javascript chunk filename */
/******/ 	(() => {
/******/ 		// This function allow to reference async chunks
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
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		__webpack_require__.b = document.baseURI || self.location.href;
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"main": 0
/******/ 		};
/******/ 		
/******/ 		// no chunk on demand loading
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		// no jsonp function
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = __webpack_require__("./fts/main.js");
/******/ 	
/******/ })()
;