import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {ImageAppService} from '../src/media/image-app.js';
import {createCanvasServer} from '../src/server.js';
it('raw patches cannot inject editable documents and missing cloud storage never pretends to save',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'edit-readonly-'));const api=createCanvasServer({dataRoot:root});await api.ready;
 try{const project=api.registry.create({name:'Edit',teamId:'local',createdBy:'local'});
 await expect(api.canvas.patch(project.id,{workbenchImageEdits:{injected:{path:'elsewhere'}}})).rejects.toMatchObject({status:403});
 const snapshot=await api.canvas.read(project.id);
 await expect(new ImageAppService(api.canvas,api.media).action(project.id,'image.edit.save',{},snapshot.revision,'save')).rejects.toBeDefined();
 }finally{await api.close();await rm(root,{recursive:true,force:true});}
});
