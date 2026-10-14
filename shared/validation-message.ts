const labels:Record<string,string>={quoteId:'Accepted quote',clientId:'Customer',projectId:'Job',dueDate:'Finish date',startDate:'Start date',siteAddress:'Job address',billingMode:'Billing',scheduleState:'Schedule',preferredLanguage:'Language',overrideReason:'Exception reason',email:'Email',name:'Name',title:'Title',amountCents:'Amount',quantity:'Quantity',version:'Record version'};
type Issue={path?:unknown[];message?:string;code?:string};
export function readableValidation(value:unknown):{message:string;fields:string[]}|null{
 let issues:unknown=value;
 if(typeof value==='string'){try{issues=JSON.parse(value);}catch{return null;}}
 if(!Array.isArray(issues)||!issues.length||!issues.every(i=>i&&typeof i==='object'&&Array.isArray(i.path)&&typeof i.message==='string'))return null;
 const fields:string[]=[];
 const messages=issues.slice(0,8).map((i:Issue)=>{const field=String(i.path?.[0]||'');if(field)fields.push(field);const label=labels[field]||field.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ')||'This field';const message=i.message==='Required'?'is required.':i.message?.replace('Expected number, received nan','Enter a valid number.');return `${label.charAt(0).toUpperCase()+label.slice(1)}: ${message}`;});
 return {message:messages.join('\n'),fields:[...new Set(fields)]};
}
