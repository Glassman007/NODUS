import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import type { RunGraph, GraphNode, GraphEdge } from "../investigations/graph";
import { neighbors } from "../investigations/graph";
import { entityName } from "../investigations/presentation";
import { SourceLabel } from "./SourceLabel";
import { WorkspaceData } from "./WorkspaceData";
import {
  fitGraph,
  graphLabels,
  separateGraphLabels,
} from "../investigations/graphLayout";
interface Props {
  graph: RunGraph;
  selectedSources: readonly string[];
  focusId?: string;
  focusEdgeId?: string;
  inspect: (ref: string) => void;
  canReadEvidence: boolean;
}
export function RelationshipGraph({
  graph,
  selectedSources,
  focusId,
  focusEdgeId,
  inspect,
  canReadEvidence,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const pinned = useRef<string | null>(focusEdgeId ?? null);
  const [selected, setSelected] = useState<GraphNode | GraphEdge | null>(
    () => graph.edges.find((edge) => edge.id === focusEdgeId) ?? null,
  );
  const [root, setRoot] = useState(
    focusId ??
      graph.nodes.find((n) => n.type === "SERVICE")?.id ??
      graph.nodes[0]?.id ??
      "",
  );
  const [hops, setHops] = useState(1);
  const [full, setFull] = useState(true);
  const [hovered, setHovered] = useState<{
    record: GraphNode | GraphEdge;
    x: number;
    y: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [relation, setRelation] = useState("");
  const [preset, setPreset] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [provenance, setProvenance] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState("");
  const { nodes, edges, nodeById } = useMemo(() => {
    const scoped = graph.edges.filter(
      (e) =>
        (e.source_id_ref
          ? selectedSources.includes(e.source_id_ref)
          : unknown) &&
        (!relation || e.type === relation) &&
        (!provenance ||
          (provenance === "records"
            ? Boolean(e.source_id_ref && e.record_id)
            : !e.record_id)),
    );
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const allowed = scoped.filter((e) => {
      const source = nodeById.get(e.source_id);
      const target = nodeById.get(e.target_id);
      if (preset === "services")
        return (
          source?.type === "SERVICE" &&
          target?.type === "SERVICE" &&
          e.type === "DEPENDS_ON"
        );
      if (preset === "interfaces")
        return (
          (source?.type === "SERVICE" && target?.type === "CONTRACT") ||
          (target?.type === "SERVICE" && source?.type === "CONTRACT")
        );
      if (preset === "published") return e.type === "PROVIDES";
      if (preset === "consumed") return e.type === "CONSUMES";
      return true;
    });
    const visibleIds = full
      ? new Set(graph.nodes.map((n) => n.id))
      : neighbors({ edges: allowed }, root, hops);
    const nodes = graph.nodes.filter(
      (n) => visibleIds.has(n.id) && (!type || n.type === type),
    );
    const ids = new Set(nodes.map((n) => n.id));
    const edges = allowed.filter(
      (e) => ids.has(e.source_id) && ids.has(e.target_id),
    );
    return { nodes, edges, nodeById };
  }, [
    graph,
    selectedSources,
    root,
    hops,
    full,
    type,
    relation,
    preset,
    unknown,
    provenance,
  ]);
  const labels = useMemo(() => graphLabels(graph.nodes), [graph.nodes]);
  const layoutOptions = useMemo(
    () => ({
      name: "cose",
      animate: false,
      randomize: false,
      nodeDimensionsIncludeLabels: true,
      nodeRepulsion: (node: cytoscape.NodeSingular) =>
        32000 + Math.min(node.degree(), 12) * 1800,
      idealEdgeLength: (edge: cytoscape.EdgeSingular) =>
        110 + Math.min(edge.source().degree() + edge.target().degree(), 12) * 3,
      edgeElasticity: () => 140,
      nodeOverlap: 40,
      gravity: 0.06,
      componentSpacing: 70,
      numIter: 1800,
      initialTemp: 180,
      coolingFactor: 0.985,
      minTemp: 0.3,
      fit: false,
    }),
    [],
  );
  const layout = () => {
    const core = cy.current;
    if (core) {
      core.layout(layoutOptions).run();
      separateGraphLabels(core, true);
      fitGraph(core);
    }
  };
  useEffect(() => {
    if (!container.current) return;
    const core = cytoscape({
      container: container.current,
      elements: [
        ...nodes.map((n, index) => ({
          position: {
            x: Math.cos(index * 2.39996) * Math.sqrt(index + 1) * 80,
            y: Math.sin(index * 2.39996) * Math.sqrt(index + 1) * 80,
          },
          data: {
            id: n.id,
            label: labels.get(n.id),
            fullLabel: entityName(n),
            type: n.type,
          },
        })),
        ...edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source_id,
            target: e.target_id,
          },
        })),
      ],
      layout: { name: "preset" },
      minZoom: 0.12,
      maxZoom: 3,
      wheelSensitivity: 0.22,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#718fa7",
            label: "data(label)",
            color: "#d6e3ed",
            "font-size": 13,
            "font-family": "system-ui",
            "text-wrap": "none",
            "text-outline-width": 2,
            "text-outline-color": "#101820",
            "text-valign": "bottom",
            "text-margin-y": 10,
            width: (node: cytoscape.NodeSingular) => 34 + Math.min(node.degree(), 8) * 1.5,
            height: (node: cytoscape.NodeSingular) => 34 + Math.min(node.degree(), 8) * 1.5,
            "border-width": 2,
            "border-color": "#273e50",
          },
        },
        {
          selector: 'node[type="SERVICE"]',
          style: {
            "background-color": "#b6df78",
            shape: "round-rectangle",
          },
        },
        {
          selector: 'node[type="CONTRACT"]',
          style: {
            "background-color": "#8bb8ed",
            shape: "diamond",
          },
        },
        {
          selector: 'node[type="EVENT"]',
          style: { "background-color": "#d9a65d", shape: "hexagon" },
        },
        {
          selector: "edge",
          style: {
            width: 1.2,
            "line-color": "#516575",
            "target-arrow-color": "#718898",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "",
            opacity: 0.7,
            "font-size": 8,
            color: "#8ba3b5",
            "text-background-color": "#101a24",
            "text-background-opacity": 0.85,
            "text-background-padding": "3px",
            "text-rotation": "autorotate",
          },
        },
        {
          selector: ":selected",
          style: {
            "background-color": "#eefccf",
            "line-color": "#c4ee77",
            "target-arrow-color": "#c4ee77",
            "border-color": "#e3ffb3",
            "border-width": 3,
          },
        },
        {
          selector: "edge.highlight",
          style: {
            "line-color": "#b2d980",
            "target-arrow-color": "#b2d980",
            width: 2.5,
            opacity: 1,
          },
        },
        { selector: ".dimmed", style: { opacity: 0.18 } },
        {
          selector: "node.highlight",
          style: { "border-color": "#b2d980", "border-width": 3 },
        },
        {
          selector: ".search-match",
          style: { "border-color": "#fbcc72", "border-width": 4 },
        },
      ],
    });
    cy.current = core;
    core.layout(layoutOptions).run();
    separateGraphLabels(core, true);
    fitGraph(core);
    const highlight = (id: string | null) => {
      core.elements().removeClass("highlight dimmed");
      if (!id) return;
      const target = core.getElementById(id);
      if (!target.length) return;
      const edgeRelated = target.union(target.connectedNodes());
      const related = target.isNode() ? target.closedNeighborhood() : edgeRelated;
      core.elements().not(related).addClass("dimmed");
      related.addClass("highlight");
    };
    core.on("select", "node, edge", (event) => {
      const target = event.target;
      pinned.current = target.id();
      core.elements().not(target).unselect();
      setSelected(target.isNode()
        ? nodeById.get(target.id()) ?? null
        : graph.edges.find(edge => edge.id === target.id()) ?? null);
      highlight(target.id());
    });
    core.on("tap", event => {
      if (event.target !== core) return;
      pinned.current = null;
      core.elements().unselect();
      setSelected(null);
      highlight(null);
    });
    core.on("mouseover", "node, edge", event => {
      const target = event.target;
      const record = target.isNode()
        ? nodeById.get(target.id())
        : graph.edges.find(edge => edge.id === target.id());
      if (!record) return;
      const position = event.renderedPosition ?? target.renderedPosition();
      setHovered({
        record,
        x: Math.max(12, Math.min(position.x + 16, core.width() - 290)),
        y: Math.max(12, Math.min(position.y + 16, core.height() - 190)),
      });
      highlight(target.id());
    });
    core.on("mouseout", "node, edge", () => {
      setHovered(null);
      highlight(pinned.current);
    });
    core.on("pan zoom", () => setHovered(null));
    core.on("dragfree", "node", () => separateGraphLabels(core));
    if (pinned.current && core.getElementById(pinned.current).length) {
      core.getElementById(pinned.current).select();
    } else {
      pinned.current = null;
      setSelected(null);
    }
    const resize = new ResizeObserver(() => {
      core.resize();
      fitGraph(core);
    });
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      core.destroy();
      cy.current = null;
    };
  }, [graph, nodes, edges, nodeById, focusId, focusEdgeId, layoutOptions, labels]);
  useEffect(() => {
    const core = cy.current;
    if (!core) return;
    core.nodes().removeClass("search-match");
    if (query.trim())
      core
        .nodes()
        .filter((n) =>
          `${n.data("fullLabel")} ${n.id()}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .addClass("search-match");
  }, [query, root, hops, full, type, relation, preset, unknown, provenance]);
  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  const focus = (id: string) => {
    pinned.current = id;
    setRoot(id);
    setSelected(nodeById.get(id) ?? null);
    const core = cy.current;
    if (core) {
      const node = core.getElementById(id);
      core.elements().unselect();
      node.select();
      core.animate({ center: { eles: node }, duration: 250 });
    }
  };
  const isEdge = (value: GraphNode | GraphEdge): value is GraphEdge =>
    "source_id" in value;
  return (
    <div
      ref={wrapper}
      className={`relationship-workspace ${fullscreen ? "graph-fullscreen" : ""}`}
    >
      <div className="graph-toolbar">
        <label>
          Find an entity
          <input
            aria-label="Find graph entity"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or identifier"
          />
        </label>
        <select
          aria-label="Focus graph entity"
          value={root}
          onChange={(e) => focus(e.target.value)}
        >
          {graph.nodes
            .filter(
              (n) =>
                !query ||
                `${n.name} ${n.id}`.toLowerCase().includes(query.toLowerCase()),
            )
            .map((n) => (
              <option key={n.id} value={n.id}>
                {entityName(n)}
              </option>
            ))}
        </select>
        <button
          className="quiet-button"
          onClick={() => {
            const match = graph.nodes.find((n) =>
              `${n.name} ${n.id}`.toLowerCase().includes(query.toLowerCase()),
            );
            if (match) focus(match.id);
          }}
        >
          Focus match
        </button>
        <button
          className="quiet-button"
          onClick={() => {
            setFull(true);
            setType("");
            setRelation("");
            setPreset("");
            setProvenance("");
          }}
        >
          Full investigation graph
        </button>
      </div>
      <div className="graph-filters">
        <select
          aria-label="Graph entity type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All entity types</option>
          {[...new Set(graph.nodes.map((n) => n.type).filter(Boolean))].map(
            (t) => (
              <option key={t} value={t!}>
                {t}
              </option>
            ),
          )}
        </select>
        <select
          aria-label="Graph relationship type"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
        >
          <option value="">All relationship types</option>
          {[...new Set(graph.edges.map((e) => e.type))].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Graph connection filter"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          <option value="">All connections</option>
          <option value="services">Service dependencies</option>
          <option value="interfaces">Services & interfaces</option>
          <option value="published">Provided interfaces (PROVIDES)</option>
          <option value="consumed">Consumed interfaces (CONSUMES)</option>
        </select>
        <select
          aria-label="Graph provenance filter"
          value={provenance}
          onChange={(e) => setProvenance(e.target.value)}
        >
          <option value="">Any record provenance</option>
          <option value="records">Source + record available</option>
          <option value="missing">Record provenance unavailable</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={unknown}
            onChange={(e) => setUnknown(e.target.checked)}
          />
          Include source-unconfirmed records
        </label>
      </div>
      <p className="graph-caption">
        {nodes.length} nodes · {edges.length} relationships shown · Current
        authorized records, not an immutable run snapshot.{" "}
        {
          graph.edges.filter(
            (e) =>
              e.source_id_ref && !selectedSources.includes(e.source_id_ref),
          ).length
        }{" "}
        retrieved relationships excluded because their provenance is outside the
        selected sources. {graph.edges.filter((e) => !e.source_id_ref).length}{" "}
        have no source provenance.
      </p>
      <div className="graph-unified">
        <div className="graph-stage">
          <div
            ref={container}
            className="graph-canvas"
            aria-label={`Interactive relationship graph: ${nodes.length} nodes and ${edges.length} relationships`}
            role="img"
            onDoubleClick={layout}
          />
          {hovered&&<div className="graph-hover-card" role="tooltip" style={{left:hovered.x,top:hovered.y}}>
            {isEdge(hovered.record)?<>
              <strong>{hovered.record.type.replaceAll("_"," ")}</strong>
              <span>{entityName(nodeById.get(hovered.record.source_id)??{id:hovered.record.source_id,name:null})} → {entityName(nodeById.get(hovered.record.target_id)??{id:hovered.record.target_id,name:null})}</span>
              <small>{hovered.record.source_id_ref&&hovered.record.record_id?`${hovered.record.source_id_ref}:${hovered.record.record_id}`:"Record provenance unavailable"}</small>
            </>:<><strong>{entityName(hovered.record)}</strong><span>{hovered.record.type??"Entity"}</span><small>{hovered.record.id}</small></>}
          </div>}
          <div className="graph-controls">
            <button
              aria-label="Zoom graph in"
              onClick={() => cy.current?.zoom(cy.current.zoom() * 1.25)}
            >
              +
            </button>
            <button
              aria-label="Zoom graph out"
              onClick={() => cy.current?.zoom(cy.current.zoom() / 1.25)}
            >
              −
            </button>
            <button onClick={() => {if(cy.current)fitGraph(cy.current);}}>Fit</button>
            <button onClick={layout}>Reset layout</button>
            <button
              onClick={() => {
                setFull(false);
                setHops(1);
              }}
            >
              One hop
            </button>
            <button
              onClick={() => {
                setFull(false);
                setHops(2);
              }}
            >
              Two hops
            </button>
            <button
              onClick={() => {
                const el = wrapper.current;
                if (document.fullscreenElement) void document.exitFullscreen();
                else if (el?.requestFullscreen)
                  void el
                    .requestFullscreen()
                    .catch(() =>
                      setMessage("Fullscreen is unavailable in this browser."),
                    );
                else setMessage("Fullscreen is unavailable in this browser.");
              }}
            >
              Fullscreen
            </button>
            <button
              onClick={() => {
                const data = cy.current?.png({
                  bg: "#101820",
                  scale: 2,
                  full: true,
                });
                if (data) {
                  const a = document.createElement("a");
                  a.href = data;
                  a.download = "nodus-relationships.png";
                  a.click();
                }
              }}
            >
              Export PNG
            </button>
          </div>
          {!edges.length && (
            <p className="graph-empty">
              No drawable relationships in this view. Try another focus,
              full-graph mode, or filters. No relationships have been
              fabricated.
            </p>
          )}
        </div>
        <aside className="graph-details" aria-label="Graph selection details">
          <p className="section-kicker">SELECTED RECORD</p>
          {selected ? (
            <>
              <h3>
                {isEdge(selected)
                  ? selected.type.replaceAll("_", " ").toLowerCase()
                  : entityName(selected)}
              </h3>
              {isEdge(selected) ? (
                <>
                  <p>
                    {nodeById.get(selected.source_id)?.name ??
                      selected.source_id}{" "}
                    →{" "}
                    {nodeById.get(selected.target_id)?.name ??
                      selected.target_id}
                  </p>
                  <p className="inline-note">
                    Tool-observed relationship · Narrative verification not
                    established.
                  </p>
                  {selected.source_id_ref ? (
                    <p>
                      Source: <SourceLabel id={selected.source_id_ref} />
                    </p>
                  ) : (
                    <p>Source provenance unavailable.</p>
                  )}
                  {selected.source_id_ref &&
                    selected.record_id &&
                    canReadEvidence && (
                      <button
                        className="quiet-button"
                        onClick={() =>
                          inspect(
                            `${selected.source_id_ref}:${selected.record_id}`,
                          )
                        }
                      >
                        Inspect supporting record
                      </button>
                    )}
                  <WorkspaceData value={selected} />
                </>
              ) : (
                <>
                  <p>{selected.description ?? "No description returned."}</p>
                  <button
                    className="quiet-button"
                    onClick={() => focus(selected.id)}
                  >
                    Show immediate connections
                  </button>
                  <WorkspaceData value={selected} />
                </>
              )}
            </>
          ) : (
            <p>
              Click a node or relationship, or choose a record below. The list
              provides keyboard access to graph records.
            </p>
          )}
          <details>
            <summary>Browse visible records</summary>
            {nodes.map((n) => (
              <button
                className="record-picker"
                key={n.id}
                onClick={() => {
                  setSelected(n);
                  cy.current?.getElementById(n.id).select();
                }}
              >
                {entityName(n)}
              </button>
            ))}
            {edges.map((e) => (
              <button
                className="record-picker"
                key={e.id}
                onClick={() => {
                  setSelected(e);
                  cy.current?.getElementById(e.id).select();
                }}
              >
                {nodeById.get(e.source_id)?.name ?? e.source_id} →{" "}
                {e.type.toLowerCase()} →{" "}
                {nodeById.get(e.target_id)?.name ?? e.target_id}
              </button>
            ))}
          </details>
        </aside>
      </div>
      <div className="graph-legend">
        <span>■ Service</span>
        <span>◆ Contract / API</span>
        <span>⬡ Event</span>
        <span>● Other entity</span>
        <span>→ Direction of relationship</span>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
