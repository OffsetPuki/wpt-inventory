"""Export a verified Open-3D-Table.html model; never infer dimensions from a render."""
from pathlib import Path
import json,re,sys,math,hashlib

source=Path(sys.argv[1])
root=Path(__file__).resolve().parents[1]
content=source.read_bytes()
models=json.loads(re.search(r'const MODELS=(.*);\r?\nconst EXPORTS=',content.decode('utf8')).group(1))
revision=hashlib.sha256(content).hexdigest()[:12]
variants={}
for key,model in models.items():
    meshes=[m for m in model['meshes'] if m['group']!='chair']
    parts=[]
    for i,m in enumerate(meshes,1):
        pts=[[m['p'][j]+66,-m['p'][j+2],m['p'][j+1]] for j in range(0,len(m['p']),3)]
        lo=[min(p[k] for p in pts) for k in range(3)]
        hi=[max(p[k] for p in pts) for k in range(3)]
        bounds=[hi[k]-lo[k] for k in range(3)]
        measurements=[];notes=[];n=m['name'];category='Tubing';quantity=1
        def dim(label,value):measurements.append({'label':label,'inches':value})
        if 'stock' in m:
            stock=m['stock'];material='Carbon steel';section=stock['outsideIn'];wall=stock['nominalWallIn']
            dim('Tube outside face',section[0]);dim('Tube outside depth',section[1]);dim('Nominal tube wall',wall)
            stockLabel=f'{section[0]} × {section[1]} × ⅛″ rectangular tube'
        else:
            material='Bearing material — to be selected' if m['material']==3 else ('Walnut' if m['group']=='top' else 'Carbon steel plate')
            stockLabel=material
        if 'angled leg' in n:
            category='Legs';name='Angled leg'
            sign=1 if (lo[1]+hi[1])>0 else -1
            angle=math.radians(model['legAngle'])
            axial=[p[1]*sign*math.sin(angle)+p[2]*math.cos(angle) for p in pts]
            dim('Vertical rise',bounds[2]);dim('Centerline length',model['legCenterLength']);dim('Axial long-point span',max(axial)-min(axial))
            notes=['15° from vertical; horizontal top and bottom ends.','Bottom outside corner aligns with the bridge-to-foot seam.','Centerline and axial envelope are model dimensions, not a released saw-cut length.']
        elif 'outward foot' in n:
            category='Feet & bridges';name='Flush-cut outward foot'
            dim('Horizontal reach from miter center',7);dim('Floor contact length',model['footProfile']['soleContactLength']);dim('Sole closure thickness',.1875)
            notes=[f'Parent tube slopes {model["footProfile"]["slopeDegrees"]:.3f}° from horizontal.','Floor cut is at height 0. Vertical toe lip is removed.','Includes one shaped 3/16-inch sole closure; it is integrated in this mesh.','Floor contact rectangle: 4 × 4.948 inches. Tip finishing and weld allowances require shop detailing.']
        elif n.startswith('Trestle') and 'raised bridge' in n:
            category='Feet & bridges';name='Raised lower bridge'
            dim('Between miter centers',22);dim('Upper edge span',bounds[1]);dim('Bridge top above floor',3);dim('Bridge bottom above floor',1)
            notes=[f'Bridge/foot joint angle: {model["footProfile"]["slopeDegrees"]/2:.3f}° from square in the end-view plane.','Leg outside corners meet the upper ends of this tube.']
        elif 'continuous top header' in n and not n.startswith('Bearing strip'):
            name='Top trestle header';dim('Tube length',bounds[1]);notes=['Tube is laid flat: 4 inches along table length × 2 inches high.','Includes two 1/8-inch end caps; nominal 4 × 2-inch outside profile.']
        elif n.startswith('Low center'):
            name='Lower center stretcher';dim('Tube length between bridges',bounds[0]);notes=['4 inches wide × 2 inches high. Top is 3 inches above floor.']
        elif n.startswith('Upper longitudinal'):
            name='Long upper rail';dim('Tube length',bounds[0]);notes=['Upright: 4 inches high × 2 inches wide.','15-inch clear gap between the two rails.','Includes two 1/8-inch end caps; nominal 2 × 4-inch outside profile.']
        elif n.startswith('Shallow crossbar'):
            name='Shallow crossbar segment';dim('Segment length',bounds[1]);notes=['4 inches along table length × 1 inch high.','Three segments form each crossbar: 11.5 + 15 + 11.5 inches, with rails between them.']
            if abs(bounds[1]-11.5)<1e-6:notes.append('Includes one outer 1/8-inch end cap; nominal 4 × 1-inch outside profile.')
        elif 'gusset' in n:
            category='Plates & mounts';name='Upper joint gusset';dim('Plate thickness',.25);dim('Depth at leg',4);dim('Depth at rail',2)
            notes=['Diagonal plate connects the leg, header underside and rail end face.','Width/length/height below are assembly-axis envelopes, not a flat cutting blank.','Final plate profile, welds and tolerances require fabrication review.']
        elif 'slotted mounting' in n:
            category='Plates & mounts';name='Slotted mounting tab';dim('Plate thickness',.25);dim('Slot overall length',1.25);dim('Slot width',.375);dim('Slot center from each plate edge',1)
            notes=['2 × 2-inch plate. Capsule slot runs across tabletop grain (table-width direction).','Fastener and washer selection must allow seasonal wood movement.']
        elif 'datum mounting' in n:
            category='Plates & mounts';name='Center datum mounting tab';dim('Plate thickness',.25);dim('Round hole diameter',.375);dim('Hole center from each edge',1)
            notes=['2 × 2-inch plate with centered round hole.','One datum point; remaining tabs allow cross-grain movement.']
        elif n.startswith('Bearing strip'):
            category='Bearing strips';name='Top bearing strip';dim('Bearing thickness',.125)
            notes=['Bearing material is not steel; final material and fastening arrangement remain to be selected.','The bearing layer is included in the 30-inch finished table height.']
        else:
            category='Tabletop';name='Walnut tabletop';dim('Top thickness',int(key));notes=[f'User-supplied top weight: {418 if key=="3" else 280} lb.','Rectangular envelope; live edge and grain are illustrative.']
        if 'Trestle 1' in n:location='Near-end trestle'
        elif 'Trestle 2' in n:location='Far-end trestle'
        else:location='Frame / tabletop'
        parts.append({'id':f'WT-{i:03d}','name':name,'sourceName':n,'category':category,'quantity':quantity,'location':location,'material':material,'stock':stockLabel,'bounds':bounds,'min':lo,'max':hi,'measurements':measurements,'notes':notes,'p':m['p'],'n':m['n'],'e':m['e'],'materialIndex':m['material'],'group':m['group']})
    assert len(parts)==53
    assert len([p for p in parts if p['name']=='Angled leg'])==4
    variants[key]={'topThickness':int(key),'table':[132,48,30],'frame':[104,42,model['tubeTop']],'supportHeight':model['supportHeight'],'parts':parts,'assemblyDimensions':[
        {'label':'Top length','inches':132},{'label':'Top width','inches':48},{'label':'Finished table height','inches':30},
        {'label':'Steel top above floor','inches':model['tubeTop']},{'label':'Top bearing surface above floor','inches':model['supportHeight']},
        {'label':'Frame overall length','inches':104},{'label':'Upper frame overall width','inches':42},
        {'label':'End setback to nearest assembly face','inches':14},{'label':'Trestle center spacing','inches':100},
        {'label':'Feet span','inches':36},{'label':'Bridge top above floor','inches':3},{'label':'Bridge underside above floor','inches':1},
        {'label':'Upper rail clear gap','inches':15},{'label':'Upper rail center spacing','inches':17},
        {'label':'Upper rail outside face to side edge','inches':14.5},
        {'label':'Leg bottom center spacing','inches':model['legBasePlacement']['bottomCenterSpacingIn']},
        {'label':'Leg top center spacing','inches':model['legTopCenters']},
        {'label':'Side knee clear height (defined seating zones)','inches':model['sideKneeClearance']},
        {'label':'Side and end knee depth (defined seating zones)','inches':14}],
        'integratedDetails':[
            {'name':'Header end cap','quantity':4,'profile':[4,2,.125],'note':'Included in the two top-header meshes; dimensions are nominal outside profiles.'},
            {'name':'Upper rail end cap','quantity':4,'profile':[2,4,.125],'note':'Included in the two long-rail meshes; dimensions are nominal outside profiles.'},
            {'name':'Outer crossbar end cap','quantity':6,'profile':[4,1,.125],'note':'Included in the six outer crossbar-segment meshes.'},
            {'name':'Foot sole closure','quantity':4,'profile':[4,model['footProfile']['soleContactLength'],.1875],'note':'Included in the four foot meshes; shaped at the tapered tip. Footprint and nominal plate thickness shown, not a finished cutting blank.'}]
    }
data={'schemaVersion':1,'revision':revision,'modelRevision':models['3']['revision'],'sourceSha256':hashlib.sha256(content).hexdigest(),'units':'inches','variants':variants,'notes':[
    'Dimensions come from the current modeled geometry. They are not a released fabrication cut list or a load rating.',
    'Nominal sharp-corner tube sections: 4 × 2 × 1/8 inch and 4 × 1 × 1/8 inch. Supplier radii, welds and tolerances are not modeled.',
    '52 frame components plus the walnut top are individually selectable. 14 end caps and 4 sole closures are integrated into tube meshes and listed separately as details.',
    'Assembly coordinates: X from one short tabletop end (0–132), Y across width from center (−24 to +24), Z above floor.',
    'The 3-inch and 2-inch tops use different frame heights. Selecting a top updates every part and measurement.'
]}
target=root/'server/design-studio/walnut-table/model.json'
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
print(json.dumps({'revision':revision,'partsPerVariant':len(parts),'bytes':target.stat().st_size}))
