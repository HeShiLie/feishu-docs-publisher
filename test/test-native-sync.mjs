import assert from 'node:assert/strict';
import esbuild from 'esbuild';
await esbuild.build({bundle:true,entryPoints:['src/native-sync.ts'],format:'esm',platform:'node',outfile:'test/.tmp-native-sync.mjs'});
const {syncNativeDocument,nativeTreeHash}=await import('./.tmp-native-sync.mjs');
const text=(id,value)=>({block_id:id,block_type:2,text:{elements:[{text_run:{content:value}}],style:{folded:false}}});
function server(){
 let revision=1,serial=0,stored,convertCount=0,failSave=false;
 const blocks=new Map([['doc',{block_id:'doc',block_type:1,children:[]}]]);
 const tokens=new Map();const calls=[];
 const api=async(method,path,body,params)=>{
  calls.push({method,path,body:structuredClone(body)});
  if(path.endsWith('/convert')){
   convertCount++;
   // The real Markdown conversion is covered by live API tests. This fixture tests transaction semantics.
   const parts=body.content.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
   const out=parts.map((part,i)=>text('temp'+convertCount+'-'+i,part.replace(/\*\*/g,'')));
   return {blocks:out,first_level_block_ids:out.map(b=>b.block_id)};
  }
  if(method==='GET'&&path.endsWith('/documents/doc'))return {document:{revision_id:revision}};
  if(method==='GET'&&path.endsWith('/blocks'))return {items:structuredClone([...blocks.values()]),has_more:false};
  if(path.endsWith('/descendant')){
   if(tokens.has(params.client_token))return tokens.get(params.client_token);
   const ids=new Map(body.descendants.map(b=>[b.block_id,'remote'+(++serial)]));
   for(const old of body.descendants){const b=structuredClone(old);b.block_id=ids.get(old.block_id);if(b.children)b.children=b.children.map(id=>ids.get(id));blocks.set(b.block_id,b);}
   blocks.get('doc').children.splice(body.index,0,...body.children_id.map(id=>ids.get(id)));
   revision++;
   const response={block_id_relations:[...ids].map(([temporary_block_id,block_id])=>({temporary_block_id,block_id}))};tokens.set(params.client_token,response);return response;
  }
  if(method==='DELETE'){
   assert.equal(params.document_revision_id,revision);
   const remove=id=>{for(const c of blocks.get(id)?.children||[])remove(c);blocks.delete(id);};
   blocks.get('doc').children.splice(body.start_index,body.end_index-body.start_index).forEach(remove);
   revision++;return {};
  }
  throw new Error('Unexpected '+method+' '+path);
 };
 const host={api,save:async state=>{if(failSave&&state.pending?.inserted){failSave=false;throw new Error('disk failed');}stored=structuredClone(state);}};
 return {host,blocks,calls,get state(){return structuredClone(stored)},get convertCount(){return convertCount},failNextInsertedSave(){failSave=true;}};
}
const s=server();
const source='Main A\n\n> [!note]- Title\n> Body\n\nMain B';
let state=await syncNativeDocument('doc',source,s.host);
assert.equal(state.units.length,3);
let root=s.blocks.get(state.units[1].id);
assert.equal(root.text.style.folded,true);
assert.equal(root.children.length,1);
assert.equal(root.text.elements[0].text_run.content,'📝 Title');
const ids=state.units.map(u=>u.id);
const writes=()=>s.calls.filter(c=>c.method!=='GET'&&!c.path.endsWith('/convert')).length;
const count=writes();
state=await syncNativeDocument('doc',source,s.host,state);
assert.equal(writes(),count);assert.equal(s.convertCount,1);
root.text.style.folded=false;
state=await syncNativeDocument('doc',source,s.host,state);
assert.equal(writes(),count,'reader fold changes must not trigger a content rewrite');
state=await syncNativeDocument('doc',source.replace('Body','Edited'),s.host,state);
assert.equal(state.units[0].id,ids[0]);assert.equal(state.units[2].id,ids[2]);
assert.notEqual(state.units[1].id,ids[1]);
assert.equal(s.blocks.get(state.units[1].id).text.style.folded,false,'preserve reader fold choices across subtree replacement');
assert.equal(s.blocks.get('doc').children.length,3);
// Conversion-local IDs must not change hashes.
assert.equal(nativeTreeHash('x',new Map([['x',text('x','same')]])),nativeTreeHash('y',new Map([['y',text('y','same')]])));
// A crashed persistence step retries with the same idempotency token, then finishes cleanup.
s.failNextInsertedSave();
await assert.rejects(()=>syncNativeDocument('doc',source.replace('Body','Retry body'),s.host,state),/disk failed/);
assert.ok(s.state.pending);
state=await syncNativeDocument('doc',source.replace('Body','Retry body'),s.host,s.state);
assert.equal(s.blocks.get('doc').children.length,3);assert.equal(state.pending,undefined);
// Remote edits are protected, including edits inside a nested subtree.
const child=s.blocks.get(state.units[1].id).children[0];s.blocks.get(child).text.elements[0].text_run.content='Remote human edit';
const before=writes();
await assert.rejects(()=>syncNativeDocument('doc',source,s.host,state),/飞书正文已被修改/);
assert.equal(writes(),before);
console.log('Native sync transactions and incremental update tests passed');

// Top-level image placeholders may be replaced with different remote IDs by the media uploader.
const media=server();
const placeholder='FEISHU_LARK_LOCAL_IMAGE_'+'a'.repeat(64);
const mediaHost={...media.host,materialize:async()=>{
 const root=media.blocks.get('doc');
 for(let i=0;i<root.children.length;i++){
  const id=root.children[i],block=media.blocks.get(id);
  if(block?.text?.elements?.[0]?.text_run?.content===placeholder){
   media.blocks.delete(id);const replacement='image-'+id;
   media.blocks.set(replacement,{block_id:replacement,block_type:27,image:{token:'image-token'}});
   root.children[i]=replacement;
  }
 }
}};
const mediaState=await syncNativeDocument('doc',placeholder,mediaHost);
assert.equal(media.blocks.get(mediaState.units[0].id).block_type,27);
await syncNativeDocument('doc',placeholder,mediaHost,mediaState);
assert.equal(media.blocks.get('doc').children.length,1);
const untracked=server();untracked.blocks.set('human',text('human','Keep'));untracked.blocks.get('doc').children.push('human');
await assert.rejects(()=>syncNativeDocument('doc',source,{...untracked.host,allowReplaceUntracked:false}),/安全精确模式/);
assert.deepEqual(untracked.blocks.get('doc').children,['human']);
console.log('Native media mapping and safe migration tests passed');
