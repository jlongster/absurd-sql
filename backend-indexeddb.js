export class IndexedDBBackend {
  readChunks(fileName, positions, chunkSize) {
    // TODO:
    // * Sort positions and find contiguous chunks
    // * Run a query for each contiguous chunk
    // * Do all this in another syncify worker!

    // return this.syncWorker.readChunks(fileName, positions, chunkSize);

    return [];
  }

  writeChunks(writes) {
    // Call out to idb (sync!)

    // return this.syncWorker.writeChunks(fileName, positions, chunkSize);

    return [];
  }
}
