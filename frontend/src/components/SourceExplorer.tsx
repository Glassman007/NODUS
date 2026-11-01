import { useState } from "react";
import { FileCheck2, Search } from "lucide-react";
import { sourceLabel, type SourceMetadata } from "../workspace/sourceNames";
import { WorkspaceData } from "./WorkspaceData";
import { SourceLabel } from "./SourceLabel";
interface Props {
  sources: readonly SourceMetadata[];
  loaded: boolean;
  selected: SourceMetadata | null;
  select: (source: SourceMetadata) => void;
}
export function SourceExplorer({ sources, loaded, selected, select }: Props) {
  const [filter, setFilter] = useState("");
  const matching = sources.filter((source) =>
    `${sourceLabel(source.source_id, sources)} ${source.source_id} ${typeof source.description === "string" ? source.description : ""}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  );
  return (
    <section
      className="panel source-explorer"
      aria-label="Available knowledge sources"
    >
      <div className="panel-heading">
        <h2>Available knowledge sources</h2>
        <FileCheck2 size={18} />
      </div>
      <div className="source-filter">
        <Search size={15} />
        <input
          aria-label="Filter sources"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sources by name or identifier"
        />
      </div>
      {!loaded ? (
        <p className="inline-note panel-body">
          Source metadata is loading or unavailable. No source inventory can be
          inferred.
        </p>
      ) : !matching.length ? (
        <div className="empty-state">
          <FileCheck2 size={24} />
          <h3>
            {sources.length
              ? "No matching sources"
              : "No sources returned for this project"}
          </h3>
          <p>
            {sources.length
              ? "Try another source name or identifier."
              : "Only authorized source metadata returned by the API is listed."}
          </p>
        </div>
      ) : (
        <div className="source-catalog">
          {matching.map((source) => (
            <button
              key={source.source_id}
              className={`source-card ${selected?.source_id === source.source_id ? "selected" : ""}`}
              aria-label={`Inspect ${sourceLabel(source.source_id, sources)}`}
              aria-pressed={selected?.source_id === source.source_id}
              title={source.source_id}
              onClick={() => select(source)}
            >
              <FileCheck2 size={17} />
              <span>
                <strong>
                  <SourceLabel id={source.source_id} />
                </strong>
                {typeof source.description === "string" && (
                  <small>{source.description}</small>
                )}
                <small>{source.classification ?? "Authorized source"}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="panel-body source-detail">
          <h3>
            <SourceLabel id={selected.source_id} />
          </h3>
          <WorkspaceData value={selected} />
          <p className="inline-note">
            Metadata returned for this source. Use entity search below to
            inspect evidence and relationships available to your identity.
          </p>
        </div>
      )}
    </section>
  );
}
