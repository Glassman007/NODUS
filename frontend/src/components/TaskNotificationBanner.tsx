import {useEffect,useState} from "react";
import {Bell,ArrowRight} from "lucide-react";
import type {ProjectScope,WorkspaceRequest} from "../auth/models";
import type {TaskNotification} from "../tasks/models";
interface Props {workspaceId:string;scope:ProjectScope;request:WorkspaceRequest;}

export function TaskNotificationBanner({workspaceId,scope,request,openTask}:Pick<Props,"workspaceId"|"scope"|"request">&{openTask:(id:string)=>void}){
  const [notice,setNotice]=useState<TaskNotification|null>(null);
  useEffect(()=>{
    let active=true;
    const load=()=>request<{items:TaskNotification[]}>(`workspaces/${encodeURIComponent(workspaceId)}/notifications`,scope.signal)
      .then(data=>{if(active&&!scope.signal.aborted)setNotice(data.items.find(item=>!item.read_at)??null);}).catch(()=>{});
    void load();const timer=setInterval(()=>void load(),30000);
    return()=>{active=false;clearInterval(timer);};
  },[workspaceId,scope,request]);
  return notice?<div className="task-notification-banner" role="status"><Bell size={17}/><span><strong>{notice.team_name?"New team assignment":"Assignment review needed"}</strong> · {notice.title}<small>{notice.team_name??"Administrator review"} · {notice.priority}</small></span><button className="quiet-button" onClick={()=>openTask(notice.task_id)}>View task <ArrowRight size={14}/></button></div>:null;
}
