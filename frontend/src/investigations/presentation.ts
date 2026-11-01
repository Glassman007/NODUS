import type { GraphNode, RunGraph } from "./graph";
import type { SessionRun } from "./api";
const acronyms: Record<string, string> = {
  api: "API",
  apis: "APIs",
  http: "HTTP",
  https: "HTTPS",
  sql: "SQL",
  ci: "CI",
  cd: "CD",
  ui: "UI",
  id: "ID",
  sdk: "SDK",
  url: "URL",
  oauth: "OAuth",
};
export function readableName(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(
      (word) =>
        acronyms[word.toLowerCase()] ??
        word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}
export function entityName(node: Pick<GraphNode, "id" | "name">): string {
  const name = node.name?.trim();
  if (name && name !== node.id)
    return /[_-]/.test(name) || name === name.toUpperCase()
      ? readableName(name)
      : name;
  return readableName(
    node.id.replace(/^NEX-(?:SVC|IFC|FLOW|EVT|SYS|PRJ|DOC|ADR|PKG)-/i, ""),
  );
}
export function relationName(type: string): string {
  return (
    (
      {
        DEPENDS_ON: "Depends on",
        PROVIDES: "Provides",
        PUBLISHES: "Publishes",
        CONSUMES: "Consumes",
        PART_OF: "Part of",
        AFFECTS: "Affects",
      } as Record<string, string>
    )[type] ?? readableName(type)
  );
}
export function availableAnalysis(run: SessionRun): string {
  return run.full_analysis ?? run.summary;
}
export function plainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*`#]/g, "")
    .replace(/^\s*(?:[-+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function excerpt(text: string, max = 360): string {
  const plain = plainText(text);
  if (plain.length <= max) return plain;
  const end = plain.slice(0, max).search(/[.!?]\s[^.!?]*$/);
  return end > max / 2
    ? plain.slice(0, end + 1)
    : plain.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
interface Passage {
  heading: string;
  text: string;
}
/** Select verbatim passages by existing headings; this never generates or verifies facts. */
export function overviewPassages(run: SessionRun) {
  let heading = "Model interpretation";
  let block: string[] = [];
  const passages: Passage[] = [];
  const flush = () => {
    const text = block.join(" ").trim();
    block = [];
    if (
      text &&
      !/^(task objective|starting entity|graph revision|investigation objective|workspace|run id|selected sources|objective)\s*:/i.test(
        plainText(text),
      ) &&
      !/^(task objective|starting entity|graph revision|investigation objective|technical metadata|objective)$/i.test(
        heading,
      ) &&
      !/^(?:(?:complete|full|detailed)\s+)?technical\s+(?:analysis|details|report|metadata)$/i.test(heading) &&
      !/^\s*\|/.test(text) &&
      plainText(text) !== plainText(run.objective)
    )
      passages.push({ heading, text });
  };
  for (const line of availableAnalysis(run).split("\n")) {
    const title = line.match(/^#{1,6}\s+(.+)$/);
    if (title) {
      flush();
      heading = plainText(title[1]);
    } else if (!line.trim() || /^\s*[-*]{3,}\s*$/.test(line)) {
      flush();
    } else if (/^\s*[-*+]\s/.test(line)) {
      flush();
      block.push(line);
    } else block.push(line);
  }
  flush();
  const substantive = passages.filter(
    (p) =>
      plainText(p.text).length >= 35 &&
      /\b(is|are|was|were|may|can|could|must|should|depends|provides|consumes|uses|supports|prevents|requires|suggests|indicates|handles|found|observed|identified|returned|does|no)\b|[.!?]/i.test(
        plainText(p.text),
      ) &&
      !/^(record ids?|evidence sources?|relationship type|origin|id|type|name)\s*:/i.test(
        plainText(p.text),
      ),
  );
  const conclusion =
    substantive.find((p) =>
      /conclusion|key takeaway|overall assessment|what.*suggests/i.test(
        p.heading,
      ),
    ) ??
    substantive.find((p) =>
      /executive summary|summary|findings|observations|analysis/i.test(
        p.heading,
      ),
    ) ??
    substantive[0];
  const impact = substantive.find((p) =>
    /impact|significance|why.*matters|operational|risk/i.test(p.heading),
  );
  const observations = run.findings.length
    ? run.findings
        .slice(0, 4)
        .map((text, index) => ({ heading: `Observation ${index + 1}`, text }))
    : substantive.filter((p) => p !== conclusion && p !== impact).slice(0, 4);
  return { conclusion, impact, observations };
}
export function selectedConnections(
  graph: RunGraph,
  nodeId: string,
  sourceIds: readonly string[],
) {
  return graph.edges.filter(
    (edge) =>
      (edge.source_id === nodeId || edge.target_id === nodeId) &&
      edge.source_id_ref &&
      sourceIds.includes(edge.source_id_ref),
  );
}
