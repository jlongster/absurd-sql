const ERRNO_CODES = {
  EPERM: 63,
  ENOENT: 44
};

// This implements an emscripten-compatible filesystem that is means
// to be mounted to the one from `sql.js`. Example:
//
// let BFS = new SQLiteFS(SQL.FS, idbBackend);
// SQL.FS.mount(BFS, {}, '/blocked');
//
// Now any files created under '/blocked' will be handled by this
// filesystem, which creates a special file that handles read/writes
// in the way that we want.
export default class SQLiteFS {
  constructor(FS, backend) {
    this.FS = FS;
    this.backend = backend;

    this.node_ops = {
      getattr: node => {
        let fileattr = FS.isFile(node.mode) ? node.contents.getattr() : null;

        let attr = {};
        attr.dev = 1;
        attr.ino = node.id;
        attr.mode = fileattr ? fileattr.mode : node.mode;
        attr.nlink = 1;
        attr.uid = 0;
        attr.gid = 0;
        attr.rdev = node.rdev;
        attr.size = fileattr ? fileattr.size : FS.isDir(node.mode) ? 4096 : 0;
        attr.atime = new Date(0);
        attr.mtime = new Date(0);
        attr.ctime = new Date(0);
        attr.blksize = fileattr ? fileattr.blockSize : 4096;
        attr.blocks = Math.ceil(attr.size / attr.blksize);
        return attr;
      },
      setattr: (node, attr) => {
        if (this.FS.isFile(node.mode)) {
          node.contents.setattr(attr);
        } else {
          if (attr.mode != null) {
            node.mode = attr.mode;
          }
          if (attr.size != null) {
            node.size = attr.size;
          }
        }
      },
      lookup: (parent, name) => {
        throw new this.FS.ErrnoError(ERRNO_CODES.ENOENT);
      },
      mknod: (parent, name, mode, dev) => {
        if (name.endsWith('.lock')) {
          throw new Error('Locking via lockfiles is not supported');
        }

        return this.createNode(parent, name, mode, dev);
      },
      rename: (old_node, new_dir, new_name) => {
        throw new Error('rename not implemented');
      },
      unlink: (parent, name) => {
        let node = this.FS.lookupNode(parent, name);
        node.contents.delete(name);
      },
      readdir: node => {
        // We could list all the available databases here if `node` is
        // the root directory. However Firefox does not implemented
        // such a methods. Other browsers do, but since it's not
        // supported on all browsers users will need to track it
        // separate anyway right now

        throw new Error('readdir not implemented');
      },
      symlink: (parent, newname, oldpath) => {
        throw new Error('symlink not implemented');
      },
      readlink: node => {
        throw new Error('symlink not implemented');
      }
    };

    this.stream_ops = {
      open: stream => {
        if (this.FS.isFile(stream.node.mode)) {
          stream.node.contents.open();
        }
      },

      close: stream => {
        if (this.FS.isFile(stream.node.mode)) {
          stream.node.contents.close();
        }
      },

      read: (stream, buffer, offset, length, position) => {
        // console.log('read', offset, length, position)
        return stream.node.contents.read(buffer, offset, length, position);
      },

      write: (stream, buffer, offset, length, position) => {
        // console.log('write', offset, length, position);
        return stream.node.contents.write(buffer, offset, length, position);
      },

      llseek: (stream, offset, whence) => {
        // Copied from MEMFS
        var position = offset;
        if (whence === 1) {
          position += stream.position;
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            position += stream.node.contents.getattr().size;
          }
        }
        if (position < 0) {
          throw new this.FS.ErrnoError(28);
        }
        return position;
      },
      allocate: (stream, offset, length) => {
        stream.node.contents.setattr({ size: offset + length });
      },
      mmap: (stream, address, length, position, prot, flags) => {
        throw new Error('mmap not implemented');
      },
      msync: (stream, buffer, offset, length, mmapFlags) => {
        throw new Error('msync not implemented');
      },
      fsync: (stream, buffer, offset, length, mmapFlags) => {
        stream.node.contents.fsync();
      }
    };
  }

  mount() {
    return this.createNode(null, '/', 16384 /* dir */ | 511 /* 0777 */, 0);
  }

  lock(path, lockType) {
    let { node } = this.FS.lookupPath(path);
    return node.contents.lock(lockType);
  }

  unlock(path, lockType) {
    let { node } = this.FS.lookupPath(path);
    return node.contents.unlock(lockType);
  }

  createNode(parent, name, mode, dev) {
    // Only files and directories supported
    if (!(this.FS.isDir(mode) || this.FS.isFile(mode))) {
      throw new this.FS.ErrnoError(ERRNO_CODES.EPERM);
    }

    var node = this.FS.createNode(parent, name, mode, dev);
    if (this.FS.isDir(node.mode)) {
      node.node_ops = {
        mknod: this.node_ops.mknod,
        lookup: this.node_ops.lookup,
        unlink: this.node_ops.unlink,
        setattr: this.node_ops.setattr
      };
      node.stream_ops = {};
      node.contents = {};
    } else if (this.FS.isFile(node.mode)) {
      node.node_ops = this.node_ops;
      node.stream_ops = this.stream_ops;

      // Create file!
      node.contents = this.backend.createFile(name);
    }

    // add the new node to the parent
    if (parent) {
      parent.contents[name] = node;
      parent.timestamp = node.timestamp;
    }

    return node;
  }
}
