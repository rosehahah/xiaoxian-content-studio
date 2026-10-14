import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const registry=JSON.parse(readFileSync(new URL('./.agents/skills/xiaoxian-longform/references/platform-profiles.json',import.meta.url),'utf8'));
export const PROFILE_VERSION=registry.reviewedDate;
export function platformProfile(channel){
  const profile=registry.platforms.find(p=>p.id===channel);
  return profile?structuredClone(profile):{id:channel,verifiedDate:null,contentStandards:[],unknowns:['本版未核验此渠道规则，交付前在官方编辑器复核。']};
}
export function profileHash(channel){return createHash('sha256').update(JSON.stringify(platformProfile(channel))).digest('hex');}
export function profileStatus(channel,at=new Date()){
  const profile=platformProfile(channel),checked=profile.verifiedDate?Date.parse(profile.verifiedDate+'T00:00:00Z'):NaN;
  // A local recheck policy, not a claim about platform policy expiry.
  const recheckAfter=Number.isFinite(checked)?new Date(checked+30*86400000).toISOString():null;
  return {profileVersion:PROFILE_VERSION,verifiedDate:profile.verifiedDate,recheckAfter,status:!recheckAfter?'unverified':at.getTime()>Date.parse(recheckAfter)?'needs_recheck':'documentation_checked_account_unverified',mode:'export_only',remoteEnabled:false};
}
