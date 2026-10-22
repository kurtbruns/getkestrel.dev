// A doc's code blocks (layouts/_default/_markup/render-codeblock.html), as in Kestrel's Docs
// tab: a bash or JSON fence highlighted on the app's syntax palette, and a Copy beside each.
//
// The highlighters are ports of kestrel's client/ui/highlight.ts (`highlightShell`,
// `highlightJsonText`), as of v1.14.0, so a doc reads the same here as in the app; keep them
// in step with it. A fence in any other language, or none, stays plain, never guessed at.
//
// Copy puts the code's text on the clipboard as written, without the highlighting markup; the
// glyph turns to a check for a moment, and the button's name reads "Copied" meanwhile. Where
// the Clipboard API is missing or refused (an http:// preview, an older browser), it falls back
// to a hidden textarea and execCommand; failing that, it selects the code so a keyboard copy
// takes it.
(function () {
  var blocks = document.querySelectorAll(".code-bare");
  if (!blocks.length) { return; }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // One pass over the raw JSON text: each token is escaped and wrapped, and the whitespace
  // between tokens is escaped as it stands, so nothing is decorated twice. A `//` or `/* */`
  // comment (JSONC, as in wrangler.jsonc) is one token too, so a `//` inside a string, already
  // consumed by then, is never read as one.
  var JSON_TOKEN =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*")(\s*:)?|(?<![\w.-])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w.])|\b(true|false|null)\b|([{}[\],])/g;
  function highlightJson(src) {
    var out = "";
    var last = 0;
    var m;
    JSON_TOKEN.lastIndex = 0;
    while ((m = JSON_TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index));
      if (m[1] !== undefined) {
        out += '<span class="cx-punct">' + esc(m[1]) + "</span>";
      } else if (m[2] !== undefined) {
        out += m[3]
          ? '<span class="cx-prop">' + esc(m[2]) + '</span><span class="cx-punct">' + esc(m[3]) + "</span>"
          : '<span class="cx-str">' + esc(m[2]) + "</span>";
      } else if (m[4] !== undefined) {
        out += '<span class="cx-num">' + m[4] + "</span>";
      } else if (m[5] !== undefined) {
        out += '<span class="cx-tag">' + m[5] + "</span>";
      } else {
        out += '<span class="cx-punct">' + esc(m[0]) + "</span>";
      }
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last));
  }

  // A shell command line, read the way a reader scans one: the command each line (or each
  // part of a pipeline) runs, its flags, the variables to fill in, quoted strings, comments,
  // and the backslash that continues a command onto the next line. A light pass, not a shell
  // parser: it never expands anything, and an alternative it doesn't know stays plain.
  var SHELL_TOKEN =
    /(\\\n)|(\\[\s\S])|('[^']*')|("(?:\\[\s\S]|[^"\\])*")|(\$\{?[A-Za-z_]\w*\}?)|(&&|\|\||[|;])|(\n)|(#[^\n]*)|([^\s'"$|&;\\]+)/g;
  var SHELL_VAR = /\$\{?[A-Za-z_]\w*\}?/g;
  function highlightShell(src) {
    var out = "";
    var last = 0;
    // Whether the next word is a command: at the start of a line that doesn't continue the one
    // before, and after `&&`, `||`, `|`, or `;`.
    var command = true;
    var m;
    SHELL_TOKEN.lastIndex = 0;
    while ((m = SHELL_TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index));
      var word = m[9];
      if (m[1] !== undefined) {
        out += '<span class="cx-punct">\\</span>\n';
      } else if (m[2] !== undefined) {
        out += esc(m[2]);
      } else if (m[3] !== undefined) {
        out += '<span class="cx-str">' + esc(m[3]) + "</span>";
        command = false;
      } else if (m[4] !== undefined) {
        // Double quotes expand a variable, so one inside is still marked.
        out += '<span class="cx-str">' + esc(m[4]).replace(SHELL_VAR, '<span class="cx-var">$&</span>') + "</span>";
        command = false;
      } else if (m[5] !== undefined) {
        out += '<span class="cx-var">' + m[5] + "</span>";
        command = false;
      } else if (m[6] !== undefined) {
        out += '<span class="cx-punct">' + esc(m[6]) + "</span>";
        command = true;
      } else if (m[7] !== undefined) {
        out += "\n";
        command = true;
      } else if (m[8] !== undefined) {
        out += '<span class="cx-punct">' + esc(m[8]) + "</span>";
      } else if (word !== undefined) {
        if (command && /^[A-Za-z_]\w*=/.test(word)) {
          // An assignment before the command (`PORT=8788 npm run dev`) leaves the command next.
          out += esc(word);
        } else if (command) {
          out += '<span class="cx-tag">' + esc(word) + "</span>";
          command = false;
        } else if (word.charAt(0) === "-") {
          out += '<span class="cx-num">' + esc(word) + "</span>";
        } else {
          out += esc(word);
        }
      }
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last));
  }

  var HIGHLIGHT = { bash: highlightShell, sh: highlightShell, shell: highlightShell, json: highlightJson, jsonc: highlightJson };

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

  Array.prototype.forEach.call(blocks, function (block) {
    var code = block.querySelector("pre code");
    var b = block.querySelector(".copy-btn");
    if (!code) { return; }
    // Read before highlighting: the fence's text, exactly, is what Copy takes.
    var text = code.textContent;
    var hl = HIGHLIGHT[code.getAttribute("data-lang")];
    if (hl) { code.innerHTML = hl(text); }
    if (!b) { return; }
    var timer = 0;
    b.addEventListener("click", function () {
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
