import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,contentKey,cardKey,contentApproved,cardsApproved,invalidateContent,invalidateVisual,validateContent,validatePlatform,count} from '../model.mjs';
function approved(){const p=seedProject();p.contentApproval={fingerprint:contentKey(p)};p.cardApproval={fingerprint:cardKey(p)};return p;}
test('文字修改撤销所有确认，但保留旧草稿记录',()=>{const p=approved();p.platforms.wechat.delivery={mediaId:'old'};p.content.cards[0].title='新标题';assert.equal(cardsApproved(p),false);invalidateContent(p);assert.equal(contentApproved(p),false);assert.equal(p.platforms.wechat.delivery,null);assert.equal(p.platforms.wechat.history[0].mediaId,'old');});
test('视觉修改只撤销图卡审核，平台配文不改变核心图卡',()=>{const p=approved();p.visual.theme='rose';invalidateVisual(p);assert.equal(contentApproved(p),true);assert.equal(cardsApproved(p),false);const original=cardKey(p);p.platforms.wechat.body='另一份平台配文';assert.equal(cardKey(p),original);});
test('超过平台标题、字数或话题上限会被阻止',()=>{const p=seedProject();p.platforms.wechat.title='文'.repeat(21);p.platforms.wechat.tags=Array.from({length:11},(_,i)=>'话题'+i);p.platforms.wechat.body='文'.repeat(1000);assert.equal(validatePlatform(p,'wechat').errors.length,3);p.platforms.douyin.tags=Array.from({length:6},(_,i)=>'话题'+i);assert.ok(validatePlatform(p,'douyin').errors.includes('话题超过 5 个'));});
test('字符计数按可见字符计数，默认图卡满足简洁规范',()=>{assert.equal(count('苋🌱'),2);assert.deepEqual(validateContent(seedProject()),[]);for(const key of ['wechat','xiaohongshu','douyin'])assert.deepEqual(validatePlatform(seedProject(),key).errors,[]);});
