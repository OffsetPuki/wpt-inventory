export const portfolioServices: Record<string, Record<string, string>> = {
  metals: {'carports':'Carports','custom-gates':'Custom gates','automated-gates':'Automatic gates','gate-installation':'Gate installation','fences':'Fences','metal-furniture':'Table frames and furniture','railings':'Railings','pergolas':'Pergolas','security-doors':'Security doors','custom-metal-work':'Custom metal work','commercial-metal-work':'Commercial metal work'},
  concrete: {'concrete-driveways':'Driveways','concrete-patios':'Patios','concrete-slabs':'Slabs','stamped-concrete':'Stamped concrete','sidewalks-walkways':'Sidewalks and walkways','concrete-repair':'Repairs','retaining-walls':'Retaining walls'},
  insulation: {'pipe-insulation':'Pipe insulation','tank-and-vessel-insulation':'Tanks and vessels','removable-insulation-blankets':'Removable blankets','metal-jacketing':'Metal jacketing','autoclave-insulation':'Autoclaves','cold-and-chilled-insulation':'Cold and chilled lines','insulation-removal-reinsulation':'Removal and re-insulation'},
  trades: {},
};
export const portfolioDomains: Record<string,string> = {metals:'https://www.cjmmetals.com',concrete:'https://www.cjm-concrete.com',insulation:'https://www.cjminsulation.com',trades:'https://www.cjmtrades.com'};
export function projectReadiness(p: {city?:string;scope?:string;materials?:string;workType?:string;serviceSlug?:string;site?:string}) {
  const missing: string[] = [];
  if(p.workType !== 'completed') missing.push('completed work');
  if(!p.city?.trim()) missing.push('city');
  if(!p.scope?.trim()) missing.push('work performed');
  if(!p.materials?.trim()) missing.push('materials and details');
  if(!portfolioServices[p.site||'']?.[p.serviceSlug||'']) missing.push('matching service');
  return missing;
}
