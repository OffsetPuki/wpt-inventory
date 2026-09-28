const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
export function inchFraction(mm:number):string {
  if(!Number.isFinite(mm))return '—';
  const ticks=Math.round(Math.abs(mm)/25.4*16),whole=Math.floor(ticks/16),numerator=ticks%16,divisor=gcd(numerator,16);
  if(!ticks&&mm!==0)return (mm<0?'-':'')+'<1/16″';
  const value=numerator?`${whole?whole+' ':''}${numerator/divisor}/${16/divisor}`:String(whole);
  return `${mm<0&&ticks?'-':''}${value}″`;
}
export function exactMm(mm:number):string{return Number(mm.toFixed(3)).toLocaleString('en-US',{maximumFractionDigits:3})+' mm';}
export type Unit='fraction'|'inch'|'mm';
export function dimension(mm:number,unit:Unit='fraction'){return unit==='mm'?exactMm(mm):unit==='inch'?Number((mm/25.4).toFixed(4))+'″':inchFraction(mm);}
