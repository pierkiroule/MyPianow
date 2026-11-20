import { it, expect } from 'vitest';
import { Piano } from './piano';
import { PROPERTIES, type Property } from './protocol';
function encoded(text: string) { const bytes: number[]=[]; for(let i=0;i<text.length;i+=7) bytes.push(0,...Array.from(text.slice(i,i+7),c=>c.charCodeAt(0))); return bytes; }
it('identifies before writing, confirms native changes, and restores original values',async()=>{
 const settings={effect:[0,2,24],depth:[8]},initial=structuredClone(settings),sent:number[][]=[];const storage=new Map<string,string>();
 const input={id:'in',state:'connected',onmidimessage:null as ((e:{data:Uint8Array})=>void)|null,open:async()=>{},close:async()=>{}};
 const output={id:'out',state:'connected',open:async()=>{},close:async()=>{},send:(frame:number[])=>{sent.push(frame);const key=(Object.keys(PROPERTIES) as Property[]).find(k=>PROPERTIES[k].every((n,i)=>frame[9+i]===n))!;if(frame[8]===1){if(key==='effect'||key==='depth')settings[key]=frame.slice(18,-1);return;}const bytes=key==='model'?encoded('CLP-825'):key==='firmware'?encoded('1.02'):settings[key as 'effect'|'depth'];queueMicrotask(()=>input.onmidimessage?.({data:new Uint8Array([240,67,115,1,82,37,38,0,0,...PROPERTIES[key],0,1,0,0,bytes.length,...bytes,247])}));}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{requestMIDIAccess:async()=>({sysexEnabled:true,inputs:new Map([['in',input]]),outputs:new Map([['out',output]])})}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)}});
 const piano=new Piano();await piano.apply(260,20);expect(sent).toHaveLength(0);await piano.authorize();await piano.connect('in','out');expect(piano.state.ready).toBe(true);expect(sent.every(f=>f[8]===0)).toBe(true);await piano.apply(260,20);expect(settings.effect).toEqual([0,2,4]);expect(settings.depth).toEqual([20]);expect(piano.state.dirty).toBe(true);await piano.restore();expect(settings).toEqual(initial);expect(piano.state.dirty).toBe(false);
});
