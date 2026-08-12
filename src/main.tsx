import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./styles/globals.css";
import "./styles/nothing.css";
import "./styles/terminal.css";
import "@xterm/xterm/css/xterm.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
