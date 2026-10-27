// Points formio's library CDN (Formio.cdn, https://cdn.form.io by default) at the copies in this image,
// /vendor/formio/ (vendor/formio-cdn.txt). formio loads CKEditor, Quill, ACE, flatpickr and timezone data
// from it at runtime.
//
// Each micro-frontend bundles its own formio. On load, each copy registers itself as window.Formio unless
// one is already there, and every copy loads libraries through window.Formio.cdn. So setting the CDN of the
// first copy, when it registers, covers all of them. Must run before any bundle loads.
(function () {
  var base = "/vendor/formio";
  Object.defineProperty(window, "Formio", {
    configurable: true,
    get: function () {
      return undefined;
    },
    set: function (formio) {
      Object.defineProperty(window, "Formio", { configurable: true, enumerable: true, writable: true, value: formio });
      if (formio && formio.cdn && typeof formio.cdn.setBaseUrl === "function") {
        formio.cdn.setBaseUrl(base);
      } else {
        console.error("formio-cdn.js: window.Formio has no cdn.setBaseUrl; formio libraries load from its default CDN");
      }
    },
  });
})();
