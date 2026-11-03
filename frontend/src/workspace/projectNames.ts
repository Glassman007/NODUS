const projectNames: Readonly<Record<string, string>> = {
  "NEX-PRJ-PAY": "Payment",
  "NEX-PRJ-COM": "Commerce",
  "NEX-PRJ-ID": "Identity",
  "NEX-PRJ-DATA": "Data",
};

/** Display labels only. Keep the original ID for values, requests, and scope. */
export function projectLabel(id: string, name?: string): string {
  return projectNames[id] ?? (name?.trim() || id);
}
