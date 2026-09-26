import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

// No catalogue: t returns the key, so tests assert on keys rather than wording.
i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: {} } },
  react: { useSuspense: false },
});

configure({
  getElementError(message: string | null) {
    const error = new Error(message ?? "");
    error.name = "TestingLibraryElementError";
    return error;
  },
});

// jsdom lacks these.
class Inert {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver = Inert as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = Inert as unknown as typeof ResizeObserver;
Element.prototype.scrollTo = () => {};
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
