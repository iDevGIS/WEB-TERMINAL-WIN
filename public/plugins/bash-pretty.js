/* @cc-plugin
 * id: bash-pretty
 * name: Bash Pretty
 * description: Adds a 📋 Copy button on Bash command tool blocks
 * author: GYOZEN
 * version: 1.0
 */
(function () {
  if (!window.ccPlugins || typeof window.ccPlugins.register !== "function") return;

  window.ccPlugins.register({
    id: "bash-pretty",
    name: "Bash Pretty",
    description: "Adds a 📋 Copy button on Bash command tool blocks",
    author: "GYOZEN",
    version: "1.0",
    match: function (tool) { return tool === "Bash"; },
    decorate: function (blockEl) {
      var header = blockEl.querySelector(".cc-tool-header");
      if (!header) return;
      if (header.querySelector('[data-bash-copy="1"]')) return;
      var fileEl = blockEl.querySelector(".cc-tool-file");
      var cmd = fileEl ? (fileEl.textContent || "").trim() : "";
      if (!cmd) return;

      var btn = document.createElement("button");
      btn.dataset.bashCopy = "1";
      btn.dataset.ccPluginOwner = "bash-pretty";
      btn.title = "Copy command";
      btn.style.cssText =
        "background:transparent;border:1px solid rgba(255,255,255,.12);color:#a8a8b8;padding:1px 7px;border-radius:4px;font-size:10px;cursor:pointer;margin-right:6px;line-height:1.4";
      btn.textContent = "📋";
      btn.onclick = function (e) {
        e.stopPropagation();
        var copy = function (text) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(function () {});
          }
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch {}
          ta.remove();
        };
        copy(cmd);
        var orig = btn.textContent;
        btn.textContent = "✓";
        setTimeout(function () { btn.textContent = orig; }, 1200);
      };

      var statusEl = header.querySelector(".cc-tool-status");
      if (statusEl) header.insertBefore(btn, statusEl);
      else header.appendChild(btn);
    },
  });
})();
