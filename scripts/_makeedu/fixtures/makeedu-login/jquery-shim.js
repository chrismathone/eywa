/* 시험 픽스처 — makeedu login.html 인라인 스크립트와 login-bot-check.js가 쓰는 만큼만 흉내 낸 **최소 jQuery 대역**(진짜 jQuery 아님).
   시험 서버가 /js/jquery/jquery-1.11.3.min.js 자리에 내준다(오프라인 · 외부 요청 없음). 화면 스크립트는 고치지 않고 그대로 돈다.
   지원: $(fn) · $(sel|el|document) · ':eq(n)' · ready/on/bind/keypress/click/submit/validate/val/text/attr/is/show/hide/closest/find/serialize ·
   $.post(…).fail · $.cookie · $.msgDialog.error. */
(function (window) {
  var document = window.document;
  function J(els) { this.els = els; this.length = els.length; }
  function $(sel) {
    if (typeof sel === "function") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { sel($); });
      else setTimeout(function () { sel($); });
      return undefined;
    }
    if (sel === document || sel === window || (sel && sel.nodeType)) return new J([sel]);
    if (typeof sel === "string") {
      var m = /^(.*):eq\((\d+)\)$/.exec(sel);
      if (m) { var all = document.querySelectorAll(m[1]); return new J(all[+m[2]] ? [all[+m[2]]] : []); }
      return new J(Array.prototype.slice.call(document.querySelectorAll(sel)));
    }
    return new J([]);
  }
  var P = J.prototype;
  P.ready = function (fn) { $(fn); return this; };
  P.on = P.bind = function (types, fn) {
    var els = this.els;
    types.split(/\s+/).forEach(function (t) {
      els.forEach(function (el) {
        el.addEventListener(t, function (e) { if (fn.call(el, e) === false) { e.preventDefault(); e.stopPropagation(); } });
      });
    });
    return this;
  };
  P.keypress = function (fn) { return this.on("keypress", fn); };
  P.click = function (fn) { if (fn) return this.on("click", fn); this.els.forEach(function (el) { el.click(); }); return this; };
  P.submit = function (fn) {
    if (fn) return this.on("submit", fn);
    this.els.forEach(function (el) { el.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); });
    return this;
  };
  // jquery.validate 대역 — 필수 칸이 비면 제출하지 않고, 차 있으면 submitHandler(form)를 부른다.
  P.validate = function (opts) {
    this.els.forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var rules = (opts && opts.rules) || {};
        var ok = Object.keys(rules).every(function (name) {
          var f = form.elements[name];
          return !(rules[name].required && f && !String(f.value).trim());
        });
        if (ok && opts.submitHandler) opts.submitHandler(form);
      });
    });
    return this;
  };
  P.val = function (v) {
    if (v === undefined) return this.els[0] ? this.els[0].value : undefined;
    this.els.forEach(function (el) { el.value = v; });
    return this;
  };
  P.text = function (v) {
    if (v === undefined) return this.els[0] ? this.els[0].textContent : "";
    this.els.forEach(function (el) { el.textContent = v; });
    return this;
  };
  P.attr = function (n, v) {
    if (v === undefined) return this.els[0] ? this.els[0].getAttribute(n) : undefined;
    this.els.forEach(function (el) { el.setAttribute(n, v); });
    return this;
  };
  P.is = function (s) { return this.els.some(function (el) { return s === ":checked" ? !!el.checked : el.matches(s); }); };
  P.show = function () { this.els.forEach(function (el) { el.style.display = "block"; }); return this; };
  P.hide = function () { this.els.forEach(function (el) { el.style.display = "none"; }); return this; };
  P.closest = function (s) { return new J(this.els.map(function (el) { return el.closest(s); }).filter(Boolean)); };
  P.find = function (s) {
    var out = [];
    this.els.forEach(function (el) { out.push.apply(out, Array.prototype.slice.call(el.querySelectorAll(s))); });
    return new J(out);
  };
  P.serialize = function () { var f = this.els[0]; return f ? new URLSearchParams(new FormData(f)).toString() : ""; };
  P.appendTo = function () { return this; };
  $.fn = P;
  $.cookie = function () { return ""; };
  $.msgDialog = { error: function (m) { document.body.setAttribute("data-fixture-dialog", m); } };
  $.post = function (url, data, cb) {
    var fails = [];
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    xhr.onload = function () {
      var parsed;
      try { parsed = JSON.parse(xhr.responseText); } catch { fails.forEach(function (f) { f(); }); return; }
      if (xhr.status >= 200 && xhr.status < 300) cb(parsed); else fails.forEach(function (f) { f(); });
    };
    xhr.onerror = function () { fails.forEach(function (f) { f(); }); };
    xhr.send(data);
    return { fail: function (f) { fails.push(f); return this; } };
  };
  window.jQuery = window.$ = $;
})(window);
