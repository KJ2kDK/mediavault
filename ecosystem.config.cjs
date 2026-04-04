module.exports = {
  apps: [{
    name: 'mediavault',
    script: 'server/index.js',
    node_args: '--max-http-header-size=65536',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
  }],
};
