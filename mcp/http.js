import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './tools.js';

export function localApp() {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.post('/mcp', async (req, res) => {
    const origin = req.get('origin');
    if (origin && origin !== 'http://' + req.get('host')) return res.sendStatus(403);
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.once('close', () => { void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => res.set('Allow', 'POST').sendStatus(405));
  return app;
}
