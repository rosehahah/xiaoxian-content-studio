import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,validateProject,OVERSEAS_PLATFORMS,contentKey,cardKey,cardsApproved,platformCopyKey} from '../model.mjs';
import {overseasInputKey,importOverseasCopies} from '../overseas-content.mjs';

function project(){
  const p=seedProject();
  p.contentApproval={fingerprint:contentKey(p),at:'2026-10-15T00:00:00.000Z',by:'user'};
  p.cardApproval={fingerprint:cardKey(p),at:'2026-10-15T00:01:00.000Z',by:'user'};
  return p;
}
function input(p){
  return {revision:p.revision,inputFingerprint:overseasInputKey(p),platforms:{
    substack:{title:'Keep a working version',subtitle:'Before your next AI edit',body:'## A checkpoint\n\nKeep the version that works before trying another change.',tags:['AI']},
    x:{title:'Keep a working version',body:'A Git tag marks the commit you want to return to. A release adds context around that version.',tags:[]},
    threads:{title:'A small habit',body:'Before asking AI to change a working project, keep a checkpoint you can return to.',tags:['AI']},
  }};
}

test('legacy projects gain empty overseas fields without rewriting existing content, deliveries or approvals',()=>{
  const p=project();p.platforms.wechat.delivery={status:'draft',mediaId:'real-existing-id'};
  for(const key of OVERSEAS_PLATFORMS)delete p.platforms[key];
  const before=structuredClone(p);
  assert.equal(validateProject(p),p);
  for(const key of Object.keys(before))assert.deepEqual(p[key],key==='platforms'?{...before.platforms,...Object.fromEntries(OVERSEAS_PLATFORMS.map(k=>[k,p.platforms[k]]))}:before[key]);
  for(const key of OVERSEAS_PLATFORMS){assert.equal(p.platforms[key].title,'');assert.equal(p.platforms[key].body,'');assert.deepEqual(p.platforms[key].tags,[]);assert.equal(p.platforms[key].delivery,null);}
  assert.equal(cardsApproved(p),true);
});

test('successful overseas import changes only platform copy and preserves original author approvals',()=>{
  const p=project(),before=structuredClone(p),result=importOverseasCopies(p,input(p));
  assert.equal(result,p);assert.equal(cardsApproved(p),true);
  for(const key of ['content','visual','contentApproval','cardApproval','revision','stage','reviewNote'])assert.deepEqual(p[key],before[key]);
  for(const key of ['wechat','xiaohongshu','douyin'])assert.deepEqual(p.platforms[key],before.platforms[key]);
  assert.equal(p.platforms.substack.subtitle,'Before your next AI edit');
  assert.equal(p.platforms.x.body.includes('Git tag'),true);
});

test('one invalid platform rejects the entire import without partially replacing earlier platforms',()=>{
  const p=project(),request=input(p),before=structuredClone(p);request.platforms.threads.body='';
  assert.throws(()=>importOverseasCopies(p,request),/正文/);assert.deepEqual(p,before);
  const missing=input(p);delete missing.platforms.x;
  assert.throws(()=>importOverseasCopies(p,missing),/完整适配结果/);assert.deepEqual(p,before);
});

test('source content, source copy and selected language independently invalidate stale adaptation results',()=>{
  for(const mutate of [p=>p.content.takeaway+=' A new condition.',p=>p.platforms.wechat.body+=' A newly verified detail.',p=>p.overseasLanguage='zh']){
    const p=project(),request=input(p);mutate(p);const afterEdit=structuredClone(p);
    assert.throws(()=>importOverseasCopies(p,request),/已变化/);assert.deepEqual(p,afterEdit);
  }
});

test('changing one overseas copy invalidates its delivery only and retains unresolved outcome history',()=>{
  const p=project();importOverseasCopies(p,input(p));
  p.platforms.substack.delivery={status:'uncertain',outcome:'unknown',jobId:'unresolved-job'};
  p.platforms.x.delivery={status:'draft',draftId:'123',fingerprint:platformCopyKey(p.platforms.x)};
  p.platforms.threads.delivery={status:'queued_local',deliveryKey:'existing-local-snapshot'};
  const x=structuredClone(p.platforms.x),threads=structuredClone(p.platforms.threads),approval=structuredClone(p.cardApproval);
  const request=input(p);request.platforms.substack.subtitle='A different subtitle';importOverseasCopies(p,request);
  assert.equal(p.platforms.substack.delivery,null);
  assert.deepEqual(p.platforms.substack.history,[{status:'uncertain',outcome:'unknown',jobId:'unresolved-job'}]);
  assert.deepEqual(p.platforms.x,x);assert.deepEqual(p.platforms.threads,threads);assert.deepEqual(p.cardApproval,approval);assert.equal(cardsApproved(p),true);
});

test('reimporting identical copy preserves its successful delivery record without adding history',()=>{
  const p=project();importOverseasCopies(p,input(p));
  for(const key of OVERSEAS_PLATFORMS)p.platforms[key].delivery={status:key==='threads'?'queued_local':'draft',record:key};
  const before=structuredClone(p.platforms);importOverseasCopies(p,input(p));
  assert.deepEqual(p.platforms,before);
});

test('importing overseas prose never creates content or card approvals for unreviewed projects',()=>{
  const p=seedProject();importOverseasCopies(p,input(p));
  assert.equal(p.contentApproval,null);assert.equal(p.cardApproval,null);assert.equal(cardsApproved(p),false);
});
