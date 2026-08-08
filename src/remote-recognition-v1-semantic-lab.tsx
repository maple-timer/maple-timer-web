if (!__REMOTE_RECOGNITION_V1_SEMANTIC_LAB__) {
  throw new Error("remote-recognition-v1-semantic-lab-disabled");
}

const statusElement = document.getElementById(
  "remote-v1-semantic-lab-status",
);
const root = document.getElementById("root");
if (
  !(statusElement instanceof HTMLElement) ||
  !(root instanceof HTMLElement)
) {
  throw new Error("remote-recognition-v1-semantic-lab-document");
}

statusElement.textContent = "semantic lab foundation ready";
root.replaceChildren();

export {};
