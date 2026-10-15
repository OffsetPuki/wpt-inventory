import {lazy,Suspense} from 'react';
import {Link,Redirect} from 'wouter';
import {ArrowLeft,ArrowUpRight,Layers3,Table2,Box,PencilRuler} from 'lucide-react';
import Header from '@/components/Header';
import {DesignRegistry,DesignContext} from '@/components/design-studio/DesignRegistry';
import '@/components/design-studio/project-gallery.css';

const FilmTableWorkspace=lazy(()=>import('@/components/design-studio/FilmTableWorkspace'));
const WalnutTableWorkspace=lazy(()=>import('@/components/design-studio/WalnutTableWorkspace'));
const ConcreteWorkspace=lazy(()=>import('@/components/design-studio/concrete/ConcreteWorkspace'));
const projects=[
  {id:'film-table',title:'Film stretching table',description:'6 × 6 m · PVC film rack · Taped overlaps',detail:'Explore the plant setup and animation, or open the earlier design and drawings.',Icon:Layers3},
  {id:'dallas-table',title:'Dallas table',description:'11′ × 48″ walnut dining table · Bridge frame · 10 seats',detail:'Inspect dimensions, confirm cut sizes and track pieces cut.',Icon:Table2},
  {id:'residential-concrete',title:'Residential concrete',description:'Driveway · RV pad · Two walkways · Trash pad',detail:'Select each section, enter feet and inches, and save a live site estimate.',Icon:PencilRuler},
];

export default function DesignStudioPage({project}:{project?:string}){
  // Keep previously shared internal workspace links working.
  if(!project&&new URLSearchParams(window.location.hash.split('?')[1]||'').get('workspace')==='walnut')return <Redirect to="/design-studio/dallas-table" replace/>;
  const active=projects.find(p=>p.id===project);
  if(project&&!active)return <div className="ds-page"><Header title="Project not found" description="Choose an available model from your Design Studio."/><Link className="ds-back" href="/design-studio"><ArrowLeft size={16}/>Projects</Link></div>;
  return <div className="ds-page">
    {active?.id!=='dallas-table'&&<Header title="CJM Design Studio" description="Your workspace for inspecting 3D models, parts and dimensions."/>}
    {active?<><nav aria-label="Design Studio project" className="ds-breadcrumb"><Link className="ds-back" href="/design-studio"><ArrowLeft size={16}/>Projects</Link><span aria-current="page">{active.title}</span></nav><Suspense fallback={<p role="status">Opening {active.title}…</p>}><DesignContext workspace={active.id}>{row=>active.id==='residential-concrete'?<ConcreteWorkspace key={row?.id||'library'} designId={row?.id} designName={row?.name}/>:active.id==='film-table'?<FilmTableWorkspace key={row?.id||'library'} fixedLayout={row?row.model_key==='film-earlier'?'earlier':'plant':undefined}/>:<WalnutTableWorkspace/>}</DesignContext></Suspense></>:
      <section aria-label="Design Studio projects"><DesignRegistry/><div className="ds-project-heading"><h2>Model library</h2><span>{projects.length} workspaces</span></div><div className="ds-grid">{projects.map(({id,title,description,detail,Icon})=><Link key={id} href={'/design-studio/'+id} className="ds-project" aria-label={'Open '+title}><div className="ds-project-art"><Icon size={66} strokeWidth={1}/><span>3D PROJECT</span><ArrowUpRight className="ds-open-icon" size={24}/></div><div className="ds-project-copy"><h3>{title}</h3><p>{description}</p><div className="ds-project-tools"><span><Box size={15}/>3D model</span><span><PencilRuler size={15}/>{id==='residential-concrete'?'Measurements & pricing':'Parts & dimensions'}</span></div><p className="ds-detail">{detail}</p><strong>Open project <ArrowUpRight size={16}/></strong></div></Link>)}</div></section>}
  </div>;
}
