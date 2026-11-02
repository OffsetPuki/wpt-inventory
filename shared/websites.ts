export const WEBSITES = [
 {id:'metals',name:'CJM Metals',url:'https://www.cjmmetals.com',service:'/services/custom-gates',defaultActive:true},
 {id:'concrete',name:'CJM Concrete',url:'https://www.cjm-concrete.com',service:'/services/driveways',defaultActive:true},
 {id:'trades',name:'CJM Trades',url:'https://www.cjmtrades.com',service:'/plan',defaultActive:true},
 {id:'insulation',name:'CJM Insulation',url:'https://www.cjminsulation.com',service:'/services/pipe-insulation',defaultActive:false},
] as const;
export type WebsiteId = typeof WEBSITES[number]['id'];
export const websiteById=(id:string)=>WEBSITES.find(site=>site.id===id);
