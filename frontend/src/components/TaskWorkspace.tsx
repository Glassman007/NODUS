import {useEffect, useState} from "react";
import {Bell, ClipboardCheck, ArrowRight, LoaderCircle} from "lucide-react";
import type {ProjectScope, WorkspaceRequest} from "../auth/models";
import type {RemediationTask, TaskDetail, TaskNotification} from "../tasks/models";
import {SourceLabel} from "./SourceLabel";

interface Props {
  workspaceId: string; scope: ProjectScope; request: WorkspaceRequest; initialTaskId?: string | null;
  notificationsOnly?: boolean; openInvestigation: (id: string) => void;
}
const label = (value: string) => value.replaceAll("_", " ");

export function TaskWorkspace({workspaceId, scope, request, initialTaskId, notificationsOnly, openInvestigation}: Props) {
  const base = `workspaces/${encodeURIComponent(workspaceId)}`;
  const [tasks,setTasks] = useState<RemediationTask[]>([]);
  const [notifications,setNotifications] = useState<TaskNotification[]>([]);
  const [detail,setDetail] = useState<TaskDetail | null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [project,setProject] = useState("");
  const [team,setTeam] = useState("");
  const [status,setStatus] = useState("");
  const [nextStatus,setNextStatus] = useState("");
  const [assignment,setAssignment] = useState("");
  const [person,setPerson] = useState("");
  const [reason,setReason] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    scope.signal.addEventListener("abort",abort);
    if (scope.signal.aborted) controller.abort();
    Promise.all([
      request<{items:RemediationTask[]}>(`${base}/tasks`,controller.signal),
      request<{items:TaskNotification[]}>(`${base}/notifications`,controller.signal),
      initialTaskId ? request<TaskDetail>(`${base}/tasks/${encodeURIComponent(initialTaskId)}`,controller.signal) : Promise.resolve(null),
    ]).then(([rows,notices,selected]) => {
      if (!controller.signal.aborted) {setTasks(rows.items);setNotifications(notices.items);setDetail(selected);}
    }).catch((cause) => {if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : "Tasks are unavailable.");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>{controller.abort();scope.signal.removeEventListener("abort",abort);};
  },[base,scope,request,initialTaskId]);
  async function select(id: string, notificationId?: string) {
    if(busy || scope.signal.aborted)return;
    setBusy(true);setError("");setDetail(null);
    try {
      if(notificationId){
        await request(`${base}/notifications/${encodeURIComponent(notificationId)}/read`,scope.signal,{});
        if(!scope.signal.aborted)setNotifications(old=>old.map(item=>item.notification_id===notificationId ? {...item,read_at:new Date().toISOString()} : item));
      }
      const value=await request<TaskDetail>(`${base}/tasks/${encodeURIComponent(id)}`,scope.signal);
      if(!scope.signal.aborted){setDetail(value);setNextStatus("");setAssignment("");setPerson("");setReason("");}
    }catch(cause){if(!scope.signal.aborted)setError(cause instanceof Error?cause.message:"Task unavailable.");}
    finally{if(!scope.signal.aborted)setBusy(false);}
  }
  async function update(){
    if(!detail || busy || reason.trim().length<3 || (!nextStatus && !assignment && !person))return;
    setBusy(true);setError("");
    try{
      const task=await request<RemediationTask>(`${base}/tasks/${encodeURIComponent(detail.task.task_id)}/updates`,scope.signal,{
        reason:reason.trim(),...(nextStatus?{status:nextStatus}:{}),...(assignment?{primary_team_id:assignment}:{}),...(person?{assigned_subject:person==="__team__"?"":person}:{}),
      });
      const fresh=await request<TaskDetail>(`${base}/tasks/${encodeURIComponent(task.task_id)}`,scope.signal);
      if(!scope.signal.aborted){setDetail(fresh);setTasks(old=>old.map(item=>item.task_id===task.task_id?task:item));setReason("");setNextStatus("");setAssignment("");setPerson("");}
    }catch(cause){if(!scope.signal.aborted)setError(cause instanceof Error?cause.message:"Task update failed.");}
    finally{if(!scope.signal.aborted)setBusy(false);}
  }
  const filtered=tasks.filter(task=>(!project||task.project_id===project)&&(!team||task.primary_team_id===team)&&(!status||task.status===status));
  const selected=detail?.task;
  return <section className="resolution-workspace">
    <div className="panel-heading"><div><p className="section-kicker">INVESTIGATION TO RESOLUTION</p><h2>{notificationsOnly?"Notifications":"Tasks"}</h2><p className="inline-note">Verified problems, accountable teams and traceable progress.</p></div><ClipboardCheck size={25}/></div>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {(loading||busy)&&<p className="loading-state" role="status"><LoaderCircle size={16} className="spin"/>Loading authorized task information…</p>}
    {!loading&&notificationsOnly&&!selected&&<section className="panel"><h3>Assignment notifications <span className="count-pill">{notifications.filter(item=>!item.read_at).length} unread</span></h3>
      {notifications.length?notifications.map(item=><button className={`notification-item ${item.read_at?"":"unread"}`} key={item.notification_id} onClick={()=>void select(item.task_id,item.notification_id)}>
        <Bell size={18}/><span><strong>{item.title}</strong><small>{item.team_name??"Assignment review"} · {item.priority} · {item.project_id??"Workspace"}</small></span><ArrowRight size={16}/>
      </button>):<p className="inline-note">No authorized assignment notifications.</p>}
    </section>}
    {!loading&&!notificationsOnly&&!selected&&<>
      <div className="task-filters">
        <label>Project<select value={project} onChange={event=>setProject(event.target.value)}><option value="">All authorized projects</option>{[...new Set(tasks.map(task=>task.project_id).filter(Boolean))].map(id=><option key={id} value={id!}>{id}</option>)}</select></label>
        <label>Team<select value={team} onChange={event=>setTeam(event.target.value)}><option value="">All teams</option>{[...new Map(tasks.filter(task=>task.primary_team_id).map(task=>[task.primary_team_id!,task.primary_team_name??task.primary_team_id!])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>Status<select value={status} onChange={event=>setStatus(event.target.value)}><option value="">All statuses</option>{[...new Set(tasks.map(task=>task.status))].map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
      </div>
      <div className="task-grid">{filtered.map(task=><button className="panel task-card" key={task.task_id} onClick={()=>void select(task.task_id)}>
        <div className="task-badges"><span className={`priority-badge priority-${task.priority.toLowerCase()}`}>{task.priority}</span><span className="run-status">{label(task.status)}</span></div>
        <h3>{task.title}</h3><p>{task.description}</p><p className="inline-note">{task.primary_team_name??"Administrator assignment review"} · {task.service_id}</p><small>{task.evidence_ids.length} evidence snapshots · {task.project_id??"Workspace"}</small>
      </button>)}</div>
      {!filtered.length&&<section className="panel empty-state"><ClipboardCheck/><h3>No tasks in this view</h3><p>Only verified actionable findings create remediation work. Dependencies and unverified risks do not create assignments.</p></section>}
    </>}
    {selected&&detail&&<article className="panel task-detail">
      <button className="quiet-button" onClick={()=>setDetail(null)}>Back to {notificationsOnly?"notifications":"tasks"}</button>
      <div className="task-badges"><span className={`priority-badge priority-${selected.priority.toLowerCase()}`}>{selected.priority}</span><span className="run-status">{label(selected.status)}</span></div>
      <h2>{selected.title}</h2><p>{selected.description}</p>
      <div className="task-detail-grid"><section><h3>Required action</h3><p>{selected.required_action}</p><h3>Impact</h3><p>{selected.finding.impact}</p><h3>Acceptance criteria</h3><ul>{selected.acceptance_criteria.map(value=><li key={value}>{value}</li>)}</ul></section>
      <section><h3>Responsibility</h3><p>{selected.primary_team_name??"Administrator review required"}</p><p className="inline-note">{selected.finding.ownership.explanation}</p><p>{selected.assignment_reason}</p><p className="inline-note">Supporting teams: {selected.supporting_team_ids.join(", ")||"None recorded"}<br/>Service: {selected.service_id}<br/>Project: {selected.project_id??"Unspecified"}<br/>Assigned person: {selected.assigned_subject??"Team assignment"}</p><button className="quiet-button" onClick={()=>openInvestigation(selected.investigation_id)}>Open source investigation <ArrowRight size={14}/></button></section></div>
      <h3>Supporting evidence · {detail.evidence.length}</h3>
      {detail.evidence.map(item=><details className="task-evidence" key={item.evidence_id}><summary><SourceLabel id={item.source_id}/> · {item.record_id}</summary><p className="inline-note">{item.kind} · {item.locator}</p><pre>{item.excerpt}</pre></details>)}
      <section className="resolution-progress"><h3>Progress and independent verification</h3><p className="inline-note">Resolved records the team's progress. Verified requires a separate deterministic check against current source evidence. Verification: {label(selected.resolution_verification)}</p>
      {!!detail.allowed_transitions.length&&<form onSubmit={event=>{event.preventDefault();void update();}}>
        <div className="task-filters"><label>Next status<select aria-label="Next task status" value={nextStatus} onChange={event=>setNextStatus(event.target.value)}><option value="">Choose a transition</option>{detail.allowed_transitions.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
        {detail.can_assign&&<><label>Responsible team<select value={assignment} onChange={event=>setAssignment(event.target.value)}><option value="">Keep assignment</option>{(detail.assignment_candidates??selected.finding.ownership.candidate_team_ids.map(id=>({team_id:id,team_name:id}))).map(candidate=><option key={candidate.team_id} value={candidate.team_id}>{candidate.team_name}</option>)}</select></label><label>Assigned team member<select value={person} onChange={event=>setPerson(event.target.value)}><option value="">Keep current assignee</option><option value="__team__">Assign to the team</option>{detail.assignee_candidates?.filter(candidate=>candidate.team_id===(assignment||selected.primary_team_id)).map(candidate=><option key={candidate.subject} value={candidate.subject}>{candidate.name}</option>)}</select></label></>}
        </div><label>Progress note<textarea aria-label="Task progress note" value={reason} onChange={event=>setReason(event.target.value)} maxLength={2000} placeholder="Describe the action taken or why responsibility changed."/></label><button className="primary" disabled={busy||reason.trim().length<3||(!nextStatus&&!assignment&&!person)}>Save task update</button>
      </form>}</section>
      <h3>Task history</h3><ol className="task-history">{detail.history.map((event,index)=><li key={index}><strong>{event.details.to_status?label(event.details.to_status):event.event}</strong><p>{event.details.reason??"Task created from verified problem and ownership evidence."}</p><small>{event.actor} · {new Date(event.occurred_at).toLocaleString()}</small></li>)}</ol>
    </article>}
  </section>;
}
