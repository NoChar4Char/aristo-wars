// Helpers shared by every page.
const AW = (() => {
  const params = new URLSearchParams(location.search);
  const FLAGS = ["local", "relay"]; // test flags that follow you from page to page

  // Build a link to another page, keeping any test flags from this URL.
  function link(page, extra = {}) {
    const p = new URLSearchParams();
    for (const f of FLAGS) if (params.has(f)) p.set(f, "");
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const q = p.toString().replace(/=(?=&|$)/g, "");
    return page + (q ? "?" + q : "");
  }

  function getName() {
    try { return localStorage.getItem("aw-name") || ""; } catch (_) { return ""; }
  }

  function setName(n) {
    try { localStorage.setItem("aw-name", n); } catch (_) {}
  }

  // Nav links carry the test flags too.
  document.addEventListener("DOMContentLoaded", () => {
    for (const a of document.querySelectorAll("a[data-page]")) {
      const extra = a.dataset.mode ? { mode: a.dataset.mode } : {};
      a.href = link(a.dataset.page, extra);
    }
  });

  return { params, link, getName, setName };
})();
