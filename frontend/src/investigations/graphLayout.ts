import type { Core } from "cytoscape";
import type { GraphNode } from "./graph";
import { entityName } from "./presentation";

/** Display labels only: original records and identifiers remain untouched. */
export function graphLabels(nodes: readonly GraphNode[]): Map<string, string> {
  const labels = new Map<string, string>();
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const name = entityName(node).replace(/\s+/g, " ").trim();
    const words = name.split(" ");
    const short = words.slice(0, 3).join(" ");
    const label = short.length > 20
      ? short.slice(0, 19).trimEnd() + "…"
      : short + (words.length > 3 ? "…" : "");
    groups.set(label, [...(groups.get(label) ?? []), node]);
  }
  const used = new Set(groups.keys());
  for (const [label, group] of groups) {
    group.sort((a, b) => a.id.localeCompare(b.id)).forEach((node, index) => {
      if (group.length === 1) {
        labels.set(node.id, label);
        return;
      }
      let number = index + 1;
      let unique: string;
      do {
        const suffix = ` · ${number++}`;
        unique = label.slice(0, 20 - suffix.length).trimEnd() + suffix;
      } while (used.has(unique));
      used.add(unique);
      labels.set(node.id, unique);
    });
  }
  return labels;
}

/** CoSE includes labels in its forces; this final collision pass removes the
 * remaining label/node intersections without changing any topology. */
export function separateGraphLabels(core: Core, fitToCanvas = false): void {
  if (fitToCanvas && core.nodes().length) {
    const bounds = core.nodes().boundingBox();
    const scale = Math.min(
      1,
      (core.width() - 104) / bounds.w,
      (core.height() - 104) / bounds.h,
    );
    // Keep the force layout's branch directions while avoiding a distant fit
    // that shrinks text. The collision pass below restores label clearance.
    if (scale > 0 && scale < 1) {
      core.batch(() => core.nodes().forEach(node => {
        const position = node.position();
        node.position({ x: position.x * scale, y: position.y * scale });
      }));
    }
  }
  const boxes = core.nodes().map(node => ({
    node,
    box: node.boundingBox({ includeLabels: true }),
    position: { ...node.position() },
  }));
  const shift = (item: typeof boxes[number], x: number, y: number) => {
    item.position.x += x;
    item.position.y += y;
    item.box.x1 += x;
    item.box.x2 += x;
    item.box.y1 += y;
    item.box.y2 += y;
  };
  for (let sweep = 0; sweep < 100; sweep++) {
    let collisions = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.box.x2, b.box.x2) - Math.max(a.box.x1, b.box.x1) + 18;
      const overlapY = Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1) + 18;
      if (overlapX <= 0 || overlapY <= 0) continue;
      collisions++;
      const aWeight = 1 + a.node.degree() * 0.18;
      const bWeight = 1 + b.node.degree() * 0.18;
      const amount = (Math.min(overlapX, overlapY) + 1) / (aWeight + bWeight);
      const x = overlapX < overlapY ? (a.position.x <= b.position.x ? -amount : amount) : 0;
      const y = overlapX < overlapY ? 0 : (a.position.y <= b.position.y ? -amount : amount);
      shift(a, x * bWeight, y * bWeight);
      shift(b, -x * aWeight, -y * aWeight);
    }
    if (!collisions) break;
  }
  core.batch(() => boxes.forEach(item => item.node.position(item.position)));
}

export function fitGraph(core: Core): void {
  core.fit(core.elements(), 52);
  if (core.zoom() > 1.35) {
    core.zoom(1.35);
    core.center();
  }
}
