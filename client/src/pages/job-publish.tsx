import PublicWorkEditor from '@/components/PublicWorkEditor';
export default function JobPublish({project,onClose}:{project:any;onClose:()=>void}) { return <PublicWorkEditor project={project} onClose={onClose}/>; }
