import { useState } from "react";
import {
  loadMonitoringSectionCollapseState,
  saveMonitoringSectionCollapseState,
  type MonitoringSectionCollapseState,
  type MonitoringSectionId,
} from "./monitoringSectionCollapse";

export function useMonitoringSectionCollapseController() {
  const [collapsedSections, setCollapsedSections] = useState<MonitoringSectionCollapseState>(() =>
    loadMonitoringSectionCollapseState(),
  );

  const toggleSection = (sectionId: MonitoringSectionId) => {
    setCollapsedSections((current) => {
      const next = { ...current, [sectionId]: !current[sectionId] };
      saveMonitoringSectionCollapseState(next);
      return next;
    });
  };

  return {
    collapsedSections,
    toggleSection,
  };
}
