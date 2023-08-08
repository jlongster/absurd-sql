module.exports = {
  transformIgnorePatterns: [
    // Change MODULE_NAME_HERE to your module that isn't being compiled
    '/node_modules/(?!perf-deets).+\\.js$',
  ],
  moduleNameMapper: {
    'perf-deets': 'perf-deets/noop',
  },
};
