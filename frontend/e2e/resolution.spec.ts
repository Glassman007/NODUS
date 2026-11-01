import {test,expect} from "@playwright/test";

test("verified finding connects evidence, ownership, task progress and notification",async({page})=>{
  const source="NEX-SRC-SERVICE_CATALOG",foundation="NEX-SRC-COMPANY_FOUNDATION";
  const service="NEX-SVC-IDENTITY_API",team="NEX-TEAM-ID",run="resolution-fixture";
  const snapshot=(id:string,src:string,record:string,excerpt:string)=>({evidence_id:id,run_id:run,source_id:src,record_id:record,
    kind:"ENTITY_ASSERTION",locator:`record:${record}`,excerpt,content_hash:"fixture-sha256",retrieved_at:"2026-11-01T00:00:00Z",tool_id:"resolution.assertions"});
  const evidence=[snapshot("ev_fixture_a",source,"record-a",'{"description":"principal_id required"}'),
    snapshot("ev_fixture_b",source,"record-b",'{"description":"subject_id required"}'),
    snapshot("ev_fixture_owner",foundation,"owner-record",'{"source_id":"NEX-TEAM-ID","type":"OWNS","target_id":"NEX-SVC-IDENTITY_API"}')];
  const owner={service_id:service,service_name:"Identity API",primary_team_id:team,primary_team_name:"Identity Engineering",
    candidate_team_ids:[team],supporting_team_ids:[],project_ids:["NEX-PRJ-ID"],owner_ids:[],evidence_ids:["ev_fixture_owner"],status:"VERIFIED",
    explanation:"A unique team directly owns this service in the selected graph."};
  const problem={problem_id:"description-conflict",category:"CONFLICTING_ASSERTIONS",title:"Reconcile conflicting Identity API descriptions",
    description:"Two authorized records disagree about the required identity field.",severity:"MEDIUM",service_id:service,
    affected_system_ids:[service],impact:"Engineers lack a consistent description; no outage is established.",
    recommended_action:"Compare the cited records and update both descriptions to the agreed contract.",
    acceptance_criteria:["Both current descriptions agree."],evidence_ids:["ev_fixture_a","ev_fixture_b"],verification_status:"SUPPORTED",ownership:owner,task_id:"task-fixture"};
  let created=false,taskStatus="ASSIGNED",reads=0;
  const task=()=>({task_id:"task-fixture",title:problem.title,description:problem.description,required_action:problem.recommended_action,
    priority:"MEDIUM",status:taskStatus,service_id:service,project_id:"NEX-PRJ-ID",primary_team_id:team,primary_team_name:"Identity Engineering",
    supporting_team_ids:[],assigned_subject:null,investigation_id:run,finding:problem,evidence_ids:evidence.map(item=>item.evidence_id),
    acceptance_criteria:problem.acceptance_criteria,assignment_reason:"Source-backed direct service ownership",resolution_verification:"NOT_CHECKED"});
  const report=()=>({run_id:run,status:"PARTIAL",summary:"Current Identity API descriptions conflict. Reconciliation is required; an outage is not established.",
    entity_ids:[service,team],relationship_ids:["owner-edge"],evidence_refs:[`${source}:record-a`,`${source}:record-b`],
    evidence_registry:evidence,structured_findings:[],actionable_findings:[problem],ownership_decisions:[owner],
    selected_source_ids:[source,foundation],requested_source_ids:[source,foundation],source_usage:{[source]:2,[foundation]:1},
    verification_status:"PARTIALLY_VERIFIED",persistence_status:"PERSISTED",resolution_status:"TASKS_CREATED",objective:"Investigate Identity API compatibility",created_at:"2026-11-01T00:00:00Z"});
  await page.route("**/api/v1/**",route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith("/nexus/session"))return route.fulfill({json:{employee_id:"admin",display_name:"Leena Vardhan",role_code:"ADMIN",company_id:"nexus",project_ids:["NEX-PRJ-ID"],source_ids:[source,foundation],capabilities:{review_access_requests:true}}});
    if(path.endsWith("/session"))return route.fulfill({json:{subject:"nexus:admin",tenant_id:"nexus-tenant",permissions:["ADMIN","READ_GRAPH","READ_EVIDENCE","EXECUTE_TOOL","MANAGE_TASKS"]}});
    if(path.endsWith("/workspaces"))return route.fulfill({json:{items:[{id:"nexus-workspace",name:"NEXUS workspace"}]}});
    if(path.endsWith("/nexus/sources"))return route.fulfill({json:{items:[{source_id:source},{source_id:foundation}]}});
    if(path.endsWith("/investigations")&&route.request().method()==="POST"){created=true;return route.fulfill({json:report()});}
    if(path.endsWith(`/investigations/${run}`))return route.fulfill({json:report()});
    if(path.endsWith("/tasks"))return route.fulfill({json:{items:created?[task()]:[]}});
    if(path.endsWith("/tasks/task-fixture/updates")){taskStatus=route.request().postDataJSON().status;return route.fulfill({json:task()});}
    if(path.endsWith("/tasks/task-fixture"))return route.fulfill({json:{task:task(),evidence,can_assign:true,allowed_transitions:taskStatus==="ASSIGNED"?["IN_PROGRESS","BLOCKED"]:["RESOLVED","BLOCKED"],history:[{actor:"nexus:admin",event:"CREATED",occurred_at:"2026-11-01T00:00:00Z",details:{reason:"Source-backed task created"}}]}});
    if(path.endsWith("/notifications/notice-fixture/read")){reads++;return route.fulfill({json:{status:"READ"}});}
    if(path.endsWith("/notifications"))return route.fulfill({json:{unread:created&&!reads?1:0,items:created?[{notification_id:"notice-fixture",task_id:"task-fixture",title:problem.title,team_name:"Identity Engineering",priority:"MEDIUM",project_id:"NEX-PRJ-ID",read_at:reads?"2026-11-01T00:01:00Z":null,created_at:"2026-11-01T00:00:00Z"}]:[]}});
    if(path.endsWith("/relationships/owner-edge"))return route.fulfill({json:{id:"owner-edge",source_id:team,target_id:service,type:"OWNS",active:true,source_id_ref:foundation,record_id:"owner-record"}});
    if(path.includes("/entities/")){const id=path.split("/").at(-1);return route.fulfill({json:{id,type:id===team?"TEAM":"SERVICE",name:id===team?"Identity Engineering":"Identity API",active:true}});}
    return route.fulfill({json:{items:[]}});
  });
  await page.goto("/");await page.getByLabel("Access token").fill("4");await page.getByLabel("Access token").press("Enter");
  await page.getByLabel("What would you like to investigate?").fill("Investigate Identity API compatibility");
  await page.locator(`input[type=checkbox][value="${source}"]`).check();await page.locator(`input[type=checkbox][value="${foundation}"]`).check();
  await page.getByRole("button",{name:"Start investigation",exact:true}).click();
  await expect(page.getByText("1 verified actionable problems")).toBeVisible();
  await page.getByRole("tab",{name:"Ownership & Actions",exact:true}).click();
  await expect(page.locator(".ownership-actions")).toContainText("Identity Engineering");
  await page.getByRole("button",{name:/Open task/}).click();
  await expect(page.locator(".task-detail")).toContainText(problem.recommended_action);
  await page.getByLabel("Next task status").selectOption("IN_PROGRESS");await page.getByLabel("Task progress note").fill("Comparing both contract descriptions");
  await page.getByRole("button",{name:"Save task update",exact:true}).click();
  await expect(page.locator(".task-detail .run-status")).toHaveText("IN PROGRESS");
  await page.getByRole("button",{name:/Open source investigation/}).click();
  await page.getByRole("tab",{name:"Evidence",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Evidence for actionable findings"})).toBeVisible();
  await page.getByRole("tab",{name:"Relationship Graph",exact:true}).click();
  await expect(page.getByRole("img",{name:"Interactive relationship graph: 2 nodes and 1 relationships"})).toBeVisible();
  await page.getByRole("navigation").getByRole("button",{name:"Notifications",exact:true}).click();
  await page.locator(".notification-item").click();await expect(page.locator(".task-detail")).toContainText("IN PROGRESS");expect(reads).toBe(1);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
});
