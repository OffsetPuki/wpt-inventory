import {lazy,Suspense} from 'react';
import {Link,Redirect} from 'wouter';
import {ArrowLeft,ArrowUpRight,Layers3,Table2,Box,PencilRuler} from 'lucide-react';
import Header from '@/components/Header';
import '@/components/design-studio/project-gallery.css';

const FilmTableWorkspace=lazy(()=>import('@/components/design-studio/FilmTableWorkspace'));
const WalnutTableWorkspace=lazy(()=>import('@/components/design-studio/WalnutTableWorkspace'));
const projects=[
  {id:'film-table',title:'Film stretching table',description:'6 × 6 m · PVC film rack · Taped overlaps',detail:'Explore the plant setup and animation, or open the earlier design and drawings.',Icon:Layers3},
  {id:'dallas-table',title:'Dallas table',description:'11′ × 48″ walnut dining table · Bridge frame · 10 seats',detail:'Inspect the frame, individual parts and both tabletop options.',Icon:Table2},
];

export default function DesignStudioPage({project}:{project?:string}){
  // Keep previously shared internal workspace links working.
  if(!project&&new URLSearchParams(window.location.hash.split('?')[1]||'').get('workspace')==='walnut')return <Redirect to="/design-studio/dallas-table" replace/>;
  const active=projects.find(p=>p.id===project);
  if(project&&!active)return <div className="ds-page"><Header title="Project not found" description="Choose an available model from your Design Studio."/><Link className="ds-back" href="/design-studio"><ArrowLeft size={16}/>All projects</Link></div>;
  return <div className="ds-page">
    <Header title="CJM Design Studio" description="Your workspace for inspecting 3D models, parts and dimensions."/>
    {active?<><nav aria-label="Design Studio project" className="ds-breadcrumb"><Link className="ds-back" href="/design-studio"><ArrowLeft size={16}/>All projects</Link><span aria-current="page">{active.title}</span></nav><Suspense fallback={<p role="status">Opening {active.title}…</p>}>{active.id==='film-table'?<FilmTableWorkspace/>:<WalnutTableWorkspace/>}</Suspense></>:
      <section aria-label="Design Studio projects"><div className="ds-project-heading"><h2>Your projects</h2><span>2 projects</span></div><div className="ds-grid">{projects.map(({id,title,description,detail,Icon})=><Link key={id} href={'/design-studio/'+id} className="ds-project" aria-label={'Open '+title}><div className="ds-project-art"><Icon size={66} strokeWidth={1}/><span>3D PROJECT</span><ArrowUpRight className="ds-open-icon" size={24}/></div><div className="ds-project-copy"><h3>{title}</h3><p>{description}</p><div className="ds-project-tools"><span><Box size={15}/>3D model</span><span><PencilRuler size={15}/>Parts &amp; dimensions</span></div><p className="ds-detail">{detail}</p><strong>Open project <ArrowUpRight size={16}/></strong></div></Link>)}</div></section>}
  </div>;
}
