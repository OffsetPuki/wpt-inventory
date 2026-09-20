export const BUSINESSES = {metals:'CJM Metals',concrete:'CJM Concrete',insulation:'CJM Insulation',trades:'CJM Trades'};
export function quoteBusiness(session) {
  return BUSINESSES[session?.business] ? session.business : session?.type==='concrete'?'concrete':session?.type==='insulation'?'insulation':'metals';
}
export function businessShop(shop,site) {
  const {businesses,...base}=shop||{};
  return {...base,...(site!=='metals'?{name:BUSINESSES[site]||base.name}:{}),...businesses?.[site]};
}
