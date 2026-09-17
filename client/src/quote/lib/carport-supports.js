// Concept layout for a post-and-beam carport, in feet. Twenty-foot bays
// follow the open-column style of structural-steel carports, not the closely
// spaced bows of light-gauge kits. Member sizes/connections remain job-specific.
// Keep the suite copy in sync: its column takeoff must match the preview.
export function carportSupports(s) {
 const W=Number(s.width),D=Number(s.depth),H=Number(s.height);
 const stations=(a,b,max)=>{const n=Math.max(1,Math.ceil((b-a)/max));return Array.from({length:n+1},(_,i)=>a+(b-a)*i/n)};
 const zs=stations(-D/2,D/2,20);
 const parkingBays=W<28?2:3;
 const xs=W<=20?[-W/2,W/2]:Array.from({length:parkingBays+1},(_,i)=>-W/2+W*i/parkingBays);
 const slope=s.roof==='gable'?0:s.roof==='lean-to'?Math.tan((Number(s.elevation)||15)*Math.PI/180):.5/12;
 const posts=[];
 for(const z of zs)for(const x of xs){
  if(s.mounting==='attached'&&z===-D/2)continue;
  const pitch=(Number(s.pitch)||3)/12;
  const gableHead=s.roof==='gable'&&Math.abs(x)===W/2?.25+.2*pitch+.25*Math.sqrt(1+pitch*pitch):0;
  posts.push({x,z,h:H+(D/2-z)*slope+gableHead});
 }
 return {xs,zs,posts};
}
