import {useEffect,useState} from "react";
import {ArrowRight,UsersRound,ClipboardCheck} from "lucide-react";
import type {SessionRun} from "../investigations/api";
import type {ProjectScope,WorkspaceRequest} from "../auth/models";
import type {RemediationTask} from "../tasks/models";
import {entityName} from "../investigations/presentation";
export function OwnershipActions({run,scope,request,openTask}: {
  run:SessionRun;scope:ProjectScope;request:WorkspaceRequest;openTask?:(id:string)=>void;
}) {
  const [tasks,setTasks]=useState<RemediationTask[]>([]);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    request<{items:RemediationTask[]}>(`workspaces/${encodeURIComponent(run.workspaceId)}/tasks`,scope.signal)
      .then(data=>{if(active&&!scope.signal.aborted)setTasks(data.items);})
      .catch(cause=>{if(active&&!scope.signal.aborted)setError(cause instanceof Error?cause.message:"Task status unavailable.");});
    return()=>{active=false;};
  },[run,scope,request]);
  const problems=run.actionable_findings??[];
  return <section className="ownership-actions">
    <div className="panel-heading"><div><h3>Ownership &amp; Actions</h3><p className="inline-note">Evidence connects a verified problem to the team responsible for resolving it.</p></div><UsersRound size={24}/></div>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {!problems.length&&<div className="resolution-empty"><ClipboardCheck size={22}/><div><strong>No verified actionable problem was established</strong><p>Review the proposed change against the cited contract and ownership records before assigning remediation work.</p></div></div>}
    {problems.map(problem=>{
      const task=tasks.find(item=>item.task_id===problem.task_id||item.finding.problem_id===problem.problem_id);
      return <article className="resolution-finding" key={problem.problem_id}>
        <div className="task-badges"><span className={`priority-badge priority-${problem.severity.toLowerCase()}`}>{problem.severity}</span><span className="evidence-badge verification-supported">{problem.verification_status}</span></div>
        <h3>{problem.title}</h3><p>{problem.description}</p>
        <div className="task-detail-grid"><section><h4>Why it matters</h4><p>{problem.impact}</p><h4>Required action</h4><p>{problem.recommended_action}</p></section><section><h4>Responsible team</h4><p>{task?.primary_team_name??problem.ownership.primary_team_name??"Administrator assignment review"}</p><p className="inline-note">{task?.finding.ownership.explanation??problem.ownership.explanation}</p><p className="inline-note">Problem evidence: {problem.evidence_ids.length} snapshots · Ownership evidence: {task?.finding.ownership.evidence_ids.length??problem.ownership.evidence_ids.length} snapshots</p></section></div>
        {task?<button className="primary" onClick={()=>openTask?.(task.task_id)}>Open task · {task.status.replaceAll("_"," ")} <ArrowRight size={14}/></button>:<p className="inline-note">{problem.task_id?"Task details are unavailable under current access.":"No task created. Assignment requires an authorized administrator and current supporting evidence."}</p>}
      </article>;
    })}
    {!!run.ownership_decisions?.length&&<><h3>Ownership observed during investigation</h3><div className="ownership-grid">{run.ownership_decisions.map(owner=><article className="ownership-card" key={owner.service_id}>
      <span className={`evidence-badge ${owner.status==="VERIFIED"?"verification-supported":"verification-unverified"}`}>{owner.status==="VERIFIED"?"Direct service owner":"Review required"}</span><h4 title={owner.service_id}>{entityName({id:owner.service_id,name:owner.service_name===owner.service_id?null:owner.service_name})}</h4><p>{owner.primary_team_name??"No unique responsible team in scope"}</p><p className="inline-note">{owner.explanation}</p><small>{owner.evidence_ids.length} ownership evidence snapshots</small>
    </article>)}</div></>}
  </section>;
}
