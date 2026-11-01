"""Focused admin + evidence-to-task workflow, using the existing isolated stores."""
import uuid
import pytest
from fastapi.testclient import TestClient
import backend.app.main as main
from backend.tests.test_agent_persistence import isolated_postgres
from backend.tests.test_agent_investigation_integration import (
    isolated_neo4j,store,tool_registry,skill_registry,FakeProviderClient,_success,_router,
)
from backend.app.agent.persistence import InvestigationStore
from backend.app.gateway.gateway import ModelGateway
from backend.app.gateway.provider import RawFunctionCall
from backend.app.governance.store import GovernanceStore
from backend.app.governance.identity import NEXUS_TENANT_ID,ROLE_PERMISSIONS
from backend.app.graph.repository import GraphRepository
from backend.app.graph.models import SourceRecordInput,EntityInput,RelationInput
from backend.app.security import Principal
from backend.app.tools.executor import ToolExecutor
from backend.app.tools.registry import ToolDependencies

pytestmark=pytest.mark.integration


def test_admin_problem_assignment_notification_and_independent_resolution(
        isolated_postgres,store,tool_registry,skill_registry,monkeypatch):
    workspace=uuid.uuid4().hex
    governance=GovernanceStore(isolated_postgres);governance.start()
    persistence=InvestigationStore(isolated_postgres);persistence.start()
    tenant=NEXUS_TENANT_ID
    with governance.transaction() as cur:
        for role in ("ADMIN","DEVELOPER","INTERN"):
            cur.execute("INSERT INTO nexus_roles(tenant_id,company_id,role_id,role_code,data) VALUES (%s,'nexus',%s,%s,'{}')",(tenant,role,role))
        for employee,role in (("admin","ADMIN"),("engineer","DEVELOPER"),("outsider","DEVELOPER"),("intern","INTERN")):
            cur.execute("INSERT INTO nexus_employees(tenant_id,company_id,employee_id,display_name,data) VALUES (%s,'nexus',%s,%s,'{}')",
                        (tenant,employee,employee.title()))
            cur.execute("""INSERT INTO nexus_demo_identities(tenant_id,company_id,demo_identity_id,demo_token,employee_id,role_id,data)
                VALUES (%s,'nexus',%s,%s,%s,%s,'{}')""",(tenant,employee,employee,employee,role))
        for source in ("source-a","source-b"):
            cur.execute("""INSERT INTO nexus_sources(tenant_id,company_id,source_id,stage,classification,data)
                VALUES (%s,'nexus',%s,'test','COMPANY_SHARED','{}')""",(tenant,source))
        for employee in ("engineer","intern"):
            cur.execute("""INSERT INTO nexus_team_memberships(tenant_id,company_id,employee_id,team_id,data)
                VALUES (%s,'nexus',%s,'team-id','{}')""",(tenant,employee))
    users={name:Principal(subject=f"nexus:{name}",tenant_id=tenant,workspaces=(workspace,),
        permissions=ROLE_PERMISSIONS[role],source_ids=("source-a","source-b"))
        for name,role in (("admin","ADMIN"),("engineer","DEVELOPER"),("outsider","DEVELOPER"),("intern","INTERN"))}
    active=[users["admin"]]
    monkeypatch.setitem(main.app.dependency_overrides,main.principal,lambda:active[0])
    writer=GraphRepository(store,tenant,workspace,"writer",allow_all=True,can_evidence=True)
    def record(source,description,with_owners=False):
        entities=[EntityInput(external_id="auth",canonical_id="auth",type="SERVICE",name="Authentication API",description=description)]
        relations=[]
        if with_owners:
            entities.extend([EntityInput(external_id="team-id",canonical_id="team-id",type="TEAM",name="Identity Engineering"),
                EntityInput(external_id="project-id",canonical_id="project-id",type="PROJECT",name="Identity")])
            relations=[RelationInput(source_external_id="team-id",target_external_id="auth",type="OWNS"),
                       RelationInput(source_external_id="project-id",target_external_id="auth",type="OWNS")]
        return SourceRecordInput(source_id=source,record_id=source,title=source,entities=entities,relationships=relations)
    writer.ingest(record("source-a","Consumers require principal_id",True))
    writer.ingest(record("source-b","Consumers require subject_id"))
    provider=FakeProviderClient()
    def script():
        provider.queue=[_success(function_calls=(RawFunctionCall(id="1",name="skill_discover",arguments={}),)),
            _success(function_calls=(RawFunctionCall(id="2",name="skill_load_instructions",arguments={"skill_id":"graph-trace"}),)),
            _success(function_calls=(RawFunctionCall(id="3",name="graph_entity_lookup",arguments={"entity_id":"auth"}),)),
            _success(text="The service descriptions conflict. No technical outage has been established.")]
    for key,value in {"graph_store":store,"authority_rules":(),"governance_store":governance,
        "investigation_store":persistence,"tool_registry":tool_registry,"skill_registry":skill_registry,
        "tool_executor":ToolExecutor(tool_registry,ToolDependencies(graph_store=store,governance_store=governance)),
        "model_gateway":ModelGateway(provider,_router())}.items():
        monkeypatch.setattr(main.app.state,key,value,raising=False)
    client=TestClient(main.app);base=f"/api/v1/workspaces/{workspace}"
    script()
    response=client.post(base+"/investigations",json={"objective":"Investigate Authentication API compatibility","selected_source_ids":["source-a","source-b"],"entity_id":"auth"})
    assert response.status_code==200
    report=response.json()
    assert report["status"]!="BLOCKED" and report["error_message"] is None and provider.calls==4
    assert report["resolution_status"]=="TASKS_CREATED",report
    problem=report["actionable_findings"][0];task_id=problem["task_id"]
    assert problem["ownership"]["primary_team_id"]=="team-id"
    assert problem["verification_status"]=="SUPPORTED" and problem["evidence_ids"]
    assert client.get(base+"/tasks").json()["items"][0]["status"]=="ASSIGNED"
    script()
    repeated=client.post(base+"/investigations",json={"objective":"Review the same API descriptions","selected_source_ids":["source-a","source-b"],"entity_id":"auth"}).json()
    assert repeated["actionable_findings"][0]["task_id"]==task_id
    assert len(client.get(base+"/tasks").json()["items"])==1
    active[0]=users["engineer"]
    notices=client.get(base+"/notifications").json()["items"]
    assert len(notices)==1 and notices[0]["task_id"]==task_id
    assert client.get(base+f"/tasks/{task_id}").status_code==200
    assert client.get(base+f"/tasks/{task_id}/evidence/{problem['evidence_ids'][0]}").status_code==200
    assert client.post(base+f"/tasks/{task_id}/updates",json={"status":"IN_PROGRESS","reason":"Comparing both source records"}).status_code==200
    assert client.post(base+f"/tasks/{task_id}/updates",json={"status":"RESOLVED","reason":"Corrections submitted for independent review"}).status_code==200
    active[0]=users["outsider"]
    assert client.get(base+f"/tasks/{task_id}").status_code==404
    active[0]=users["intern"]
    assert client.get(base+f"/tasks/{task_id}").status_code==404
    active[0]=users["admin"]
    assert client.post(base+f"/tasks/{task_id}/updates",json={"status":"VERIFIED","reason":"Independent source check"}).status_code==409
    writer.ingest(record("source-b","Consumers require principal_id"))
    verified=client.post(base+f"/tasks/{task_id}/updates",json={"status":"VERIFIED","reason":"Both current assertions now agree"})
    assert verified.status_code==200,verified.text
    assert verified.json()["resolution_verification"]=="VERIFIED"
    assert client.post(base+f"/tasks/{task_id}/updates",json={"status":"CLOSED","reason":"Independent correction verified"}).status_code==200
    assert len(client.get(base+f"/tasks/{task_id}").json()["history"])==5
    # A missing owner creates review work, then newly evidenced ownership can unblock it.
    ownerless=record("source-a","Consumers require principal_id",True)
    ownerless=ownerless.model_copy(update={"relationships":[edge for edge in ownerless.relationships if edge.source_external_id!="team-id"]})
    writer.ingest(ownerless)
    writer.ingest(record("source-b","A conflicting current identifier description"))
    script()
    review=client.post(base+"/investigations",json={"objective":"Review unresolved ownership","selected_source_ids":["source-a","source-b"],"entity_id":"auth"}).json()
    review_id=review["actionable_findings"][0]["task_id"]
    assert client.get(base+f"/tasks/{review_id}").json()["task"]["status"]=="OPEN"
    writer.ingest(record("source-a","Consumers require principal_id",True))
    current=client.get(base+f"/tasks/{review_id}").json()
    assert current["assignment_candidates"]==[{"team_id":"team-id","team_name":"Identity Engineering"}]
    assert {person["subject"] for person in current["assignee_candidates"]}=={"nexus:engineer","nexus:intern"}
    assigned=client.post(base+f"/tasks/{review_id}/updates",json={"primary_team_id":"team-id","reason":"Current direct ownership has been restored"})
    assert assigned.status_code==200,assigned.text
    assert assigned.json()["status"]=="ASSIGNED"
    assert client.post(base+f"/tasks/{review_id}/updates",json={"primary_team_id":"team-id","reason":"Same assignment should not notify again"}).status_code==409
    active[0]=users["engineer"]
    assert client.get(base+f"/tasks/{review_id}").status_code==200
    assert sum(notice["task_id"]==review_id for notice in client.get(base+"/notifications").json()["items"])==1
