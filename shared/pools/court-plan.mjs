// Concept dimensions in feet. The recess stays dry at every water depth.
export const COURT_OUTLINE = [[-12,-8],[12,-8],[12,8],[4,8],[4,1],[-5,1],[-5,4],[-12,4]];
export const COURT_FACES = ['back','end','front','inner-right','recess','inner-left','left-front','entry'];

export function courtOutline(inset=0) {
  return COURT_OUTLINE.map(([x,z],i,points)=>{
    const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
    const a=[x-prev[0],z-prev[1]],b=[next[0]-x,next[1]-z];
    const al=Math.hypot(...a),bl=Math.hypot(...b);
    return [x-inset*(a[1]/al+b[1]/bl),z+inset*(a[0]/al+b[0]/bl)];
  });
}
export function courtSegments() {
  return COURT_OUTLINE.map((a,i)=>{
    const b=COURT_OUTLINE[(i+1)%COURT_OUTLINE.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    return {face:COURT_FACES[i],length,mid:[(a[0]+b[0])/2,(a[1]+b[1])/2],inward:[-dz/length,dx/length],rotation:Math.atan2(dz,-dx)};
  });
}
export function planArea(points) {
  return Math.abs(points.reduce((sum,[x,z],i)=>{const next=points[(i+1)%points.length];return sum+x*next[1]-next[0]*z;},0))/2;
}
