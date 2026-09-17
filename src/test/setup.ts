import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Limpia el DOM entre tests (RTL auto-cleanup requiere globals; aquí lo hacemos explícito).
afterEach(() => {
  cleanup();
});