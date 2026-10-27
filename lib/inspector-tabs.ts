/** The four inspector destinations are mutually exclusive, including on narrow screens. */
export const INSPECTOR_TABS = [
  { id: 'draw', label: 'Draw' },
  { id: 'layers', label: 'Layers' },
  { id: 'effects', label: 'FX' },
  { id: 'export', label: 'Export' },
] as const;

export type InspectorTab = typeof INSPECTOR_TABS[number]['id'];

/** ARIA tab-list keyboard navigation: arrow keys wrap, Home/End jump. */
export function inspectorTabForKey(current: InspectorTab, key: string): InspectorTab | null {
  const index = INSPECTOR_TABS.findIndex(tab => tab.id === current);
  if (key === 'Home') return INSPECTOR_TABS[0].id;
  if (key === 'End') return INSPECTOR_TABS[INSPECTOR_TABS.length - 1].id;
  if (key === 'ArrowRight') return INSPECTOR_TABS[(index + 1) % INSPECTOR_TABS.length].id;
  if (key === 'ArrowLeft') return INSPECTOR_TABS[(index - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length].id;
  return null;
}
