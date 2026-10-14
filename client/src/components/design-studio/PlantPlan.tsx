export default function PlantPlan(){
 return <section aria-label="Plant layout drawing" className="rounded-xl border bg-white p-4 text-slate-900"><h3 className="text-lg font-semibold">Plant layout · top view</h3><p className="mb-4 text-sm text-slate-600">Lightweight reference drawing. Layout only; not a cutting or drilling plan.</p>
  <svg viewBox="0 0 700 700" role="img" aria-labelledby="plant-plan-title plant-plan-desc" className="mx-auto w-full max-w-2xl">
   <title id="plant-plan-title">Six metre table, staggered film rolls and rear tape pipe</title><desc id="plant-plan-desc">Six rolls alternate across the first two PVC pipes. Five tape rolls on the last pipe feed behind the film overlaps. Four staggered top wheels guide the moving bar, with separate edge guides. Component sizes are unmeasured.</desc>
   <defs><pattern id="plant-plan-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#d5ddd9" strokeWidth=".5"/></pattern></defs>
   <rect x="80" y="40" width="540" height="400" fill="#edf2ee" stroke="#47675e" strokeWidth="2"/><rect x="80" y="40" width="540" height="400" fill="url(#plant-plan-grid)"/>
   <text x="350" y="100" textAnchor="middle" fontSize="22" fill="#244a40">Work table · 6 × 6 m</text><text x="350" y="128" textAnchor="middle" fontSize="16" fill="#47675e">Confirmed overall size · schematic proportions</text>
   {[170,260,350,440,530].map(x=><path key={x} d={`M${x} 554V230`} stroke="#bb8110" strokeWidth="8" opacity=".7"/>)}
   <rect x="70" y="218" width="560" height="15" rx="3" fill="#b8c8c3" stroke="#47675e"/>
   {[165,285,405,525].map((x,i)=><g key={x}><path d={`M${x} 225v${i%2?32:-32}`} stroke="#91a59f" strokeWidth="9"/><circle cx={x} cy={i%2?257:193} r="8" fill="#253b35"/></g>)}
   <circle cx="80" cy="225" r="8" fill="#253b35"/><circle cx="620" cy="225" r="8" fill="#253b35"/>
   <text x="350" y="310" textAnchor="middle" fontSize="16" fill="#244a40">Moving bar · 4 staggered top wheels</text><text x="350" y="334" textAnchor="middle" fontSize="16" fill="#244a40">Separate guides at the edges</text>
   {[480,520,560].map(y=><rect key={y} x="55" y={y} width="590" height="10" rx="5" fill="#e4e9e7" stroke="#47675e"/>)}
   {[0,1,2,3,4,5].map(i=><rect key={i} x={85+i*90} y={i%2?506:466} width="100" height="36" rx="8" fill="#f8f6eb" stroke="#6c8079"/>)}
   {[170,260,350,440,530].map(x=><rect key={x} x={x-7} y="546" width="14" height="30" rx="4" fill="#bf8a23" stroke="#77571a"/>)}
   <text x="350" y="610" textAnchor="middle" fontSize="16" fill="#244a40">Pipes 1–2: staggered film rolls</text><text x="350" y="638" textAnchor="middle" fontSize="16" fill="#244a40">Last PVC pipe: tape behind every film overlap</text>
  </svg><ul className="my-4 list-disc space-y-2 pl-5 text-sm"><li>Table: 6 × 6 metres.</li><li>Moving bar: four top wheels in a zigzag, plus separate edge guides.</li><li>First two PVC pipes: six staggered film rolls.</li><li>Last PVC pipe: tape feeds behind all five overlaps.</li></ul><p className="rounded-lg bg-amber-50 p-3 text-sm">Hole positions, radii, stock sections, cut lengths and tolerances still need field measurements. Do not measure from this drawing.</p>
 </section>;
}
