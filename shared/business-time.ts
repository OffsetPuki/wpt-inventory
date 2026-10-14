export const DEFAULT_BUSINESS_TIME_ZONE='America/Chicago';
const formats=new Map<string,Intl.DateTimeFormat>();
export function businessDate(ms:number=Date.now(),timeZone=DEFAULT_BUSINESS_TIME_ZONE):string {
  let format=formats.get(timeZone);
  if(!format){format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});formats.set(timeZone,format);}
  const parts=format.formatToParts(new Date(ms));
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
}
const clocks=new Map<string,Intl.DateTimeFormat>();
/** Convert a business wall-clock time without using the phone's timezone.
 * Reject missing/repeated DST times instead of silently moving an appointment. */
export function businessInstant(date:string,time:string,timeZone=DEFAULT_BUSINESS_TIME_ZONE):number{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Choose a valid business date and time.');
 const target=Date.parse(date+'T'+time+':00Z');
 if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,10)!==date)throw new Error('Choose a valid business date.');
 let clock=clocks.get(timeZone);
 if(!clock){clock=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});clocks.set(timeZone,clock);}
 const wall=(ms:number)=>{const parts=clock!.formatToParts(ms),value=(type:string)=>parts.find(p=>p.type===type)!.value;return Date.parse(`${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}Z`);};
 let instant=target;
 for(let n=0;n<4;n++){const delta=target-wall(instant);if(delta===0)break;instant+=delta;}
 if(wall(instant)!==target)throw new Error('This time does not exist when the clocks change. Choose another time.');
 if([-3600000,-1800000,1800000,3600000].some(offset=>wall(instant+offset)===target))throw new Error('This time occurs twice when the clocks change. Choose an unambiguous time.');
 return instant;
}
