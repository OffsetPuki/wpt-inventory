// CJM starting estimates, not competitors' identical-spec quotations.
// Reviewed 2026-09-19. See docs/carport-pricing.md for basis and assumptions.
export const CARPORT_PACKAGE_RATES = {
  flat:25, gable:25, leanTo:25, minimum:4500, standardHeight:9, targetMargin:30,
  heightPerPostFt:25, sidePerSqFt:10, guttersPerFt:10, slabPerSqFt:8.75,
  footingEach:350, standingSeamPerSqFt:6,
};
export const CARPORT_COST_FIELDS = [
  ['costMaterials','Materials & waste'],['costLabor','Shop & installation labor'],
  ['costEquipment','Equipment'],['costTransport','Transportation'],
  ['costPermits','Permits'],['costEngineering','Engineering'],
  ['costSubcontractors','Subcontractors / concrete'],['costSite','Site work'],
  ['costOverhead','Allocated overhead'],
];
