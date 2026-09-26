import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMcp } from '../src/device/mcp.js';

let server: http.Server; let url = ''; const seenAuth: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seenAuth.push(String(req.headers.authorization));
      const msg = JSON.parse(body || '{}') as { id?: number; method?: string };
      const reply = (result: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
      if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } });
      if (msg.method === 'tools/list') return reply({ tools: [{ name: 'android_get_screen_state', description: 'x', inputSchema: { type: 'object', properties: {} } }] });
      res.statusCode = 202; res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
});
afterAll(() => server.close());

describe('connectMcp', () => {
  it('envia bearer e lista tools via Streamable HTTP', async () => {
    const client = await connectMcp(url, 'segredo');
    const tools = await client.tools();
    expect(Object.keys(tools)).toContain('android_get_screen_state');
    expect(seenAuth.every((a) => a === 'Bearer segredo')).toBe(true);
    await client.close();
  });
});

describe.skipIf(!process.env.ENXAME_INTEGRATION)('MCP real', () => {
  it('lista 57 tools do device em 127.0.0.1:8080', async () => {
    const token = process.env.ENXAME_MCP_TOKEN ?? '';
    const client = await connectMcp('http://127.0.0.1:8080/mcp', token);
    expect(Object.keys(await client.tools()).length).toBeGreaterThanOrEqual(50);
    await client.close();
  });
});
