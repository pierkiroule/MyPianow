// A silent sink; microphone monitoring is never connected to the speakers.
class UsbCapture extends AudioWorkletProcessor {
 constructor(){super();this.active=false;this.parts=[];this.n=0;this.total=0;this.port.onmessage=e=>{if(e.data==='start'){this.active=true;this.n=0;this.total=0;}if(e.data==='stop')this.stop();};}
 flush(){if(!this.n)return;const pcm=this.parts.map(c=>c.slice(0,this.n));this.port.postMessage({pcm},pcm.map(c=>c.buffer));this.n=0;}
 stop(){if(!this.active)return;this.active=false;this.flush();this.port.postMessage({done:true});}
 process(inputs,outputs){outputs[0].forEach(c=>c.fill(0));const a=inputs[0];if(!this.active||!a?.length)return true;if(!this.n)this.parts=a.map(()=>new Float32Array(4096));const n=Math.min(a[0].length,4096-this.n,Math.round(sampleRate*180)-this.total);for(let c=0;c<a.length;c++)this.parts[c].set(a[c].subarray(0,n),this.n);this.n+=n;this.total+=n;if(this.n===4096)this.flush();if(this.total>=Math.round(sampleRate*180)){this.stop();this.port.postMessage({limit:true});}return true;}
}
registerProcessor('usb-capture',UsbCapture);
