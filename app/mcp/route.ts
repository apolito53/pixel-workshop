import { cloudService } from '../../lib/cloud-store.ts';
import { mcpResponse } from '../../lib/mcp-tools.ts';
export const dynamic='force-dynamic';
export function POST(request:Request){return mcpResponse(request,cloudService);}
export function GET(){return new Response('Pixel Workshop MCP: send JSON-RPC to this endpoint.',{status:405});}
