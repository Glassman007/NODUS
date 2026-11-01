import { useContext, type ReactNode } from "react";
import { SourceLabel } from "./SourceLabel";
import { SourceCatalog } from "../workspace/sourceCatalog";

function label(key: string) {
  return key.replaceAll("_", " ");
}
function Value({
  value,
  field,
}: {
  value: unknown;
  field?: string;
}): ReactNode {
  const catalog = useContext(SourceCatalog);
  if (
    typeof value === "string" &&
    field &&
    [
      "source_id",
      "source_id_ref",
      "source_ids",
      "selected_source_ids",
      "supporting_source_ids",
      "effective_source_ids",
    ].includes(field)
  )
    return <SourceLabel id={value} />;
  if (
    typeof value === "string" &&
    (field === "evidence_refs" || field === "evidence_ref")
  )
    return <SourceLabel id={value} reference />;
  if (
    typeof value === "string" &&
    field === "resource_id" &&
    (catalog.some((source) => source.source_id === value) ||
      /^NEX[-_]SRC[-_]/i.test(value))
  )
    return <SourceLabel id={value} />;
  if (value === null || value === undefined)
    return <span className="data-unavailable">Not returned</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length ? (
      <div className="data-list">
        {value.map((item, index) => (
          <div className="data-list-item" key={index}>
            <Value value={item} field={field} />
          </div>
        ))}
      </div>
    ) : (
      <span className="data-unavailable">None returned</span>
    );
  if (typeof value === "object")
    return (
      <dl className="data-fields">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{label(key)}</dt>
            <dd>
              <Value
                value={item}
                field={
                  key === "source_id" && "target_id" in value ? undefined : key
                }
              />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}

/** Present authorized API metadata without assigning verification or certainty. */
export function WorkspaceData({ value }: { value: unknown }) {
  return (
    <div className="structured-data">
      <Value value={value} />
    </div>
  );
}
