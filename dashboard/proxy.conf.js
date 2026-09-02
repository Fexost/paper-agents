/** Dev proxy — quiet when Nest API is not running yet. */
module.exports = {
  '/api': {
    target: 'http://localhost:3001',
    secure: false,
    changeOrigin: true,
    logLevel: 'silent',
    configure(proxy) {
      proxy.on('error', (_err, _req, res) => {
        if (res && !res.headersSent && typeof res.writeHead === 'function') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'API offline' }));
        }
      });
    },
  },
};
