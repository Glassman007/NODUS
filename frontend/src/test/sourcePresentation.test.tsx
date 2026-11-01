import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SourceCatalog } from '../workspace/sourceCatalog';
import { WorkspaceData } from '../components/WorkspaceData';
it('formats source metadata and evidence references without rewriting graph entity endpoints', () => {
  render(<SourceCatalog.Provider value={[{ source_id: 'NEX-SRC-SERVICE_CATALOG', display_name: 'Engineering Services' }]}><WorkspaceData value={{ evidence: { source_id: 'NEX-SRC-SERVICE_CATALOG', record_id: 'record-1' }, evidence_refs: ['NEX-SRC-SERVICE_CATALOG:record-1'], relationship: { source_id: 'entity:AUTH_API', target_id: 'entity:DATABASE' } }} /></SourceCatalog.Provider>);
  expect(screen.getByText('Engineering Services', { exact: true })).toHaveAttribute('title', 'NEX-SRC-SERVICE_CATALOG');
  expect(screen.getByText('Engineering Services:record-1')).toHaveAttribute('title', 'NEX-SRC-SERVICE_CATALOG:record-1');
  expect(screen.getByText('entity:AUTH_API')).toBeInTheDocument();
  expect(screen.getByText('entity:DATABASE')).toBeInTheDocument();
});
