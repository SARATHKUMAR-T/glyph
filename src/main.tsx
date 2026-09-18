import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { resolveInitialSession } from "./lib/session/resolveInitialSession";
import "./styles/globals.css";
import "./styles/nothing.css";
import "./styles/terminal.css";

const root = document.getElementById("root");

if (root) {
  // Resolved before the first render rather than in an effect after an
  // initial blank tab — see `resolveInitialSession`'s doc comment for why
  // that ordering matters (it's not just a nicer restore, it avoids
  // leaking an orphaned shell process).
  void resolveInitialSession().then((initialSession) => {
    createRoot(root).render(
      <React.StrictMode>
        <App initialSession={initialSession} />
      </React.StrictMode>,
    );
  });
}
