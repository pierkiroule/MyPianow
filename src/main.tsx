import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js", {
        scope: import.meta.env.BASE_URL,
      })
      .then((registration) => {
        const announce = () => {
          if (registration.waiting)
            window.dispatchEvent(
              new CustomEvent("mypianow-update", {
                detail: registration.waiting,
              }),
            );
        };
        announce();
        registration.addEventListener("updatefound", () => {
          registration.installing?.addEventListener("statechange", announce);
        });
      })
      .catch(() => {
        /* The studio works without offline caching. */
      });
  });
