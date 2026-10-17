const path = require('path');
const dotenv = require('dotenv');

const repoRoot = __dirname;
dotenv.config({ path: path.join(repoRoot, '.env.local'), quiet: true });
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const assistantProxy = (endpoint) => ({
  target: 'https://api.cloudflare.com',
  changeOrigin: true,
  secure: true,
  rewrite: () => `/client/v4/accounts/${encodeURIComponent(accountId || '')}${endpoint}`,
  headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq, req, res) => {
      const origin = req.headers.origin || '';
      if (!allowedOrigin.test(origin) || !accountId || !apiToken) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Assistant proxy is not configured.' }));
        proxyReq.destroy();
        return;
      }
    });
  },
});

module.exports = {
  '/api/assistant/chat': assistantProxy('/ai/v1/chat/completions'),
  '/api/assistant/transcribe': assistantProxy(
    '/ai/run/@cf/openai/whisper-large-v3-turbo',
  ),
};
