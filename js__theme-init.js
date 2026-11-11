/* Applies the saved colour theme before the page paints (prevents a light/dark flash).
   This is an external file, not an inline <script>, so a strict Content-Security-Policy can forbid inline scripts. */
(function(){
    try{
      var pref = localStorage.getItem("feu-theme") || "light";
      var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      if(dark) document.documentElement.setAttribute("data-theme","dark");
      document.documentElement.setAttribute("data-theme-pref", pref);
    }catch(e){}
})();
