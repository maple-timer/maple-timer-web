import { useState } from "react";

export function useExpandableRowController(initialExpanded = false) {
  const [isExpanded, setExpanded] = useState(initialExpanded);
  const toggleExpanded = () => setExpanded((current) => !current);

  return {
    isExpanded,
    toggleExpanded,
  };
}
