import { get, list, put, BlobPreconditionFailedError } from '@vercel/blob';
import { ProjectService, safeId, type Entry, type ProjectStore } from './project-service.ts';

function requireStorage() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Connect a private Vercel Blob store to this project, then redeploy to enable saving.');
  }
}
const key = (id:string) => `projects/${safeId(id)}.json`;
const blobStore:ProjectStore = {
  async list() {
    requireStorage();
    const result = await list({ prefix:'projects/', limit:100 });
    const items = await Promise.all(result.blobs.map(async blob => {
      const item = await get(blob.pathname, { access:'private', useCache:false });
      return item?.statusCode === 200 ? (await new Response(item.stream).json() as Entry).doc : null;
    }));
    return items.filter((doc):doc is NonNullable<typeof doc> => !!doc)
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async get(id) {
    requireStorage();
    const item = await get(key(id), { access:'private', useCache:false });
    if (!item || item.statusCode !== 200) return null;
    // Encoded GET responses can mark the same object ETag weak; Blob's
    // conditional-write API requires the underlying strong ETag.
    return { entry:await new Response(item.stream).json() as Entry, etag:item.blob.etag.replace(/^W\//,'') };
  },
  async put(id,entry,etag) {
    requireStorage();
    try {
      await put(key(id), JSON.stringify(entry), {
        access:'private', addRandomSuffix:false, contentType:'application/json',
        allowOverwrite:!!etag, ...(etag ? { ifMatch:etag } : {}),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        throw new Error('This project changed. Reload it before applying your edit.');
      }
      throw error;
    }
  },
};
export const projectService = new ProjectService(blobStore);
