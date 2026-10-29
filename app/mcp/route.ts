import {workspaceProviders} from '../../lib/cloud-store.ts';
import {privateMcpApi} from '../../lib/workspace-http.ts';
export const dynamic='force-dynamic';
export function POST(request:Request){return privateMcpApi(request,workspaceProviders);}
export function GET(){return new Response('Pixel Workshop MCP: send an authenticated JSON-RPC request to this endpoint.',{status:405});}
