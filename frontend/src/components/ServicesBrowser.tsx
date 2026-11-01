import { useMemo, useState } from "react";
import { Copy, Network, FileSearch, ArrowRight } from "lucide-react";
import type { RunGraph, GraphEdge, GraphNode } from "../investigations/graph";
import {
  entityName,
  relationName,
  selectedConnections,
} from "../investigations/presentation";
interface Props {
  graph: RunGraph;
  sourceIds: readonly string[];
  canReadEvidence: boolean;
  showGraph: (id: string, edgeId?: string) => void;
  inspect: (reference: string) => void;
}
export function ServicesBrowser({
  graph,
  sourceIds,
  canReadEvidence,
  showGraph,
  inspect,
}: Props) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [message, setMessage] = useState("");
  const byId = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph],
  );
  const priority = ["SERVICE", "CONTRACT", "EVENT", "SYSTEM"];
  const visible = graph.nodes
    .filter(
      (node) =>
        (!type || node.type === type) &&
        `${entityName(node)} ${node.name ?? ""} ${node.id} ${node.description ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const ai = priority.indexOf(a.type ?? "");
      const bi = priority.indexOf(b.type ?? "");
      return (
        (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) ||
        entityName(a).localeCompare(entityName(b))
      );
    });
  const connection = (edge: GraphEdge) => (
    <button
      key={edge.id}
      className="component-connection"
      onClick={() => showGraph(edge.source_id, edge.id)}
      title={`Open relationship ${edge.id} in graph`}
    >
      <span>
        {entityName(
          byId.get(edge.source_id) ?? { id: edge.source_id, name: null },
        )}
      </span>
      <span className="relationship-verb">
        <ArrowRight size={13} />
        {relationName(edge.type)}
        <ArrowRight size={13} />
      </span>
      <span>
        {entityName(
          byId.get(edge.target_id) ?? { id: edge.target_id, name: null },
        )}
      </span>
    </button>
  );
  const typeLabel = (node: GraphNode) =>
    (
      ({
        SERVICE: "Service",
        CONTRACT: "Interface / contract",
        EVENT: "Event",
        SYSTEM: "System",
      }) as Record<string, string>
    )[node.type ?? ""] ??
    node.type ??
    "Type unavailable";
  return (
    <div className="component-browser">
      <div className="component-browser-heading">
        <div>
          <h3>Services &amp; Interfaces</h3>
          <p>
            Explore components observed by this investigation. Names come from
            authorized graph records.
          </p>
        </div>
        <span>{visible.length} components</span>
      </div>
      <label className="component-search">
        Search components
        <input
          aria-label="Find services and interfaces"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, description or canonical identifier"
        />
      </label>
      <div
        className="component-type-filters"
        role="group"
        aria-label="Component types"
      >
        {[
          ["", "All"],
          ["SERVICE", "Services"],
          ["CONTRACT", "Interfaces"],
          ["EVENT", "Events"],
        ].map(([value, label]) => (
          <button
            key={label}
            aria-pressed={type === value}
            onClick={() => setType(value)}
          >
            {label}
            <span>
              {
                graph.nodes.filter((node) => !value || node.type === value)
                  .length
              }
            </span>
          </button>
        ))}
        {[
          ...new Set(
            graph.nodes
              .map((node) => node.type)
              .filter(
                (value): value is string =>
                  Boolean(value) &&
                  !["SERVICE", "CONTRACT", "EVENT"].includes(value!),
              ),
          ),
        ].map((value) => (
          <button
            key={value}
            aria-pressed={type === value}
            onClick={() => setType(value)}
          >
            {value[0] + value.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <p className="component-provenance">
        Connections below are current authorized records with selected-source
        provenance. They are graph observations, not independently verified
        claims.
      </p>
      {message && (
        <p role="status" className="copy-feedback">
          {message}
        </p>
      )}
      <div className="component-grid">
        {visible.map((node) => {
          const connections = selectedConnections(graph, node.id, sourceIds);
          const source = connections.find(
            (edge) => edge.source_id_ref && edge.record_id,
          );
          return (
            <article
              className="component-card"
              key={node.id}
              data-entity-id={node.id}
            >
              <header>
                <span
                  className={`component-kind kind-${node.type?.toLowerCase()}`}
                >
                  {typeLabel(node)}
                </span>
                <h4 title={entityName(node)}>{entityName(node)}</h4>
                <code>{node.id}</code>
              </header>
              {node.description && (
                <p className="component-description">{node.description}</p>
              )}
              <div className="connection-heading">
                <strong>Connected components</strong>
                <span>
                  {
                    new Set(
                      connections.map((edge) =>
                        edge.source_id === node.id
                          ? edge.target_id
                          : edge.source_id,
                      ),
                    ).size
                  }
                </span>
              </div>
              {connections.length ? (
                <div className="connection-preview">
                  {connections.slice(0, 3).map(connection)}
                  {connections.length > 3 && (
                    <span className="more-connections">
                      {connections.length - 3} more relationships in details
                    </span>
                  )}
                </div>
              ) : (
                <p className="component-empty">
                  No loaded relationships with selected-source provenance.
                </p>
              )}
              <details className="component-details">
                <summary>
                  View details
                  {connections.length > 0
                    ? ` · ${connections.length} relationships`
                    : ""}
                </summary>
                <p>
                  {node.description ??
                    "No description was returned for this component."}
                </p>
                <dl>
                  <dt>Canonical identifier</dt>
                  <dd>{node.id}</dd>
                  <dt>Record type</dt>
                  <dd>{node.type ?? "Not returned"}</dd>
                </dl>
                {connections.length > 0 && (
                  <div className="all-connections">
                    {connections.map(connection)}
                  </div>
                )}
              </details>
              <div className="component-actions">
                <button
                  className="report-action primary-action"
                  onClick={() => showGraph(node.id)}
                >
                  <Network size={15} />
                  Show in graph
                </button>
                {source && canReadEvidence && (
                  <button
                    className="report-action"
                    onClick={() =>
                      inspect(`${source.source_id_ref}:${source.record_id}`)
                    }
                  >
                    <FileSearch size={15} />
                    Inspect source record
                  </button>
                )}
                <button
                  className="report-action icon-action"
                  aria-label={`Copy identifier for ${entityName(node)}`}
                  title="Copy canonical identifier"
                  onClick={() => {
                    if (navigator.clipboard)
                      void navigator.clipboard
                        .writeText(node.id)
                        .then(() =>
                          setMessage(
                            `Copied identifier for ${entityName(node)}.`,
                          ),
                        )
                        .catch(() =>
                          setMessage(
                            `Copy unavailable. Identifier: ${node.id}`,
                          ),
                        );
                    else setMessage(`Copy unavailable. Identifier: ${node.id}`);
                  }}
                >
                  <Copy size={15} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="empty-state">
          <h4>No components match your search</h4>
          <p>
            Try a different name or identifier, or choose another entity type.
          </p>
          <button
            className="report-action"
            onClick={() => {
              setQuery("");
              setType("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
