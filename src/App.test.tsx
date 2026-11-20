import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
it("renders the initial studio without opening device APIs or requiring a database", () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain("My");
  expect(html).toContain("Enregistrer mon piano");
  expect(html).toContain("Avant la prise");
  expect(html).toContain("Après la prise");
  expect(html).toContain("Mes créations");
  expect(html).toContain("Aucune affiliation");
});
