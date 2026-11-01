import { createContext } from "react";
import type { SourceMetadata } from "./sourceNames";
export const SourceCatalog = createContext<readonly SourceMetadata[]>([]);
