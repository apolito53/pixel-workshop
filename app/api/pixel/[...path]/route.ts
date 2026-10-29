import {workspaceProviders} from '../../../../lib/cloud-store.ts';
import {privatePixelApi} from '../../../../lib/workspace-http.ts';
export const dynamic='force-dynamic';
export function GET(request:Request){return privatePixelApi(request,workspaceProviders);}
export function POST(request:Request){return privatePixelApi(request,workspaceProviders);}
