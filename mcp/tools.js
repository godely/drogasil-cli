import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VERSION } from 'drogasil-cli';
import { registerDrogasilTools, shoppingInstructions } from 'drogasil-cli/mcp-tools';
import { retailers } from './retailers.js';

export function createServer() {
  const server = new McpServer({ name: 'drogasil', version: VERSION }, { instructions: shoppingInstructions });
  return registerDrogasilTools(server, z, retailers);
}
