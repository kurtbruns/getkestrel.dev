// Copy on a doc's code blocks (layouts/_default/_markup/render-codeblock.html), as in
// Kestrel's Docs tab: the glyph turns to a check for a moment when the copy lands, and the
// button's name reads "Copied" meanwhile. It copies the code's text as written, without the
// highlighting markup. Where the Clipboard API is missing or refused (an http:// preview,
// an older browser), it falls back to a hidden textarea and execCommand; failing that, it
// selects the code so a keyboard copy takes it.
(function () {
  var buttons = document.querySelectorAll(".code-bare > .copy-btn");
  if (!buttons.length) { return; }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function selectCode(code) {
    var range = document.createRange();
    range.selectNodeContents(code);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  Array.prototype.forEach.call(buttons, function (b) {
    var code = b.parentNode.querySelector("pre code");
    if (!code) { return; }
    var timer = 0;
    b.addEventListener("click", function () {
      // Chroma ends every line with a newline, the last one too; the fence's text doesn't.
      var text = code.textContent.replace(/\n$/, "");
      copy(text).then(function (ok) {
        if (!ok) { selectCode(code); return; }
        clearTimeout(timer);
        b.classList.add("copied");
        b.setAttribute("aria-label", "Copied");
        b.title = "Copied";
        timer = setTimeout(function () {
          b.classList.remove("copied");
          b.setAttribute("aria-label", "Copy");
          b.title = "Copy";
        }, 1500);
      });
    });
    b.hidden = false;
  });
})();
