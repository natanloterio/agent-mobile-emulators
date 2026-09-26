import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';

/** Cliente MCP Streamable HTTP com bearer por identidade. `client.tools()` devolve um ToolSet do AI SDK. */
export async function connectMcp(url: string, token: string): Promise<MCPClient> {
  return createMCPClient({
    transport: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
    onUncaughtError: (e) => console.error('[mcp] erro não tratado', e),
  });
}
