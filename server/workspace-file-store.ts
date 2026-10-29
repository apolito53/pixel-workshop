import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileStore} from './file-store.ts';
import {ProjectService} from '../lib/project-service.ts';
import {requireWorkspaceId,type WorkspaceRecord,type WorkspaceRecordStore} from '../lib/workspace-session.ts';
import type {WorkspaceProviders} from '../lib/workspace-http.ts';

const root=resolve(process.env.PIXEL_DATA_DIR||'./pixel-data');
const workspaceDir=(id:string)=>join(root,'workspaces',requireWorkspaceId(id));
const records:WorkspaceRecordStore={
  async get(id){
    try{return JSON.parse(await readFile(join(workspaceDir(id),'metadata.json'),'utf8')) as WorkspaceRecord;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  },
  async create(record){
    const directory=workspaceDir(record.id);
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'metadata.json'),JSON.stringify(record),{flag:'wx',mode:0o600});
  },
};
export const workspaceProviders:WorkspaceProviders={
  records,
  projects:(id)=>new ProjectService(fileStore(join(workspaceDir(id),'projects'))),
};
