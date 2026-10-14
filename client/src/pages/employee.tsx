import {L,LanguagePicker,useLanguage} from '@/lib/language';
import {useBusinessDay} from '@/hooks/useBusinessReport';
import {Link,Route,Switch,Redirect,useLocation} from 'wouter';
import {Home,BriefcaseBusiness,Clock3,Bell,UserRound,WifiOff,ArrowRight,MapPin} from 'lucide-react';
import {useAuth} from '@/lib/auth';
import SecurityPage from './security';
import HrLeavePage from './hr/leave';
import {EmployeeCard,employeeButton,dateLabel,useOnline} from '@/components/employee/shared';
import {EmployeeClockProvider,useEmployeeClock,ClockPanel,JobClockAction} from '@/components/employee/clock';
import {EmployeeJobs,EmployeeJob,EmployeeTask} from '@/components/employee/jobs';
import {EmployeeHours} from '@/components/employee/hours';
import {Messages,Me} from '@/components/employee/account';

function Today(){
  const {user}=useAuth(),c=useEmployeeClock();
  const currentJob=c.home.data?.jobs.find((j:any)=>j.id===(c.working?c.segment?.project_id:c.current?c.lastProjectId:null));
  const next=c.home.data?.nextTasks.find((t:any)=>!currentJob||t.project_id===currentJob.id)||c.home.data?.nextTasks[0];
  const upcoming=c.home.data?.jobs.find((j:any)=>!['done','on_hold'].includes(j.status)&&j.id!==currentJob?.id);
  return <div className="space-y-5"><div><p className="text-sm text-muted-foreground">{new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}</p><h1 className="mt-1 text-3xl font-semibold"><L>{"Hi,"}</L> {user?.name.split(' ')[0]}</h1></div><ClockPanel/>
    {currentJob&&<EmployeeCard><p className="text-sm text-muted-foreground"><L>{"Current job"}</L></p><Link href={'/employee/jobs/'+currentJob.id} className="mt-2 flex min-h-12 items-center justify-between gap-3 text-xl font-semibold"><span className="min-w-0 break-words">{currentJob.name}</span><ArrowRight className="shrink-0" size={20}/></Link>{currentJob.site_address&&<a target="_blank" rel="noreferrer" href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(currentJob.site_address)} className={employeeButton+' mt-3 w-full'}><MapPin size={18}/><L>{"Directions"}</L></a>}</EmployeeCard>}
    {next&&<EmployeeCard><h2 className="text-lg font-semibold"><L>{"Your next task"}</L></h2><Link href={'/employee/jobs/'+next.project_id} className="mt-2 inline-flex min-h-12 items-center text-sm underline">{next.project_name}</Link><EmployeeTask task={{...next,assignee_id:user?.id,assignee_name:user?.name}}/></EmployeeCard>}
    {upcoming&&<EmployeeCard><p className="text-sm text-muted-foreground"><L>{currentJob?'Next assignment':'Your next job'}</L></p><Link href={'/employee/jobs/'+upcoming.id} className="mt-2 flex min-h-12 items-center justify-between gap-3 text-xl font-semibold"><span className="min-w-0 break-words">{upcoming.name}</span><ArrowRight className="shrink-0" size={20}/></Link><p className="mt-2 text-sm">{upcoming.start_date?'Starts '+dateLabel(upcoming.start_date):'Schedule to be confirmed'}</p>{upcoming.site_address&&<p className="mt-1 break-words text-sm">{upcoming.site_address}</p>}{!c.current&&<div className="mt-4"><JobClockAction job={upcoming} secondary/></div>}</EmployeeCard>}
    {c.home.data&&!upcoming&&!currentJob&&!next&&<EmployeeCard><h2 className="font-semibold"><L>{"No jobs assigned yet"}</L></h2><p className="mt-2 text-sm"><L>{"Ask the owner for your next assignment. Shop work is available on your clock."}</L></p></EmployeeCard>}
    {!!c.home.data?.setup.length&&<EmployeeCard><details><summary className="min-h-12 cursor-pointer py-3 font-medium"><L>{"The owner needs to finish your payroll setup"}</L></summary><p className="mt-2 text-sm"><L>{"You can keep recording your hours."}</L></p>{c.home.data.setup.map((s:string)=><p key={s} className="mt-2 text-sm">{s}</p>)}</details></EmployeeCard>}
  </div>;
}
function Workspace(){
  useBusinessDay();
  const {t}=useLanguage();
  const [location]=useLocation(),online=useOnline(),{user}=useAuth(),{home}=useEmployeeClock();
  const nav=[{label:'Today',href:'/employee/today',icon:Home},{label:'My jobs',href:'/employee/jobs',icon:BriefcaseBusiness},{label:'My hours',href:'/employee/time',icon:Clock3}];
  return <div className="min-h-screen bg-background text-foreground [overflow-wrap:anywhere]"><a href="#employee-main" className="sr-only focus:not-sr-only"><L>{"Skip to content"}</L></a><header className="border-b border-border bg-card"><div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3"><Link href="/employee/today" className="py-3 text-lg font-bold">CJM <span className="ml-1 text-sm font-normal"><L>{"My work"}</L></span></Link><div className="flex shrink-0 gap-1"><LanguagePicker/><Link href="/employee/messages" aria-label={t('Messages')+(home.data?.unread?', '+home.data.unread+' unread':'')} aria-current={location==='/employee/messages'?'page':undefined} className="relative flex h-12 min-w-12 items-center justify-center rounded-xl border border-border"><Bell size={21}/>{home.data?.unread>0&&<span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-xs leading-5 text-primary-foreground">{Math.min(home.data.unread,99)}</span>}</Link><Link href="/employee/me" aria-label={t("My account")} aria-current={location==='/employee/me'?'page':undefined} className="flex h-12 min-w-12 items-center justify-center gap-2 rounded-xl border border-border px-3"><UserRound size={21}/><span className="hidden max-w-28 truncate text-sm sm:inline">{user?.name}</span></Link></div></div></header>
    {!online&&<div role="status" className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"><WifiOff size={18}/><L>{"Offline · reconnect to save"}</L></div>}
    <main id="employee-main" className="mx-auto min-w-0 max-w-3xl px-4 py-6 pb-32 sm:px-6"><Switch><Route path="/employee/today"><Today/></Route><Route path="/employee/jobs"><EmployeeJobs/></Route><Route path="/employee/jobs/:id">{p=><EmployeeJob key={p.id} jobId={p.id}/>}</Route><Route path="/employee/time"><EmployeeHours/></Route><Route path="/employee/hours"><Redirect to="/employee/time"/></Route><Route path="/employee/messages"><Messages/></Route><Route path="/employee/me"><Me/></Route><Route path="/security"><SecurityPage/></Route><Route path="/hr/leave"><HrLeavePage/></Route><Route path="/project/:id">{p=><Redirect to={'/employee/jobs/'+p.id}/>}</Route><Route path="/pm/time"><Redirect to="/employee/time"/></Route><Route><Redirect to="/employee/today"/></Route></Switch></main>
    <nav aria-label={t("Employee navigation")} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card" style={{paddingBottom:'env(safe-area-inset-bottom)'}}><div className="mx-auto grid max-w-3xl grid-cols-3">{nav.map(n=><Link key={n.href} href={n.href} aria-current={location.startsWith(n.href)?'page':undefined} className={'flex min-h-20 flex-col items-center justify-center gap-1 px-2 text-sm font-semibold '+(location.startsWith(n.href)?'bg-primary/5 text-primary':'text-foreground')}><n.icon size={23}/>{t(n.label)}</Link>)}</div></nav>
  </div>;
}
export default function EmployeeWorkspace(){const {user}=useAuth();return <EmployeeClockProvider key={user?.id}><Workspace/></EmployeeClockProvider>;}
