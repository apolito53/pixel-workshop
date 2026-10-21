import { projectService } from '../../../../lib/cloud-store.ts';
import { pixelApi } from '../../../../lib/http-api.ts';
export const dynamic='force-dynamic';
export function GET(request:Request){return pixelApi(request,projectService);}
export function POST(request:Request){return pixelApi(request,projectService);}
