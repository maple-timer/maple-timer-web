import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TroubleshooterPage } from "./TroubleshooterPage";
import "./troubleshooter.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Troubleshooter root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <TroubleshooterPage />
  </StrictMode>,
);
