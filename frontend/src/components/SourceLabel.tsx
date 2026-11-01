import { useContext } from "react";
import { SourceCatalog } from "../workspace/sourceCatalog";
import { sourceLabel, sourceReferenceLabel } from "../workspace/sourceNames";
export function SourceLabel({
  id,
  reference = false,
}: {
  id: string;
  reference?: boolean;
}) {
  const catalog = useContext(SourceCatalog);
  return (
    <span className="source-label" title={id}>
      {reference ? sourceReferenceLabel(id, catalog) : sourceLabel(id, catalog)}
    </span>
  );
}
